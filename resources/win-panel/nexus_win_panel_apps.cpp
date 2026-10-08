/**
 * nexus-win-panel 应用枚举模块实现
 *
 * 实现逻辑（与 Linux desktop-entry.service.ts 语义对齐）：
 * 1. 递归扫描两个开始菜单目录（系统级 ProgramData 优先，用户级 APPDATA 次之）；
 * 2. 每个 .lnk 经 IShellLinkW + IPersistFile 解析 TargetPath/Arguments/Description/IconLocation；
 * 3. 过滤不可嵌入的条目：
 *    - 无目标（shell::: CLSID 等特殊快捷方式）；
 *    - UWP/打包应用（目标或参数含 shell:AppsFolder、ms-settings:，窗口会话隔离无法 SetParent）；
 *    - 控制台程序（读目标 PE 头 OptionalHeader.Subsystem != GUI，嵌入只会得到黑框）；
 *    - 系统工具黑名单（control.exe/rundll32.exe）与卸载器（名称含 unins）；
 *    - 重复（同一 target+args 先扫到者胜，系统级优先）；
 * 4. exec = target+arguments 拼串（目标含空格时加引号），与 TS 侧白名单
 *    归一化比对、引号感知分词（splitExec）作用在同一字符串上，语义闭环；
 * 5. appId = .lnk 全路径（跨目录唯一、rescan 稳定；get-icon 据此重新定位 lnk）。
 *
 * 图标：GetIconLocation 指示的 (文件,索引) → ExtractIconExW（索引≥0）
 * 或 LoadLibraryEx+LoadImage（索引<0，即负资源 ID）→ 失败回退目标文件首图标
 * → GDI+ 编码 32px PNG → base64。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <objbase.h>
#include <gdiplus.h>

#include <cstdio>
#include <cstring>
#include <cwchar>
#include <algorithm>
#include <string>
#include <unordered_set>
#include <vector>

#include "nexus_win_panel_apps.h"

/* ---------- 小工具 ---------- */

/** GDI+ 会话（图标编码用）；主循环起止处各调一次 */
static ULONG_PTR g_gp_token = 0;

bool apps_gdiplus_init()
{
    Gdiplus::GdiplusStartupInput input;
    return Gdiplus::GdiplusStartup(&g_gp_token, &input, nullptr) == Gdiplus::Ok;
}

void apps_gdiplus_shutdown()
{
    if (g_gp_token) {
        Gdiplus::GdiplusShutdown(g_gp_token);
        g_gp_token = 0;
    }
}

/** 宽串转小写（用于不区分大小写的判定） */
static std::wstring wlower(const std::wstring &s)
{
    std::wstring r = s;
    std::transform(r.begin(), r.end(), r.begin(), ::towlower);
    return r;
}

/** 取路径的文件名部分 */
static std::wstring wbasename(const std::wstring &path)
{
    size_t pos = path.find_last_of(L"\\/");
    return pos == std::wstring::npos ? path : path.substr(pos + 1);
}

/** JSON 字符串转义（双引号/反斜杠/控制字符） */
static std::string json_escape(const std::string &s)
{
    std::string out;
    out.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (static_cast<unsigned char>(c) < 0x20) {
                char buf[8];
                snprintf(buf, sizeof buf, "\\u%04x", static_cast<unsigned char>(c));
                out += buf;
            } else {
                out += c;
            }
        }
    }
    return out;
}

/* ---------- .lnk 扫描与解析 ---------- */

/** 递归收集目录下全部 .lnk 文件（开始菜单存在文件夹层级） */
static void scan_dir(const std::wstring &dir, std::vector<std::wstring> &lnks)
{
    WIN32_FIND_DATAW fd;
    std::wstring pattern = dir + L"\\*";
    HANDLE h = FindFirstFileW(pattern.c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE)
        return;
    do {
        std::wstring name = fd.cFileName;
        if (name == L"." || name == L"..")
            continue;
        std::wstring full = dir + L"\\" + name;
        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            scan_dir(full, lnks);
        } else if (name.size() > 4 && _wcsicmp(name.c_str() + name.size() - 4, L".lnk") == 0) {
            lnks.push_back(full);
        }
    } while (FindNextFileW(h, &fd));
    FindClose(h);
}

/** 解析单个 .lnk：取目标路径/参数/描述。目标为空视为不可用返回 false */
static bool load_lnk(const std::wstring &path, std::wstring &target,
                     std::wstring &args, std::wstring &desc)
{
    target.clear();
    args.clear();
    desc.clear();

    IShellLinkW *link = nullptr;
    if (CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER,
                         IID_IShellLinkW, reinterpret_cast<void **>(&link)) != S_OK)
        return false;

    bool ok = false;
    IPersistFile *pf = nullptr;
    if (link->QueryInterface(IID_IPersistFile, reinterpret_cast<void **>(&pf)) == S_OK) {
        if (pf->Load(path.c_str(), STGM_READ) == S_OK) {
            wchar_t t[MAX_PATH] = {0};
            wchar_t a[2048] = {0};
            wchar_t d[512] = {0};
            if (SUCCEEDED(link->GetPath(t, MAX_PATH, nullptr, SLGP_RAWPATH)) && t[0]) {
                target = t;
                link->GetArguments(a, 2048);
                args = a;
                link->GetDescription(d, 512);
                desc = d;
                ok = true;
            }
        }
        pf->Release();
    }
    link->Release();
    return ok;
}

