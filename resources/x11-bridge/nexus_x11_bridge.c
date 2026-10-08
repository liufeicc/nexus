/*
 * nexus_x11_bridge.c —— X11 窗口桥接 daemon（缩放嵌入版）
 *
 * 用途：在 Electron 主窗口内创建/移动/缩放/显隐"容器子窗口"，
 *       供 Xephyr 虚拟显示器嵌入，把桌面程序画面显示在 Nexus 应用面板区域。
 *       缩放模式（full 变体）：Xephyr 挂屏外 scratch 窗口按大虚拟分辨率运行，
 *       本 daemon 将画面缩放合成进容器窗口，并把容器输入换算注入虚拟显示器。
 *
 * 为什么必须是常驻 daemon：
 *   X11 窗口资源绑定到创建它的 X 连接；一次性进程退出后连接关闭，
 *   其创建的窗口会被 X 服务器销毁。容器窗口必须由常驻连接持有，
 *   因此本程序以 daemon 形式运行，通过 stdin/stdout 行协议收发命令。
 *
 * 事件循环：select() 单线程监听 stdin + X 连接 fd + 33ms timerfd
 *   （Xlib 非线程安全，不 fork 不引线程；X 事件返回即抽干防饿死）。
 *
 * 行协议（每行一条命令，空格分隔；每条命令回一行响应）：
 *   ping                                 → ok
 *   caps                                 → ok features=scale|none（缩放能力，每次 launch 现查）
 *   create <parent> <x> <y> <w> <h>      → ok <新窗口XID>   | err <原因>
 *   create-top <w> <h>                   → ok <XID>（屏外顶层 scratch：override_redirect，创建即 map）
 *   moveresize <xid> <x> <y> <w> <h>     → ok
 *   map <xid>                            → ok
 *   unmap <xid>                          → ok
 *   raise <xid>                          → ok
 *   focus <xid>                          → ok
 *   destroy <xid>                        → ok
 *   children <xid>                       → ok <子XID...>
 *   root-geometry                        → ok <宽> <高>（主显示根窗口尺寸，作 -screen 上限）
 *   screen-resize <display> <宽> <高>    → ok（RANDR 调整虚拟显示器分辨率，即时连接）
 *   fill-window <display>                → ok <xid>（虚拟显示器内首个主窗口铺满屏幕）
 *   scale-start <container> <src> <disp> → ok | err <原因>（注册缩放会话：重定向+合成+输入转发）
 *   scale-update <container> <pw> <ph>   → ok（面板尺寸变化，下 tick 重新 letterbox）
 *   scale-stop <container>               → ok（释放会话，幂等）
 *   scale-loupe <container>              → ok loupe=0|1|2（三态循环：关→跟随→固定，与中键等效）
 *   quit                                 → bye（退出）
 *
 * 编译 full：gcc -O2 -o nexus-x11-bridge nexus_x11_bridge.c nexus_x11_bridge_scale.c \
 *             -lX11 -lXrandr -lXcomposite -lXrender -lXtst -lm
 * 编译 lite：gcc -O2 -DNEXUS_NO_SCALE -o nexus-x11-bridge nexus_x11_bridge.c -lX11 -lXrandr
 *   （lite = 缺 Xcomposite/Xtst 头文件时的降级变体，缩放命令回 err no-scale-support）
 *
 * 返回值：0 正常退出；3 无法打开 X 连接（X11 不可用）。
 */
#include <X11/Xlib.h>
#include <X11/extensions/Xrandr.h>
#include <errno.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/select.h>
#include <unistd.h>

#include "nexus_x11_bridge_scale.h"

/* X 错误处理：记录而不退出，避免单个 BadWindow 拖垮 daemon */
int g_x_error = 0;
static int handle_x_error(Display *dpy, XErrorEvent *ev) {
    (void)dpy;
    (void)ev;
    g_x_error = 1;
    return 0;
}

