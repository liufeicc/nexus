/**
 * nexus-win-panel.exe —— Nexus Windows 应用面板桥接 daemon
 *
 * 与 Linux 的 nexus-x11-bridge 同构：常驻进程 + stdin/stdout 行协议。
 * 每行一条命令、回一行响应（TS 侧按发送顺序配对，见 win-bridge.service.ts）。
 * 所有可能阻塞在被嵌应用上的 Win32 调用都在本进程内完成，
 * Electron 主进程只做管道读写——这是"卡死牵连保护"的边界。
 *
 * 职责（P1 direct 嵌入）：
 * - 在 Electron 主窗口内创建 WS_CHILD 容器窗口，承接被嵌应用窗口；
 * - attach-app：样式修正 + SetParent 过继（顺序见实现注释）；
 * - find-window：按进程树遍历查找可嵌入的主窗口（等价解决 launcher 脱管）；
 * - kill-app/close-window/kill-tree：两段式退出（WM_CLOSE 礼貌退出 → 进程树 TerminateProcess）；
 * - DPI 换算：本进程声明 Per-Monitor V2，几何一律物理像素；TS 传入 CSS px +
 *   宿主 CSS 尺寸，用 GetClientRect 实测比值得到换算系数（不查表不猜）；
 * - list-apps/get-icon：开始菜单应用枚举与图标（见 nexus_win_panel_apps.cpp）。
 *
 * 消息循环：MsgWaitForMultipleObjects 单线程等待 stdin 管道与窗口消息队列，
 * 对应 Linux 版的 select(stdin+Xfd) 循环。
 *
 * P2 将增加 scale 模块（DWM Thumbnail 缩放 + 输入注入 + 放大镜），
 * 届时新增 nexus_win_panel_scale.cpp 并扩展 scale-* 命令。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>
#include <dwmapi.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "nexus_win_panel_apps.h"

/** daemon 内嵌版本号：TS 侧（win-bridge.service.ts EXPECTED_HELPER_VERSION）启动即校验，
 * 不匹配拒绝使用。源码改动必须同步递增（见 build.sh 铁律） */
#define NEXUS_WIN_PANEL_VERSION "1.0.0"

static HINSTANCE g_hinst = nullptr;
static const wchar_t *CONTAINER_CLASS = L"NexusPanelContainer";

/** 容器会话信息：过继进来的应用窗口与原始窗口样式（恢复用） */
struct ContainerInfo {
    HWND appHwnd = nullptr;   // 已过继的应用主窗口（可能为空）
    LONG_PTR origStyle = 0;   // 过继前样式（detach/错误恢复用）
    LONG_PTR origExStyle = 0;
    bool attached = false;
};
static std::unordered_map<HWND, ContainerInfo> g_containers;

/** CSS px → 物理像素换算系数（由 create-container/set-bounds 携带的宿主 CSS 尺寸实测更新） */
static double g_css_scale = 1.0;

/* ============================ 基础工具 ============================ */

/** 按空白切分命令行 */
static std::vector<std::string> split_tokens(const std::string &line)
{
    std::vector<std::string> out;
    size_t i = 0;
    while (i < line.size()) {
        while (i < line.size() && (line[i] == ' ' || line[i] == '\t' || line[i] == '\r'))
            i++;
        size_t j = i;
        while (j < line.size() && line[j] != ' ' && line[j] != '\t' && line[j] != '\r')
            j++;
        if (j > i)
            out.push_back(line.substr(i, j - i));
        i = j;
    }
    return out;
}

/** 十进制解析 HWND（x64 下 HWND 为 64 位，TS 侧以 BigUInt64LE 转十进制串传入） */
static HWND parse_hwnd(const std::string &s)
{
    return reinterpret_cast<HWND>(static_cast<uintptr_t>(strtoull(s.c_str(), nullptr, 10)));
}

/** 输出响应行并立即冲刷（stdout 为管道，默认块缓冲，不 flush TS 侧收不到） */
static void reply(const std::string &line)
{
    printf("%s\n", line.c_str());
    fflush(stdout);
}

static void reply_hwnd(HWND hwnd)
{
    char buf[40];
    snprintf(buf, sizeof buf, "ok %llu",
             static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(hwnd)));
    reply(buf);
}

/* ---------- base64 ---------- */