/** 判定 PE 文件是否为 GUI 子系统（Subsystem==2）。
 * 实现：读文件前 4KB，按 DOS 头 e_lfanew 定位 NT 头取 OptionalHeader.Subsystem。
 * 文件不存在/不可读/非 PE 一律返回 false（对应条目被过滤，避免列表出现启动即失败项） */
static bool pe_is_gui_subsystem(const std::wstring &path)
{
    HANDLE f = CreateFileW(path.c_str(), GENERIC_READ,
                           FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                           nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (f == INVALID_HANDLE_VALUE)
        return false;

    unsigned char buf[4096];
    DWORD got = 0;
    bool gui = false;
    if (ReadFile(f, buf, sizeof buf, &got, nullptr) && got >= sizeof(IMAGE_DOS_HEADER)) {
        const IMAGE_DOS_HEADER *dos = reinterpret_cast<const IMAGE_DOS_HEADER *>(buf);
        if (dos->e_magic == IMAGE_DOS_SIGNATURE && dos->e_lfanew > 0 &&
            static_cast<DWORD>(dos->e_lfanew) + sizeof(IMAGE_NT_HEADERS64) <= got) {
            const IMAGE_NT_HEADERS64 *nt =
                reinterpret_cast<const IMAGE_NT_HEADERS64 *>(buf + dos->e_lfanew);
            if (nt->Signature == IMAGE_NT_SIGNATURE)
                gui = nt->OptionalHeader.Subsystem == IMAGE_SUBSYSTEM_WINDOWS_GUI;
        }
    }
    CloseHandle(f);
    return gui;
}

/** 开始菜单目录：系统级（先扫，对齐 Linux 系统级优先）+ 当前用户级 */
static std::vector<std::wstring> start_menu_dirs()
{
    std::vector<std::wstring> dirs;
    wchar_t buf[MAX_PATH];
    DWORD n = GetEnvironmentVariableW(L"ProgramData", buf, MAX_PATH);
    if (n > 0 && n < MAX_PATH)
        dirs.push_back(std::wstring(buf) + L"\\Microsoft\\Windows\\Start Menu\\Programs");
    n = GetEnvironmentVariableW(L"APPDATA", buf, MAX_PATH);
    if (n > 0 && n < MAX_PATH)
        dirs.push_back(std::wstring(buf) + L"\\Microsoft\\Windows\\Start Menu\\Programs");
    return dirs;
}

std::string apps_list_json_b64()
{
    std::string json = "{\"apps\":[";
    std::unordered_set<std::string> seen; // target+args 去重（先扫到者胜）
    bool first = true;

    for (const std::wstring &dir : start_menu_dirs()) {
        std::vector<std::wstring> lnks;
        scan_dir(dir, lnks);
        for (const std::wstring &lnk : lnks) {
            std::wstring target, args, desc;
            if (!load_lnk(lnk, target, args, desc))
                continue;

            const std::wstring lt = wlower(target);
            const std::wstring la = wlower(args);

            // UWP/打包应用：窗口在独立会话，SetParent 必失败
            if (lt.find(L"shell:appsfolder") != std::wstring::npos ||
                la.find(L"shell:appsfolder") != std::wstring::npos ||
                lt.rfind(L"ms-settings:", 0) == 0 || lt.rfind(L"shell:", 0) == 0)
                continue;

            // 系统工具与卸载器黑名单（保守起步）
            const std::wstring base = wlower(wbasename(target));
            if (base == L"control.exe" || base == L"rundll32.exe")
                continue;
            if (base.find(L"unins") != std::wstring::npos)
                continue;

            // 控制台程序无窗口可嵌；目标不存在同样过滤
            if (!pe_is_gui_subsystem(target))
                continue;

            // 去重键：target+args 全小写
            const std::string key = utf16_to_utf8(lt) + " " + utf16_to_utf8(la);
            if (seen.count(key))
                continue;
            seen.insert(key);

            // 展示名 = lnk 文件名去扩展名（描述仅作兜底不使用，保持与图标/名称来源一致）
            std::wstring name = wbasename(lnk);
            if (name.size() > 4 && _wcsicmp(name.c_str() + name.size() - 4, L".lnk") == 0)
                name = name.substr(0, name.size() - 4);

            // exec 拼串：目标含空格则加引号（与 splitExec 引号感知分词配套）
            const std::string t8 = utf16_to_utf8(target);
            std::string a8 = utf16_to_utf8(args);
            // 去首尾空白，避免白名单归一化比对受多余空白干扰
            while (!a8.empty() && (a8.back() == ' ' || a8.back() == '\t'))
                a8.pop_back();
            size_t astart = a8.find_first_not_of(" \t");
            if (astart == std::string::npos)
                a8.clear();
            else if (astart > 0)
                a8 = a8.substr(astart);

            std::string exec;
            if (t8.find(' ') != std::string::npos)
                exec = "\"" + t8 + "\"";
            else
                exec = t8;
            if (!a8.empty())
                exec += " " + a8;

            if (!first)
                json += ",";
            first = false;
            json += "{\"appId\":\"" + json_escape(utf16_to_utf8(lnk)) + "\""
                  + ",\"name\":\"" + json_escape(utf16_to_utf8(name)) + "\""
                  + ",\"exec\":\"" + json_escape(exec) + "\"}";
        }
    }

    json += "]}";
    return b64_encode(reinterpret_cast<const unsigned char *>(json.data()), json.size());
}

/* ---------- 图标提取 ---------- */

/** 查找 PNG 编码器 CLSID（GDI+ 标准做法） */
static bool get_png_clsid(CLSID *clsid)
{
    UINT num = 0, size = 0;
    Gdiplus::GetImageEncodersSize(&num, &size);
    if (size == 0)
        return false;
    std::vector<unsigned char> buf(size);
    auto *encoders = reinterpret_cast<Gdiplus::ImageCodecInfo *>(buf.data());
    if (Gdiplus::GetImageEncoders(num, size, encoders) != Gdiplus::Ok)
        return false;
    for (UINT i = 0; i < num; i++) {
        if (wcscmp(encoders[i].MimeType, L"image/png") == 0) {
            *clsid = encoders[i].Clsid;
            return true;
        }
    }
    return false;
}

/** HICON → 32px PNG → base64。失败返回空串 */
static bool icon_to_png_b64(HICON hIcon, std::string &out_b64)
{
    out_b64.clear();
    Gdiplus::Bitmap *bmp = Gdiplus::Bitmap::FromHICON(hIcon);
    if (!bmp)
        return false;

    bool ok = false;
    IStream *stream = nullptr;
    if (CreateStreamOnHGlobal(nullptr, TRUE, &stream) == S_OK) {
        CLSID pngClsid;
        if (get_png_clsid(&pngClsid) && bmp->Save(stream, &pngClsid, nullptr) == Gdiplus::Ok) {
            HGLOBAL hglobal = nullptr;
            if (GetHGlobalFromStream(stream, &hglobal) == S_OK && hglobal) {
                size_t len = GlobalSize(hglobal);
                void *ptr = GlobalLock(hglobal);
                if (ptr && len > 0) {
                    out_b64 = b64_encode(static_cast<const unsigned char *>(ptr), len);
                    ok = !out_b64.empty();
                }
                if (ptr)
                    GlobalUnlock(hglobal);
            }
        }
        stream->Release();
    }
    delete bmp;
    return ok;
}

/** 按 lnk 的 IconLocation 加载图标。
 * 索引≥0：ExtractIconExW（取大图标档，通常 32x32）；
 * 索引<0：负资源 ID，经 LoadLibraryEx(数据文件方式)+LoadImage 加载；
 * 均失败回退目标文件首图标。 */
static HICON load_lnk_icon(IShellLinkW *link, const std::wstring &target)
{
    wchar_t ipath[MAX_PATH] = {0};
    int idx = 0;
    link->GetIconLocation(ipath, MAX_PATH, &idx);
    std::wstring path = ipath;
    if (path.empty()) {
        path = target;
        idx = 0;
    }
    if (path.empty())
        return nullptr;

    HICON hIcon = nullptr;
    if (idx >= 0) {
        ExtractIconExW(path.c_str(), idx, &hIcon, nullptr, 1);
    } else {
        HMODULE hm = LoadLibraryExW(path.c_str(), nullptr,
                                    LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE);
        if (hm) {
            hIcon = static_cast<HICON>(LoadImageW(hm, MAKEINTRESOURCEW(-idx), IMAGE_ICON,
                                                  32, 32, LR_DEFAULTSIZE));
            FreeLibrary(hm);
        }
    }
    if (!hIcon && !target.empty())
        ExtractIconExW(target.c_str(), 0, &hIcon, nullptr, 1);
    return hIcon;
}

std::string apps_get_icon_b64(const std::string &lnk_path_utf8)
{
    std::string out;
    const std::wstring lnk = utf8_to_utf16(lnk_path_utf8);

    IShellLinkW *link = nullptr;
    if (CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER,
                         IID_IShellLinkW, reinterpret_cast<void **>(&link)) != S_OK)
        return out;

    IPersistFile *pf = nullptr;
    if (link->QueryInterface(IID_IPersistFile, reinterpret_cast<void **>(&pf)) == S_OK) {
        if (pf->Load(lnk.c_str(), STGM_READ) == S_OK) {
            wchar_t t[MAX_PATH] = {0};
            link->GetPath(t, MAX_PATH, nullptr, SLGP_RAWPATH);
            HICON hIcon = load_lnk_icon(link, t);
            if (hIcon) {
                icon_to_png_b64(hIcon, out);
                DestroyIcon(hIcon);
            }
        }
        pf->Release();
    }
    link->Release();
    return out;
}