/* M-6：最近一次输入事件的时间戳。focus 命令设置输入焦点时优先使用它，
 * 部分 WM/焦点策略会忽略 CurrentTime 的焦点请求；时间戳过旧只会被
 * X 服务器按协议安全忽略，不会出错。由 scale 模块抽干事件时更新；
 * lite 变体无事件泵，保持 0 → 回退 CurrentTime（与旧行为一致） */
Time g_last_event_time = 0;

/* 每个虚拟显示器"首个顶层窗口"记忆表（用于 fill-window 铺满主窗口） */
#define FILL_TABLE_MAX 16
typedef struct {
    char name[64];
    unsigned long xid;
} FillEntry;
static FillEntry g_fill_table[FILL_TABLE_MAX];

static unsigned long fill_get(const char *name) {
    for (int i = 0; i < FILL_TABLE_MAX; i++) {
        if (g_fill_table[i].name[0] && strcmp(g_fill_table[i].name, name) == 0) {
            return g_fill_table[i].xid;
        }
    }
    return 0;
}

static void fill_set(const char *name, unsigned long xid) {
    /* M-5：xid=0 表示作废旧记忆，同时清空 name 释放槽位。
     * 旧实现作废只置 xid 不释放槽位，daemon 生命周期内累计使用超过
     * FILL_TABLE_MAX 个不同 display 名后表满，新 display 无法登记，
     * fill-window 退化为"认领首个可见窗口"（记忆失效）。
     * 面板关闭后 display 号会被复用，释放槽位保证表容量只与"同时活跃"的规模相关 */
    if (xid == 0) {
        for (int i = 0; i < FILL_TABLE_MAX; i++) {
            if (g_fill_table[i].name[0] && strcmp(g_fill_table[i].name, name) == 0) {
                g_fill_table[i].name[0] = 0;
                return;
            }
        }
        return; /* 作废不存在的记忆：无需占槽 */
    }
    for (int i = 0; i < FILL_TABLE_MAX; i++) {
        if (g_fill_table[i].name[0] == 0 || strcmp(g_fill_table[i].name, name) == 0) {
            snprintf(g_fill_table[i].name, sizeof(g_fill_table[i].name), "%s", name);
            g_fill_table[i].xid = xid;
            return;
        }
    }
}

/* 发送一行响应并刷新（scale 模块共用） */
void reply(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    vfprintf(stdout, fmt, ap);
    va_end(ap);
    fputc('\n', stdout);
    fflush(stdout);
}