static const char *B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string b64_encode(const unsigned char *data, size_t len)
{
    std::string out;
    out.reserve((len + 2) / 3 * 4);
    for (size_t i = 0; i < len; i += 3) {
        unsigned int n = data[i] << 16;
        if (i + 1 < len) n |= data[i + 1] << 8;
        if (i + 2 < len) n |= data[i + 2];
        out += B64_CHARS[(n >> 18) & 63];
        out += B64_CHARS[(n >> 12) & 63];
        out += (i + 1 < len) ? B64_CHARS[(n >> 6) & 63] : '=';
        out += (i + 2 < len) ? B64_CHARS[n & 63] : '=';
    }
    return out;
}

std::vector<unsigned char> b64_decode(const std::string &in)
{
    auto val = [](char c) -> int {
        if (c >= 'A' && c <= 'Z') return c - 'A';
        if (c >= 'a' && c <= 'z') return c - 'a' + 26;
        if (c >= '0' && c <= '9') return c - '0' + 52;
        if (c == '+') return 62;
        if (c == '/') return 63;
        return -1;
    };
    std::vector<unsigned char> out;
    out.reserve(in.size() / 4 * 3);
    unsigned int buf = 0;
    int bits = 0;
    for (char c : in) {
        int v = val(c);
        if (v < 0)
            continue; // 填充 '=' 与非法字符一律忽略
        buf = (buf << 6) | static_cast<unsigned int>(v);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<unsigned char>((buf >> bits) & 0xFF));
        }
    }
    return out;
}

/* ---------- UTF-8 / UTF-16 ---------- */

std::string utf16_to_utf8(const std::wstring &w)
{
    if (w.empty())
        return std::string();
    int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, nullptr, 0, nullptr, nullptr);
    if (n <= 0)
        return std::string();
    std::string out(static_cast<size_t>(n - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, &out[0], n, nullptr, nullptr);
    return out;
}

std::wstring utf8_to_utf16(const std::string &s)
{
    if (s.empty())
        return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    if (n <= 0)
        return std::wstring();
    std::wstring out(static_cast<size_t>(n - 1), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &out[0], n);
    return out;
}

/* ---------- DPI ---------- */

/** 进程 DPI 感知：优先 Per-Monitor V2（Win10 1703+），动态解析函数指针，
 * 老系统回退 System Aware。此后本进程所有 Win32 几何 API 均返回物理像素 */
static void init_dpi_awareness()
{
    typedef BOOL(WINAPI * Fn)(HANDLE); // DPI_AWARENESS_CONTEXT 即 HANDLE 别名
    // 经 void* 中转避免 -Wcast-function-type（FARPROC 与目标签名不兼容）
    Fn set_ctx = reinterpret_cast<Fn>(reinterpret_cast<void *>(
        GetProcAddress(GetModuleHandleW(L"user32"), "SetProcessDpiAwarenessContext")));
    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (HANDLE)-4
    if (!set_ctx || !set_ctx(reinterpret_cast<HANDLE>(-4)))
        SetProcessDPIAware();
}

/** 用宿主客户区物理尺寸与传入的 CSS 尺寸实测换算系数。
 * GetClientRect 是最基础的 Win32 行为，与 Electron 版本/manifest/zoomFactor 全解耦；
 * 跨屏 DPI 变化时 TS 侧 ResizeObserver 触发新一轮 set-bounds，系数自动重算 */
static void update_dpi_scale(HWND host, double hostCssW, double hostCssH)
{
    if (hostCssW <= 0 || hostCssH <= 0)
        return;
    RECT rc;
    if (!GetClientRect(host, &rc) || rc.right <= 0 || rc.bottom <= 0)
        return;
    double sx = rc.right / hostCssW;
    double sy = rc.bottom / hostCssH;
    if (fabs(sx - sy) > 1.0)
        fprintf(stderr, "[win-panel] DPI 换算 X/Y 不一致: %.3f vs %.3f\n", sx, sy);
    g_css_scale = sx;
}

/* ============================ 容器窗口 ============================ */

/** 容器窗口过程：
 * - WM_SIZE：联动铺满已过继的应用子窗口（应用收 WM_SIZE 自行重排；
 *   同时兜底自行改尺寸的应用——TS 看门狗周期触发 set-bounds 即完成"铺满"职责）；
 * - WM_PAINT：黑色背景，避免面板 resize 瞬间露出白底。 */