/* 处理一条行协议命令；返回 1 表示请求退出（quit） */
static int handle_line(Display *dpy, const char *line) {
    char cmd[32] = {0};
    sscanf(line, "%31s", cmd);
    g_x_error = 0;

    if (strcmp(cmd, "ping") == 0) {
        reply("ok");

    } else if (strcmp(cmd, "caps") == 0) {
        scale_cmd_caps(dpy);

    } else if (strcmp(cmd, "create") == 0) {
        unsigned long parent = 0;
        int x = 0, y = 0; unsigned int w = 1, h = 1;
        if (sscanf(line, "%*s %lu %d %d %u %u", &parent, &x, &y, &w, &h) != 5) {
            reply("err bad-args");
            return 0;
        }
        if (w < 1) w = 1;
        if (h < 1) h = 1;
        Window win = XCreateSimpleWindow(dpy, (Window)parent, x, y, w, h, 0, 0, 0);
        if (g_x_error) { reply("err create-failed"); return 0; }
        XMapWindow(dpy, win);
        XFlush(dpy);
        reply("ok %lu", (unsigned long)win);

    } else if (strcmp(cmd, "create-top") == 0) {
        /* 屏外顶层 scratch 窗口：override_redirect（防 WM 加框/摆位），创建即 map
           （保持 viewable，Xephyr 输出窗口才有 backing pixmap 可 name） */
        unsigned int w = 1, h = 1;
        if (sscanf(line, "%*s %u %u", &w, &h) != 2) {
            reply("err bad-args");
            return 0;
        }
        if (w < 1) w = 1;
        if (h < 1) h = 1;
        int scr = DefaultScreen(dpy);
        XSetWindowAttributes attrs;
        attrs.override_redirect = True;
        attrs.background_pixel = BlackPixelOfScreen(DefaultScreenOfDisplay(dpy));
        Window win = XCreateWindow(dpy, RootWindow(dpy, scr), -32000, -32000, w, h, 0,
                                   DefaultDepth(dpy, scr), InputOutput,
                                   DefaultVisual(dpy, scr),
                                   CWOverrideRedirect | CWBackPixel, &attrs);
        if (g_x_error) { reply("err create-failed"); return 0; }
        XMapWindow(dpy, win);
        XFlush(dpy);
        reply("ok %lu", (unsigned long)win);

    } else if (strcmp(cmd, "moveresize") == 0) {
        unsigned long xid = 0;
        int x = 0, y = 0; unsigned int w = 1, h = 1;
        if (sscanf(line, "%*s %lu %d %d %u %u", &xid, &x, &y, &w, &h) != 5) {
            reply("err bad-args");
            return 0;
        }
        if (w < 1) w = 1;
        if (h < 1) h = 1;
        XMoveResizeWindow(dpy, (Window)xid, x, y, w, h);
        XFlush(dpy);
        reply("ok");

    } else if (strcmp(cmd, "map") == 0) {
        unsigned long xid = 0;
        sscanf(line, "%*s %lu", &xid);
        XMapWindow(dpy, (Window)xid);
        XFlush(dpy);
        scale_set_mapped(dpy, (Window)xid, 1);
        reply("ok");

    } else if (strcmp(cmd, "unmap") == 0) {
        unsigned long xid = 0;
        sscanf(line, "%*s %lu", &xid);
        XUnmapWindow(dpy, (Window)xid);
        XFlush(dpy);
        scale_set_mapped(dpy, (Window)xid, 0);
        reply("ok");

    } else if (strcmp(cmd, "raise") == 0) {
        unsigned long xid = 0;
        sscanf(line, "%*s %lu", &xid);
        XRaiseWindow(dpy, (Window)xid);
        XFlush(dpy);
        reply("ok");

    } else if (strcmp(cmd, "focus") == 0) {
        unsigned long xid = 0;
        sscanf(line, "%*s %lu", &xid);
        XRaiseWindow(dpy, (Window)xid);
        /* M-6：优先用最近事件时间戳（部分 WM 忽略 CurrentTime 焦点请求） */
        XSetInputFocus(dpy, (Window)xid, RevertToParent,
                       g_last_event_time ? g_last_event_time : CurrentTime);
        XFlush(dpy);
        reply("ok");

    } else if (strcmp(cmd, "destroy") == 0) {
        unsigned long xid = 0;
        sscanf(line, "%*s %lu", &xid);
        XDestroyWindow(dpy, (Window)xid);
        XFlush(dpy);
        reply("ok");

    } else if (strcmp(cmd, "children") == 0) {
        /* 列出指定窗口的子窗口 XID（单行：ok x1 x2 ...），用于定位嵌入的 Xephyr 屏幕窗口 */
        unsigned long parent = 0;
        sscanf(line, "%*s %lu", &parent);
        Window r2, p2, *kids = NULL;
        unsigned int n = 0;
        g_x_error = 0;
        char buf[1024] = "ok";
        if (XQueryTree(dpy, (Window)parent, &r2, &p2, &kids, &n) && !g_x_error) {
            for (unsigned int i = 0; i < n; i++) {
                char tmp[32];
                snprintf(tmp, sizeof(tmp), " %lu", (unsigned long)kids[i]);
                if (strlen(buf) + strlen(tmp) < sizeof(buf)) strcat(buf, tmp);
            }
            if (kids) XFree(kids);
        }
        reply("%s", buf);

    } else if (strcmp(cmd, "root-geometry") == 0) {
        /* 主显示（daemon 默认连接）的根窗口尺寸，作为 -screen 上限 */
        int scr = DefaultScreen(dpy);
        reply("ok %d %d", DisplayWidth(dpy, scr), DisplayHeight(dpy, scr));

    } else if (strcmp(cmd, "screen-resize") == 0) {
        /* 即时连接虚拟显示器并用 RANDR 调整其屏幕尺寸（只开一次，避免缓存失效连接） */
        char dname[64] = {0};
        unsigned int w = 0, h = 0;
        if (sscanf(line, "%*s %63s %u %u", dname, &w, &h) != 3 || w < 1 || h < 1) {
            reply("err bad-args");
            return 0;
        }
        Display *vd = XOpenDisplay(dname);
        if (!vd) { reply("err open-display"); return 0; }
        int event_base = 0, error_base = 0;
        if (!XRRQueryExtension(vd, &event_base, &error_base)) {
            XCloseDisplay(vd);
            reply("err no-randr");
            return 0;
        }
        int scr = DefaultScreen(vd);
        XRRSetScreenSize(vd, RootWindow(vd, scr), (int)w, (int)h,
                         DisplayWidthMM(vd, scr), DisplayHeightMM(vd, scr));
        XSync(vd, False);
        XCloseDisplay(vd);
        reply(g_x_error ? "err set-screen-size" : "ok");

    } else if (strcmp(cmd, "fill-window") == 0) {
        /* 将虚拟显示器内"首个顶层窗口"铺满屏幕（无 WM 环境的替代方案）；
           同时把超出屏幕的次级顶层窗口（文件选择框等对话框）钳制到屏幕内并居中，
           避免无 WM 时对话框被裁切且无法拖动的问题 */
        char dname[64] = {0};
        if (sscanf(line, "%*s %63s", dname) != 1) { reply("err bad-args"); return 0; }
        Display *vd = XOpenDisplay(dname);
        if (!vd) { reply("err open-display"); return 0; }
        int scr = DefaultScreen(vd);
        Window root = RootWindow(vd, scr);
        unsigned int rw = (unsigned int)DisplayWidth(vd, scr);
        unsigned int rh = (unsigned int)DisplayHeight(vd, scr);
        Window r2, p2, *children = NULL;
        unsigned int n = 0;
        unsigned long target = 0;
        g_x_error = 0;
        if (XQueryTree(vd, root, &r2, &p2, &children, &n) && !g_x_error) {
            unsigned long remembered = fill_get(dname);
            /* 1) 记忆的主窗口仍可见 → 续用它 */
            if (remembered) {
                for (unsigned int i = 0; i < n; i++) {
                    XWindowAttributes wa;
                    if (children[i] == (Window)remembered &&
                        XGetWindowAttributes(vd, children[i], &wa) &&
                        wa.map_state == IsViewable) {
                        target = remembered;
                        break;
                    }
                }
                if (!target) fill_set(dname, 0); /* 主窗口已销毁，作废旧记忆 */
            }
            /* 2) 否则认领首个可见顶层窗口并记忆 */
            if (!target) {
                for (unsigned int i = 0; i < n; i++) {
                    XWindowAttributes wa;
                    if (!XGetWindowAttributes(vd, children[i], &wa)) continue;
                    if (wa.map_state != IsViewable || wa.override_redirect) continue;
                    target = (unsigned long)children[i];
                    fill_set(dname, target);
                    break;
                }
            }
        }
        if (target) {
            XMoveResizeWindow(vd, (Window)target, 0, 0, rw, rh);
        }
        /* 3) 次级顶层窗口（对话框）：超出屏幕 → 钳制到屏幕尺寸并居中 */
        if (children) {
            for (unsigned int i = 0; i < n; i++) {
                if ((unsigned long)children[i] == target) continue;
                XWindowAttributes wa;
                if (!XGetWindowAttributes(vd, children[i], &wa)) continue;
                if (wa.map_state != IsViewable || wa.override_redirect) continue;
                if ((unsigned int)wa.width > rw || (unsigned int)wa.height > rh) {
                    int nw = (unsigned int)wa.width > rw ? (int)rw : wa.width;
                    int nh = (unsigned int)wa.height > rh ? (int)rh : wa.height;
                    XMoveResizeWindow(vd, children[i],
                                      ((int)rw - nw) / 2, ((int)rh - nh) / 2,
                                      (unsigned int)nw, (unsigned int)nh);
                }
            }
            XFree(children);
        }
        XFlush(vd);
        XCloseDisplay(vd);
        reply("ok %lu", target);

    } else if (strcmp(cmd, "scale-start") == 0) {
        scale_cmd_start(dpy, line);

    } else if (strcmp(cmd, "scale-update") == 0) {
        scale_cmd_update(dpy, line);

    } else if (strcmp(cmd, "scale-stop") == 0) {
        scale_cmd_stop(dpy, line);

    } else if (strcmp(cmd, "scale-loupe") == 0) {
        scale_cmd_loupe(dpy, line);

    } else if (strcmp(cmd, "quit") == 0) {
        reply("bye");
        return 1;

    } else {
        reply("err unknown-cmd");
    }
    return 0;
}