static LRESULT CALLBACK container_wndproc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    switch (msg) {
    case WM_SIZE: {
        auto it = g_containers.find(hwnd);
        if (it != g_containers.end() && it->second.appHwnd && IsWindow(it->second.appHwnd)) {
            int w = LOWORD(lParam);
            int h = HIWORD(lParam);
            if (w > 0 && h > 0)
                MoveWindow(it->second.appHwnd, 0, 0, w, h, TRUE);
        }
        return 0;
    }
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc;
        GetClientRect(hwnd, &rc);
        FillRect(hdc, &rc, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
        EndPaint(hwnd, &ps);
        return 0;
    }
    default:
        return DefWindowProcW(hwnd, msg, wParam, lParam);
    }
}

static bool register_container_class()
{
    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof wc;
    wc.lpfnWndProc = container_wndproc;
    wc.hInstance = g_hinst;
    wc.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512)); // IDC_ARROW
    wc.lpszClassName = CONTAINER_CLASS;
    return RegisterClassExW(&wc) != 0;
}

/* ============================ 进程树工具 ============================ */

/** 收集 rootPid 自身及其全部后代进程 pid。
 * 等价解决 Linux "launcher 脱管"：启动器派生真实进程后退出，
 * 真实窗口往往属于子进程，按单 pid 找窗口会漏。 */
static std::unordered_set<DWORD> collect_process_tree(DWORD rootPid)
{
    std::unordered_set<DWORD> result;
    std::unordered_map<DWORD, std::vector<DWORD>> children;
    bool rootSeen = false;

    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE)
        return result;
    PROCESSENTRY32W pe = {};
    pe.dwSize = sizeof pe;
    if (Process32FirstW(snap, &pe)) {
        do {
            if (pe.th32ProcessID == rootPid)
                rootSeen = true;
            children[pe.th32ParentProcessID].push_back(pe.th32ProcessID);
        } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);

    if (!rootSeen)
        return result;
    // BFS 展开整棵树
    std::vector<DWORD> queue{rootPid};
    result.insert(rootPid);
    for (size_t i = 0; i < queue.size(); i++) {
        auto it = children.find(queue[i]);
        if (it == children.end())
            continue;
        for (DWORD child : it->second) {
            if (result.insert(child).second)
                queue.push_back(child);
        }
    }
    return result;
}

/** 进程是否存活 */
static bool process_alive(DWORD pid)
{
    HANDLE h = OpenProcess(SYNCHRONIZE, FALSE, pid);
    if (!h)
        return false; // 打不开一般即已退出（或拒绝访问，按不存活处理避免死等）
    DWORD wr = WaitForSingleObject(h, 0);
    CloseHandle(h);
    return wr == WAIT_TIMEOUT;
}

/** 终止进程树（Toolhelp32 重建 + 逐个 TerminateProcess，不用 taskkill：
 * 避免弹控制台、避免 shell 依赖）。返回实际终止的进程数 */
static int kill_process_tree(DWORD pid)
{
    const std::unordered_set<DWORD> tree = collect_process_tree(pid);
    int killed = 0;
    for (DWORD p : tree) {
        HANDLE h = OpenProcess(PROCESS_TERMINATE, FALSE, p);
        if (!h)
            continue;
        if (TerminateProcess(h, 1))
            killed++;
        CloseHandle(h);
    }
    return killed;
}

/* ============================ find-window ============================ */

struct FindCtx {
    const std::unordered_set<DWORD> *pids;
    int minW;
    int minH;
    HWND found;
};

/** 枚举顶层窗口回调：命中进程树、可见、有标题、尺寸达标、非工具窗口 → 取为首个匹配 */
static BOOL CALLBACK find_window_cb(HWND hwnd, LPARAM lp)
{
    FindCtx *ctx = reinterpret_cast<FindCtx *>(lp);
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (!ctx->pids->count(pid))
        return TRUE;
    if (!IsWindowVisible(hwnd))
        return TRUE;
    if (GetWindowTextLengthW(hwnd) <= 0)
        return TRUE;
    if (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW)
        return TRUE; // splash/悬浮小窗
    RECT rc;
    if (!GetWindowRect(hwnd, &rc))
        return TRUE;
    if (rc.right - rc.left < ctx->minW || rc.bottom - rc.top < ctx->minH)
        return TRUE;
    ctx->found = hwnd;
    return FALSE;
}

/* ============================ 命令实现 ============================ */

/** create-container <parentHwnd> <x> <y> <w> <h> <hostCssW> <hostCssH>
 * 在 Electron 主窗口内创建隐藏的 WS_CHILD 容器。创建即隐藏，
 * 待 TS 看门狗确认应用首帧后再 map（避免启动期间黑屏遮挡 DOM 状态层） */
static void cmd_create_container(const std::vector<std::string> &t)
{
    if (t.size() < 8) { reply("err bad-args"); return; }
    HWND parent = parse_hwnd(t[1]);
    if (!IsWindow(parent)) { reply("err bad-parent"); return; }
    double x = atof(t[2].c_str()), y = atof(t[3].c_str());
    double w = atof(t[4].c_str()), h = atof(t[5].c_str());
    double hostCssW = atof(t[6].c_str()), hostCssH = atof(t[7].c_str());

    update_dpi_scale(parent, hostCssW, hostCssH);
    int X = static_cast<int>(lround(x * g_css_scale));
    int Y = static_cast<int>(lround(y * g_css_scale));
    int W = std::max(1, static_cast<int>(lround(w * g_css_scale)));
    int H = std::max(1, static_cast<int>(lround(h * g_css_scale)));

    HWND hwnd = CreateWindowExW(0, CONTAINER_CLASS, L"",
                                WS_CHILD | WS_CLIPCHILDREN,
                                X, Y, W, H, parent, nullptr, g_hinst, nullptr);
    if (!hwnd) { reply("err create-failed"); return; }
    g_containers[hwnd] = ContainerInfo{};
    reply_hwnd(hwnd);
}

/** set-bounds <hwnd> <x> <y> <w> <h> <hostCssW> <hostCssH>
 * 移动/缩放容器；WM_SIZE 联动铺满内部应用子窗口 */
static void cmd_set_bounds(const std::vector<std::string> &t)
{
    if (t.size() < 8) { reply("err bad-args"); return; }
    HWND hwnd = parse_hwnd(t[1]);
    if (!IsWindow(hwnd)) { reply("err bad-hwnd"); return; }
    double x = atof(t[2].c_str()), y = atof(t[3].c_str());
    double w = atof(t[4].c_str()), h = atof(t[5].c_str());
    double hostCssW = atof(t[6].c_str()), hostCssH = atof(t[7].c_str());

    HWND host = GetParent(hwnd);
    if (host)
        update_dpi_scale(host, hostCssW, hostCssH);
    int X = static_cast<int>(lround(x * g_css_scale));
    int Y = static_cast<int>(lround(y * g_css_scale));
    int W = std::max(1, static_cast<int>(lround(w * g_css_scale)));
    int H = std::max(1, static_cast<int>(lround(h * g_css_scale)));
    MoveWindow(hwnd, X, Y, W, H, TRUE);
    reply("ok");
}

/** map/unmap：显示/隐藏容器。
 * 显示用 SW_SHOWNOACTIVATE——容器出现不应抢走宿主焦点（焦点由点击/SetFocus 显式转移） */
static void cmd_map(const std::vector<std::string> &t, bool show)
{
    if (t.size() < 2) { reply("err bad-args"); return; }
    HWND hwnd = parse_hwnd(t[1]);
    if (IsWindow(hwnd))
        ShowWindow(hwnd, show ? SW_SHOWNOACTIVATE : SW_HIDE);
    reply("ok");
}

/** raise：容器置顶（防 Electron 内部子窗口遮挡；看门狗周期调用） */
static void cmd_raise(const std::vector<std::string> &t)
{
    if (t.size() < 2) { reply("err bad-args"); return; }
    HWND hwnd = parse_hwnd(t[1]);
    if (IsWindow(hwnd))
        SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    reply("ok");
}

/** focus <hwnd>：程序化焦点。hwnd 传容器时自动落到已过继的应用子窗口。
 * 跨进程 SetFocus 必须先 AttachThreadInput 挂接输入队列，否则静默失败；
 * SetFocus 成功后即可解除挂接（后续点击由 Windows 自然路由） */