int main(void) {
    Display *dpy = XOpenDisplay(NULL);
    if (!dpy) {
        fprintf(stderr, "cannot open X display\n");
        return 3;
    }
    XSetErrorHandler(handle_x_error);

    /* 缩放能力探测与合成定时器（lite 变体 / 环境不支持时 tfd=-1，退化为纯行协议） */
    scale_env_init(dpy);
    int tfd = scale_timer_fd();
    int xfd = ConnectionNumber(dpy);
    int events_on = tfd >= 0; /* 仅 full 变体需要抽干 X 事件 */

    /* 行缓冲状态机替代 fgets（select 下可能一次读到半行，需拼接） */
    char buf[4096];
    size_t buflen = 0;

    for (;;) {
        fd_set rf;
        FD_ZERO(&rf);
        FD_SET(STDIN_FILENO, &rf);
        int mx = STDIN_FILENO;
        if (events_on) { FD_SET(xfd, &rf); if (xfd > mx) mx = xfd; }
        if (tfd >= 0) { FD_SET(tfd, &rf); if (tfd > mx) mx = tfd; }
        if (select(mx + 1, &rf, NULL, NULL, NULL) < 0) {
            if (errno == EINTR) continue;
            break;
        }
        /* X 事件必须立即抽干，否则 fd 持续可读会饿死 stdin/timer */
        if (events_on && FD_ISSET(xfd, &rf)) {
            scale_drain_events(dpy);
        }
        /* 合成 tick */
        if (tfd >= 0 && FD_ISSET(tfd, &rf)) {
            uint64_t expirations = 0;
            if (read(tfd, &expirations, sizeof(expirations)) > 0) {
                scale_tick(dpy);
            }
        }
        /* 行协议 */
        if (FD_ISSET(STDIN_FILENO, &rf)) {
            ssize_t r = read(STDIN_FILENO, buf + buflen, sizeof(buf) - 1 - buflen);
            if (r <= 0) break; /* stdin EOF / 读错误 → 退出 */
            buflen += (size_t)r;
            buf[buflen] = '\0';
            char *cur = buf, *nl;
            while ((nl = strchr(cur, '\n')) != NULL) {
                *nl = '\0';
                cur[strcspn(cur, "\r")] = '\0';
                if (cur[0]) {
                    if (handle_line(dpy, cur)) {
                        scale_dispose(dpy);
                        XCloseDisplay(dpy);
                        return 0;
                    }
                }
                cur = nl + 1;
            }
            size_t consumed = (size_t)(cur - buf);
            memmove(buf, cur, buflen - consumed + 1);
            buflen -= consumed;
            if (buflen >= sizeof(buf) - 1) buflen = 0; /* 超长坏行保护 */
        }
    }

    scale_dispose(dpy);
    XCloseDisplay(dpy);
    return 0;
}