static void cmd_focus(const std::vector<std::string> &t)
{
    if (t.size() < 2) { reply("err bad-args"); return; }
    HWND hwnd = parse_hwnd(t[1]);
    auto it = g_containers.find(hwnd);
    if (it != g_containers.end() && it->second.appHwnd && IsWindow(it->second.appHwnd))
        hwnd = it->second.appHwnd;
    if (!IsWindow(hwnd)) { reply("err bad-hwnd"); return; }

    DWORD targetTid = GetWindowThreadProcessId(hwnd, nullptr);
    DWORD selfTid = GetCurrentThreadId();
    BOOL attached = FALSE;
    if (targetTid && targetTid != selfTid)
        attached = AttachThreadInput(selfTid, targetTid, TRUE);
    SetFocus(hwnd);
    if (attached)
        AttachThreadInput(selfTid, targetTid, FALSE);
    reply("ok");
}

/** destroy <hwnd>：销毁容器窗口。
 * ⚠️ 调用方契约：容器内应用进程必须先被杀死（kill-app），
 * 否则 DestroyWindow 向存活的跨进程子窗口发 WM_DESTROY 会同步挂死本 daemon。
 * TS 侧 kill 流程严格遵守"先杀后毁"顺序 */
static void cmd_destroy(const std::vector<std::string> &t)
{
    if (t.size() < 2) { reply("err bad-args"); return; }
    HWND hwnd = parse_hwnd(t[1]);
    g_containers.erase(hwnd);
    if (IsWindow(hwnd))
        DestroyWindow(hwnd);
    reply("ok");
}

/** attach-app <container> <appHwnd>：样式修正 + SetParent 过继。
 * 顺序是防翻车关键：
 * 1. 记录原样式（错误恢复用）；
 * 2. 最大化窗口先还原（最大化状态过继会产生错误的尺寸记忆）；
 * 3. 改样式：去标题栏/边框/系统按钮、置 WS_CHILD、去任务栏按钮（WS_EX_APPWINDOW），
 *    让应用填满容器（对齐 Linux fill 效果）；
 * 4. SetParent；失败则恢复样式报 err（TS 侧转 error 提示"不支持嵌入"）；
 * 5. MoveWindow 铺满容器。 */
static void cmd_attach_app(const std::vector<std::string> &t)
{
    if (t.size() < 3) { reply("err bad-args"); return; }
    HWND container = parse_hwnd(t[1]);
    HWND appHwnd = parse_hwnd(t[2]);
    auto it = g_containers.find(container);
    if (it == g_containers.end() || !IsWindow(appHwnd)) { reply("err bad-hwnd"); return; }

    if (IsZoomed(appHwnd))
        ShowWindow(appHwnd, SW_RESTORE);

    LONG_PTR style = GetWindowLongPtrW(appHwnd, GWL_STYLE);
    LONG_PTR exStyle = GetWindowLongPtrW(appHwnd, GWL_EXSTYLE);
    it->second.origStyle = style;
    it->second.origExStyle = exStyle;

    LONG_PTR newStyle = (style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME |
                                   WS_MINIMIZEBOX | WS_MAXIMIZEBOX)) | WS_CHILD;
    SetWindowLongPtrW(appHwnd, GWL_STYLE, newStyle);
    SetWindowLongPtrW(appHwnd, GWL_EXSTYLE, exStyle & ~(WS_EX_APPWINDOW | WS_EX_DLGMODALFRAME));

    if (!SetParent(appHwnd, container)) {
        // 过继失败（个别应用/安全软件拦截）：恢复原样式，报由 TS 侧提示用户
        SetWindowLongPtrW(appHwnd, GWL_STYLE, style);
        SetWindowLongPtrW(appHwnd, GWL_EXSTYLE, exStyle);
        reply("err setparent-failed");
        return;
    }
    it->second.appHwnd = appHwnd;
    it->second.attached = true;

    RECT rc;
    if (GetClientRect(container, &rc))
        MoveWindow(appHwnd, 0, 0, rc.right, rc.bottom, TRUE);
    reply("ok");
}

/** find-window <rootPid> <minW> <minH> → ok <hwnd|0>
 * 遍历 rootPid 整个进程树的可见顶层窗口，取首个达标者 */
static void cmd_find_window(const std::vector<std::string> &t)
{
    if (t.size() < 4) { reply("err bad-args"); return; }
    DWORD pid = static_cast<DWORD>(strtoul(t[1].c_str(), nullptr, 10));
    FindCtx ctx;
    ctx.minW = atoi(t[2].c_str());
    ctx.minH = atoi(t[3].c_str());
    ctx.found = nullptr;
    std::unordered_set<DWORD> tree = collect_process_tree(pid);
    ctx.pids = &tree;
    if (!tree.empty())
        EnumWindows(find_window_cb, reinterpret_cast<LPARAM>(&ctx));
    reply_hwnd(ctx.found);
}

/** list-windows <rootPid>：列出进程树全部可见顶层窗口（调试用） */
static void cmd_list_windows(const std::vector<std::string> &t)
{
    if (t.size() < 2) { reply("err bad-args"); return; }
    DWORD pid = static_cast<DWORD>(strtoul(t[1].c_str(), nullptr, 10));
    std::unordered_set<DWORD> tree = collect_process_tree(pid);
    std::string out = "ok";
    // 复用枚举回调收集：逐个移除已找到者过于繁琐，这里直接内联枚举
    struct Collector {
        const std::unordered_set<DWORD> *pids;
        std::string *out;
    } c{&tree, &out};
    EnumWindows(
        [](HWND hwnd, LPARAM lp) -> BOOL {
            Collector *cc = reinterpret_cast<Collector *>(lp);
            DWORD p = 0;
            GetWindowThreadProcessId(hwnd, &p);
            if (cc->pids->count(p) && IsWindowVisible(hwnd)) {
                char buf[40];
                snprintf(buf, sizeof buf, " %llu",
                         static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(hwnd)));
                *cc->out += buf;
            }
            return TRUE;
        },
        reinterpret_cast<LPARAM>(&c));
    reply(out);
}

/** window-alive <hwnd> → ok 1|0（TS 看门狗判定"窗口消失=程序退出"） */
static void cmd_window_alive(const std::vector<std::string> &t)
{
    if (t.size() < 2) { reply("err bad-args"); return; }
    HWND hwnd = parse_hwnd(t[1]);
    reply(IsWindow(hwnd) ? "ok 1" : "ok 0");
}

/** close-window <hwnd>：WM_CLOSE 礼貌退出（带超时，卡死应用不会挂死 daemon）。
 * 一律 SendMessageTimeout(SMTO_ABORTIFHUNG)——跨进程同步消息是卡死牵连的主要来源 */
static void cmd_close_window(const std::vector<std::string> &t)
{
    if (t.size() < 2) { reply("err bad-args"); return; }
    HWND hwnd = parse_hwnd(t[1]);
    if (IsWindow(hwnd)) {
        DWORD_PTR res = 0;
        SendMessageTimeoutW(hwnd, WM_CLOSE, 0, 0, SMTO_ABORTIFHUNG, 500, &res);
    }
    reply("ok");
}

/** kill-tree <pid>：进程树全部 TerminateProcess */
static void cmd_kill_tree(const std::vector<std::string> &t)
{
    if (t.size() < 2) { reply("err bad-args"); return; }
    DWORD pid = static_cast<DWORD>(strtoul(t[1].c_str(), nullptr, 10));
    kill_process_tree(pid);
    reply("ok");
}

/** kill-app <hwnd> <pid>：两段式退出（对齐 Linux SIGTERM→SIGKILL 语义），
 * 一条命令做完减少协议往返：
 * 1. WM_CLOSE（500ms 超时）给应用保存状态的机会；
 * 2. 等待 1.5s 进程退出；
 * 3. 仍存活 → 进程树 TerminateProcess；
 * 4. 再等 1s 确认（TS 侧拿到响应时进程基本已死，可安全 destroy 容器） */
static void cmd_kill_app(const std::vector<std::string> &t)
{
    if (t.size() < 3) { reply("err bad-args"); return; }
    HWND hwnd = parse_hwnd(t[1]);
    DWORD pid = static_cast<DWORD>(strtoul(t[2].c_str(), nullptr, 10));

    if (IsWindow(hwnd)) {
        DWORD_PTR res = 0;
        SendMessageTimeoutW(hwnd, WM_CLOSE, 0, 0, SMTO_ABORTIFHUNG, 500, &res);
    }
    if (process_alive(pid)) {
        HANDLE h = OpenProcess(SYNCHRONIZE, FALSE, pid);
        if (h) {
            WaitForSingleObject(h, 1500);
            CloseHandle(h);
        }
        if (process_alive(pid)) {
            kill_process_tree(pid);
            h = OpenProcess(SYNCHRONIZE, FALSE, pid);
            if (h) {
                WaitForSingleObject(h, 1000);
                CloseHandle(h);
            }
        }
    }
    reply("ok");
}

/* ============================ 协议分发 ============================ */

/** 处理一行命令。quit 返回 true 表示退出主循环 */
static bool dispatch(const std::string &line)
{
    const std::vector<std::string> t = split_tokens(line);
    if (t.empty())
        return false;
    const std::string &cmd = t[0];

    if (cmd == "ping") {
        reply("ok");
    } else if (cmd == "version") {
        reply(std::string("ok ") + NEXUS_WIN_PANEL_VERSION);
    } else if (cmd == "caps") {
        // P1 无 scale 模块；P2 引入 DWM Thumbnail 后按 DwmIsCompositionEnabled 报 scale
        reply("ok features=none");
    } else if (cmd == "create-container") {
        cmd_create_container(t);
    } else if (cmd == "set-bounds") {
        cmd_set_bounds(t);
    } else if (cmd == "map") {
        cmd_map(t, true);
    } else if (cmd == "unmap") {
        cmd_map(t, false);
    } else if (cmd == "raise") {
        cmd_raise(t);
    } else if (cmd == "focus") {
        cmd_focus(t);
    } else if (cmd == "destroy") {
        cmd_destroy(t);
    } else if (cmd == "attach-app") {
        cmd_attach_app(t);
    } else if (cmd == "find-window") {
        cmd_find_window(t);
    } else if (cmd == "list-windows") {
        cmd_list_windows(t);
    } else if (cmd == "window-alive") {
        cmd_window_alive(t);
    } else if (cmd == "close-window") {
        cmd_close_window(t);
    } else if (cmd == "kill-tree") {
        cmd_kill_tree(t);
    } else if (cmd == "kill-app") {
        cmd_kill_app(t);
    } else if (cmd == "list-apps") {
        reply("ok " + apps_list_json_b64());
    } else if (cmd == "get-icon") {
        if (t.size() < 2) { reply("err bad-args"); return false; }
        std::vector<unsigned char> raw = b64_decode(t[1]);
        std::string lnkPath(raw.begin(), raw.end());
        std::string png = apps_get_icon_b64(lnkPath);
        if (png.empty())
            reply("err no-icon");
        else
            reply("ok " + png);
    } else if (cmd == "quit") {
        reply("bye");
        return true;
    } else {
        reply("err unknown-command");
    }
    return false;
}

/* ============================ 主循环 ============================ */

int main(void)
{
    // 崩溃不弹系统对话框（服务端进程，静默失败由 TS 侧感知）
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    init_dpi_awareness();
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

    g_hinst = GetModuleHandleW(nullptr);
    if (!register_container_class()) {
        fprintf(stderr, "[win-panel] 容器窗口类注册失败\n");
        return 1;
    }
    if (!apps_gdiplus_init())
        fprintf(stderr, "[win-panel] GDI+ 初始化失败（图标功能不可用）\n");

    HANDLE hStdin = GetStdHandle(STD_INPUT_HANDLE);
    std::string linebuf;
    bool quit = false;

    fprintf(stderr, "[win-panel] daemon 启动 version=%s\n", NEXUS_WIN_PANEL_VERSION);

    while (!quit) {
        // 同时等待 stdin 管道数据与窗口消息（容器 WndProc 需要消息泵）
        DWORD wr = MsgWaitForMultipleObjects(1, &hStdin, FALSE, INFINITE, QS_ALLINPUT);
        if (wr == WAIT_OBJECT_0) {
            char buf[4096];
            DWORD n = 0;
            if (!ReadFile(hStdin, buf, sizeof buf, &n, nullptr) || n == 0)
                break; // EOF（TS 侧关闭管道/退出）
            linebuf.append(buf, n);
            // 逐行分发（容忍 \r\n）
            size_t pos;
            while ((pos = linebuf.find('\n')) != std::string::npos) {
                std::string line = linebuf.substr(0, pos);
                linebuf.erase(0, pos + 1);
                while (!line.empty() && line.back() == '\r')
                    line.pop_back();
                if (!line.empty())
                    quit = dispatch(line);
                if (quit)
                    break;
            }
        } else if (wr == WAIT_OBJECT_0 + 1) {
            MSG msg;
            while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
                if (msg.message == WM_QUIT) {
                    quit = true;
                    break;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        } else {
            break; // 等待失败，退出由 TS 侧重启
        }
    }

    apps_gdiplus_shutdown();
    CoUninitialize();
    return 0;
}
