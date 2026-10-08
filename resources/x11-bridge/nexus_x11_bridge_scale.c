/*
 * nexus_x11_bridge_scale.c —— 缩放嵌入模块（full 变体编译）
 *
 * 职责：把屏外 scratch 窗口下的 Xephyr 输出窗口（大虚拟分辨率）画面，
 *       经 XComposite 手动重定向 + XRender transform 缩放合成到面板容器窗口；
 *       同时把容器上的指针/键盘事件按同一比例换算后，用 XTest 注入虚拟显示器 :N。
 *
 * 关键语义：
 * - 合成：33ms timerfd tick 无条件合成（letterbox 居中）；tick 内 XGetGeometry
 *   比对源窗口尺寸检测 RANDR 变化 → 重建 NameWindowPixmap（旧 pixmap 变悬空旧帧）。
 * - 输入：指针永在容器上，屏外 Xephyr 窗口收不到宿主事件 → XTest 是唯一输入源，
 *   不存在双重注入；键盘仅在容器持有宿主焦点时转发，修饰键按 held_mods diff 同步。
 * - 光标：嵌套光标不进帧缓冲（Xephyr XDefineCursor 于输出窗口），容器保留默认箭头
 *   （例外：放大镜固定模式拖拽边框时临时显示方向光标）。
 * - 放大镜三态循环（中键 / scale-loupe 命令各推进一次）：关 → 跟随 → 固定 → 关。
 *   跟随=白边框，固定=橙边框；固定后取景冻结、边框可拖拽改大小；
 *   透镜内点击按 1:1 映射注入（"所见即所点"保持）。
 */
#ifndef NEXUS_NO_SCALE

#include <X11/XKBlib.h>
#include <X11/Xlib.h>
#include <X11/cursorfont.h>
#include <X11/keysym.h>
#include <X11/extensions/XTest.h>
#include <X11/extensions/Xcomposite.h>
#include <X11/extensions/Xrender.h>
#include <errno.h>
#include <math.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/timerfd.h>
#include <unistd.h>

#include "nexus_x11_bridge_scale.h"

/* 合成周期：33ms ≈ 30fps */
#define COMPOSITE_PERIOD_NS 33000000L

/* 放大镜固定模式参数 */
#define LOUPE_MIN_W 64      /* 固定模式拖拽缩小下限（宽） */
#define LOUPE_MIN_H 48      /* 固定模式拖拽缩小下限（高） */
#define LOUPE_BAND 6        /* 边框命中带半宽 px（拖动改大小的抓取区） */

/* zone 位掩码：bit0=左 bit1=右 bit2=上 bit3=下（角=两位组合） */
#define ZONE_LEFT 1
#define ZONE_RIGHT 2
#define ZONE_TOP 4
#define ZONE_BOTTOM 8

/* 单个缩放会话 */
typedef struct ScaleSession {
    Window container;      /* 面板容器窗口（缩放画布） */
    Window src;            /* Xephyr 输出窗口（屏外，虚拟分辨率） */
    Display *vdpy;         /* :N 持久连接（XTest 注入） */
    Pixmap srcPixmap;      /* NameWindowPixmap 取得的 backing pixmap */
    Picture srcPic;        /* 源 picture（带缩放 transform） */
    Picture dstPic;        /* 容器窗口 picture */
    int vw, vh;            /* 源尺寸缓存（几何比对检测 RANDR 变化） */
    int pw, ph;            /* 面板尺寸（letterbox 计算） */
    int focused;           /* 容器持有宿主焦点 → 才转发键盘 */
    int grabbed;           /* 指针 grab 深度（支持多键按下拖拽） */
    int pixmap_valid;      /* srcPixmap/srcPic 是否可用 */
    int container_mapped;  /* 容器可见性（map/unmap 命令维护，隐藏时暂停合成） */
    unsigned int held_mods; /* :N 侧已注入的修饰键模型 */
    int vdpy_dead;          /* :N 连接已断（Xephyr 退出）→ 停止注入，防 Xlib IO 错误终止 daemon */
    /* 放大镜（loupe）：全貌视图上叠加跟随指针的 1:1 局部直拷透镜 */
    int loupe_on;          /* 放大镜开关（中键切换） */
    int loupe_w;           /* 透镜宽度 px（0=自动 40%），Ctrl+滚轮调节 */
    int ptr_x, ptr_y;      /* 最近一次容器内指针坐标（透镜跟随） */
    /* 固定模式：左右键 chord 切换。几何冻结（不随指针平移），边框可拖拽缩放；
     * 指针在冻结透镜内时注入坐标走 1:1 透镜映射（"所见即所点"仍然成立） */
    int loupe_fixed;       /* 固定模式开关 */
    int fx, fy;            /* 冻结目标矩形左上角（容器坐标） */
    int fsx, fsy;          /* 冻结虚拟源矩形左上角（1:1 采样区，内容仍实时） */
    int flw, flh;          /* 冻结透镜尺寸（拖拽/Ctrl+滚轮可调） */
    /* 最近一帧"跟随模式"几何缓存：切换固定的瞬间从中取快照 */
    int last_sx, last_sy, last_dx, last_dy, last_lw, last_lh;
    int last_valid;        /* 缓存有效标志 */
    /* 边框拖拽改大小（仅固定模式） */
    int resize_zone;       /* 当前拖拽的边（ZONE_* 位组合），0=未拖拽 */
    int rz_btn;            /* 发起拖拽的按键 */
    int rz_start_x, rz_start_y; /* 拖拽起点指针位置 */
    int rz_fx, rz_fy, rz_lw, rz_lh; /* 拖拽起点几何快照 */
    Cursor zone_cur[11];   /* 各 zone 方向光标（下标=zone 位组合，0/3/7 不用） */
    int cur_zone;          /* 当前已应用的光标 zone */
    struct ScaleSession *next;
} ScaleSession;

static ScaleSession *g_sessions = NULL;
static int g_have_composite = 0;

/* 启动时查询宿主 X 的缩放能力并缓存 */
void scale_env_init(Display *dpy) {
    int ev = 0, er = 0;
    int maj = 0, min = 0;
    g_have_composite = XCompositeQueryExtension(dpy, &ev, &er)
        && XCompositeQueryVersion(dpy, &maj, &min)
        && (maj > 0 || min >= 2) /* NameWindowPixmap 自 0.2 引入 */
        && XRenderQueryExtension(dpy, &ev, &er);
}

/* 创建周期合成定时器；环境不支持返回 -1（主循环退化为纯行协议） */
int scale_timer_fd(void) {
    if (!g_have_composite) return -1;
    int tfd = timerfd_create(CLOCK_MONOTONIC, TFD_NONBLOCK);
    if (tfd < 0) return -1;
    struct itimerspec its;
    memset(&its, 0, sizeof(its));
    its.it_interval.tv_nsec = COMPOSITE_PERIOD_NS;
    its.it_value.tv_nsec = COMPOSITE_PERIOD_NS;
    if (timerfd_settime(tfd, 0, &its, NULL) < 0) {
        close(tfd);
        return -1;
    }
    return tfd;
}

static ScaleSession *find_session(Window w) {
    for (ScaleSession *s = g_sessions; s; s = s->next) {
        if (s->container == w) return s;
    }
    return NULL;
}

/* letterbox 居中：统一缩放比 k=min(pw/vw, ph/vh)，目标尺寸 dw/dh，偏移 ox/oy */
static void compute_fit(const ScaleSession *s, double *k, int *ox, int *oy, int *dw, int *dh) {
    if (s->vw < 1 || s->vh < 1 || s->pw < 1 || s->ph < 1) {
        *k = 1.0; *ox = 0; *oy = 0; *dw = s->pw; *dh = s->ph;
        return;
    }
    double kk = (double)s->pw / s->vw;
    double ky = (double)s->ph / s->vh;
    if (ky < kk) kk = ky;
    int dwi = (int)(s->vw * kk);
    int dhi = (int)(s->vh * kk);
    if (dwi < 1) dwi = 1;
    if (dhi < 1) dhi = 1;
    if (dwi > s->pw) dwi = s->pw;
    if (dhi > s->ph) dhi = s->ph;
    *k = kk; *dw = dwi; *dh = dhi;
    *ox = (s->pw - dwi) / 2;
    *oy = (s->ph - dhi) / 2;
}

/* 整数钳制到 [lo, hi]（调用方保证 lo<=hi） */
static int clampi(int v, int lo, int hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

/* 前向声明：定义在下方放大镜辅助区，scale_tick（RANDR 变化检测处）需先调用 */
static void loupe_reclamp(ScaleSession *s);

/* 放大镜透镜：基础全貌合成之后的第二遍。
 * 1:1 矩形直拷（不经 transform/坐标换算）。对齐不变式：
 *   指针像素处显示的内容 == 指针下的虚拟点（点击注入点）→"所见即所点"。
 * 实现：源矩形 (sx,sy) 显示于目标矩形 (dx,dy)，满足
 *   dx = sx + ptr_x - vcx,  dy = sy + ptr_y - vcy
 * （vc = 全貌映射反解的虚拟点）。旧实现先钳制源、再钳制目标，目标一旦被
 * 容器边缘钳制（如指针在面板顶部点 Chrome 刷新按钮），不变式即破，显示与
 * 点击错位。现改为：由"源在虚拟屏内 ∧ 目标在容器内"两组约束反解 sx/sy 的
 * 可行区间，在区间内取最接近"居中"理想值者，目标矩形不再钳制（恒在容器内）。
 * Ctrl+滚轮调节透镜尺寸（loupe_w），视野大小变化但始终 1:1 清晰。
 *
 * 固定模式（loupe_fixed）：几何完全冻结（目标 fx/fy/flw/flh、源 fsx/fsy），
 * 取景不随指针平移；内容仍每帧从冻结的虚拟区域实时采样（应用自身刷新可见）。
 * 指针在透镜内时由 forward_pointer 走 1:1 映射注入，点击准确性不变。 */
static void loupe_draw(Display *dpy, ScaleSession *s, double k, int ox, int oy) {
    if (!s->loupe_on || !s->srcPic || !s->dstPic) return;
    if (s->pw < 64 || s->ph < 64 || s->vw < 1 || s->vh < 1 || k <= 0) return;

    int lw, lh, sx, sy, dx, dy;

    if (s->loupe_fixed) {
        /* 固定模式：直接使用冻结几何，防御性重钳（容器/源尺寸变化兜底） */
        lw = s->flw; lh = s->flh;
        if (lw > s->vw) lw = s->vw;
        if (lh > s->vh) lh = s->vh;
        if (lw > s->pw) lw = s->pw;
        if (lh > s->ph) lh = s->ph;
        if (lw < 8 || lh < 8) return;
        sx = clampi(s->fsx, 0, s->vw - lw);
        sy = clampi(s->fsy, 0, s->vh - lh);
        dx = clampi(s->fx, 0, s->pw - lw);
        dy = clampi(s->fy, 0, s->ph - lh);
    } else {
    /* 透镜尺寸：手动值或自动（容器短边 40% 量级） */
    int maxw = s->pw < s->ph ? s->pw : s->ph;
    lw = s->loupe_w > 0 ? s->loupe_w : (maxw * 4 / 10);
    if (lw > maxw) lw = maxw;
    lh = lw * 3 / 4; /* 4:3 透镜 */
    if (lh > s->ph) { lh = s->ph; lw = lh * 4 / 3; }
    if (lw < 32 || lh < 32) return;
    if (lw > s->vw) lw = s->vw;
    if (lh > s->vh) lh = s->vh;

    /* 虚拟中心 = 全貌映射反解（与基础遍同一 k/ox/oy） */
    int vcx = (int)((s->ptr_x - ox) / k);
    int vcy = (int)((s->ptr_y - oy) / k);

    /* 源矩形约束一：在虚拟屏内 → sx ∈ [0, vw-lw] */
    int sx_min = 0;
    int sx_max = s->vw - lw;
    int sy_min = 0;
    int sy_max = s->vh - lh;
    /* 源矩形约束二：目标在容器内。dx = sx + ptr_x - vcx ∈ [0, pw-lw]
     * → sx ∈ [vcx-ptr_x, vcx-ptr_x+pw-lw]（y 同理） */
    int ax = vcx - s->ptr_x;
    int ay = vcy - s->ptr_y;
    if (ax > sx_min) sx_min = ax;
    if (ax + s->pw - lw < sx_max) sx_max = ax + s->pw - lw;
    if (ay > sy_min) sy_min = ay;
    if (ay + s->ph - lh < sy_max) sy_max = ay + s->ph - lh;

    if (sx_min <= sx_max && sy_min <= sy_max) {
        /* 可行区间内取最接近居中理想值者；dx/dy 由不变式解出，天然在容器内 */
        sx = vcx - lw / 2;
        if (sx < sx_min) sx = sx_min;
        if (sx > sx_max) sx = sx_max;
        sy = vcy - lh / 2;
        if (sy < sy_min) sy = sy_min;
        if (sy > sy_max) sy = sy_max;
        dx = sx + s->ptr_x - vcx;
        dy = sy + s->ptr_y - vcy;
    } else {
        /* 区间为空（极端边角，透镜比可视范围还大）：回退旧式钳制，容忍瞬时偏差 */
        sx = vcx - lw / 2;
        sy = vcy - lh / 2;
        if (sx < 0) sx = 0;
        if (sy < 0) sy = 0;
        if (sx > s->vw - lw) sx = s->vw - lw;
        if (sy > s->vh - lh) sy = s->vh - lh;
        if (sx < 0) sx = 0;
        if (sy < 0) sy = 0;
        dx = s->ptr_x - (vcx - sx);
        dy = s->ptr_y - (vcy - sy);
        if (dx < 0) dx = 0;
        if (dy < 0) dy = 0;
        if (dx > s->pw - lw) dx = s->pw - lw;
        if (dy > s->ph - lh) dy = s->ph - lh;
    }

    /* 缓存本帧几何：chord 进入固定模式时从缓存取快照（事件回调中无法现算） */
    s->last_lw = lw; s->last_lh = lh;
    s->last_sx = sx; s->last_sy = sy;
    s->last_dx = dx; s->last_dy = dy;
    s->last_valid = 1;
    }

    /* 边框：黑 1px + 彩色 2px + 黑 1px 三层嵌套实心矩形（内区随后被内容直拷覆盖），
     * 黑白双层保证浅色/深色内容背景下都清晰可见；彩色层区分状态：
     * 跟随=白，固定=橙 */
    XRenderColor black = { 0, 0, 0, 0xFFFF };
    XRenderColor ring = s->loupe_fixed
        ? (XRenderColor){ 0xFFFF, 0x9800, 0, 0xFFFF }
        : (XRenderColor){ 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF };
    XRectangle fr;
    fr.x = (short)(dx - 4); fr.y = (short)(dy - 4);
    fr.width = (unsigned short)(lw + 8); fr.height = (unsigned short)(lh + 8);
    XRenderFillRectangles(dpy, PictOpSrc, s->dstPic, &black, &fr, 1);
    fr.x = (short)(dx - 3); fr.y = (short)(dy - 3);
    fr.width = (unsigned short)(lw + 6); fr.height = (unsigned short)(lh + 6);
    XRenderFillRectangles(dpy, PictOpSrc, s->dstPic, &ring, &fr, 1);
    fr.x = (short)(dx - 1); fr.y = (short)(dy - 1);
    fr.width = (unsigned short)(lw + 2); fr.height = (unsigned short)(lh + 2);
    XRenderFillRectangles(dpy, PictOpSrc, s->dstPic, &black, &fr, 1);

    /* 1:1 直拷：源 picture 单位 transform（无缩放无平移），src/dst 偏移即矩形原点 */
    XTransform id;
    memset(&id, 0, sizeof(id));
    id.matrix[0][0] = id.matrix[1][1] = id.matrix[2][2] = 65536;
    XRenderSetPictureTransform(dpy, s->srcPic, &id);
    XRenderSetPictureFilter(dpy, s->srcPic, "nearest", NULL, 0);
    XRenderComposite(dpy, PictOpSrc, s->srcPic, None, s->dstPic,
                     sx, sy, 0, 0, dx, dy, lw, lh);
}

/* 释放源 picture/pixmap（重建前或会话销毁时） */
static void free_src_resources(Display *dpy, ScaleSession *s) {
    if (s->srcPic) { XRenderFreePicture(dpy, s->srcPic); s->srcPic = 0; }
    if (s->srcPixmap) { XFreePixmap(dpy, s->srcPixmap); s->srcPixmap = 0; }
    s->pixmap_valid = 0;
}

/* 重建 backing pixmap + 源 picture；源瞬态不可用（未 viewable）返回 0，tick 重试 */
static int try_rebuild(Display *dpy, ScaleSession *s) {
    free_src_resources(dpy, s);
    g_x_error = 0;
    Pixmap pm = XCompositeNameWindowPixmap(dpy, s->src);
    XSync(dpy, False);
    if (g_x_error || !pm) return 0;
    s->srcPixmap = pm;
    s->srcPic = XRenderCreatePicture(dpy, s->srcPixmap,
        XRenderFindVisualFormat(dpy, DefaultVisual(dpy, DefaultScreen(dpy))), 0, NULL);
    if (!s->srcPic) { free_src_resources(dpy, s); return 0; }
    Window r; int x, y; unsigned int w, h, bw, dep;
    if (XGetGeometry(dpy, s->src, &r, &x, &y, &w, &h, &bw, &dep)) {
        s->vw = (int)w; s->vh = (int)h;
    }
    s->pixmap_valid = 1;
    return 1;
}

/* 单帧合成：黑底清屏（覆盖 letterbox 与 expose/remap 恢复）+ 缩放绘制 */
static void composite_one(Display *dpy, ScaleSession *s) {
    if (!s->srcPic || !s->dstPic || s->pw < 1 || s->ph < 1) return;
    double k; int ox, oy, dw, dh;
    compute_fit(s, &k, &ox, &oy, &dw, &dh);

    XRenderColor black = { 0, 0, 0, 0xFFFF };
    XRectangle all = { 0, 0, (unsigned short)s->pw, (unsigned short)s->ph };
    XRenderFillRectangles(dpy, PictOpSrc, s->dstPic, &black, &all, 1);

    /* XRender picture transform 为 dest→src 采样映射：缩小 dw<vw 时系数>1 */
    XTransform tf;
    memset(&tf, 0, sizeof(tf));
    if (dw != s->vw || dh != s->vh) {
        tf.matrix[0][0] = (XFixed)(((int64_t)s->vw << 16) / dw);
        tf.matrix[1][1] = (XFixed)(((int64_t)s->vh << 16) / dh);
        tf.matrix[2][2] = 65536;
    } else {
        tf.matrix[0][0] = tf.matrix[1][1] = tf.matrix[2][2] = 65536;
    }
    XRenderSetPictureTransform(dpy, s->srcPic, &tf);
    XRenderSetPictureFilter(dpy, s->srcPic, "bilinear", NULL, 0);
    XRenderComposite(dpy, PictOpOver, s->srcPic, None, s->dstPic,
                     0, 0, 0, 0, ox, oy, dw, dh);

    /* 第二遍：放大镜透镜（开启时） */
    loupe_draw(dpy, s, k, ox, oy);
    XFlush(dpy);
}

/* 定时 tick：源尺寸变化→重建；容器隐藏→跳过；否则合成一帧 */
void scale_tick(Display *dpy) {
    for (ScaleSession *s = g_sessions; s; s = s->next) {
        Window r; int x, y; unsigned int w, h, bw, dep;
        g_x_error = 0;
        if (!XGetGeometry(dpy, s->src, &r, &x, &y, &w, &h, &bw, &dep) || g_x_error) {
            s->pixmap_valid = 0; /* 源已销毁等异常 */
        } else if ((int)w != s->vw || (int)h != s->vh) {
            s->pixmap_valid = 0; /* RANDR/resize → backing pixmap 已被服务器替换 */
        }
        if (!s->pixmap_valid) {
            if (!try_rebuild(dpy, s)) continue;
            /* M-7：重建意味着源尺寸可能已变（含 RANDR 收缩）→ 冻结几何重钳 */
            loupe_reclamp(s);
        }
        if (!s->container_mapped) continue;
        composite_one(dpy, s);
    }
}

/* 探测 :N 连接存活（Xephyr 退出 → 连接 EOF）。Xlib 默认 IO 错误处理会直接
 * 终止进程，且 XPending/XCloseDisplay 在断连上也会触发致命 IO 错误，
 * 故完全绕开 Xlib：recv(MSG_PEEK) 偷看连接 fd —— 0 字节=EOF，EAGAIN=空闲存活，
 * 有数据=服务端事件待读（存活）。死连接只标记不触碰 */
static int inject_ok(ScaleSession *s) {
    if (!s->vdpy || s->vdpy_dead) return 0;
    char buf[64];
    ssize_t n = recv(ConnectionNumber(s->vdpy), buf, sizeof(buf), MSG_PEEK | MSG_DONTWAIT);
    if (n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK)) {
        s->vdpy_dead = 1;
        return 0;
    }
    return 1;
}

/* 指针坐标换算并注入 :N，钳制到虚拟屏内；顺带记录透镜跟随坐标。
 * 固定模式下指针位于冻结透镜内时走 1:1 透镜映射（所见即所点），
 * 矩形外仍走全貌映射（与基础合成同一 k/offset） */
static void forward_pointer(ScaleSession *s, int x, int y) {
    s->ptr_x = x;
    s->ptr_y = y;
    if (!inject_ok(s)) return;
    int sx, sy;
    if (s->loupe_fixed && x >= s->fx && x < s->fx + s->flw &&
                          y >= s->fy && y < s->fy + s->flh) {
        /* 透镜内：虚拟点 = 冻结源左上角 + 透镜内偏移（与 letterbox 比例无关） */
        sx = s->fsx + (x - s->fx);
        sy = s->fsy + (y - s->fy);
    } else {
        double k; int ox, oy, dw, dh;
        compute_fit(s, &k, &ox, &oy, &dw, &dh);
        if (k <= 0) return;
        sx = (int)((x - ox) / k);
        sy = (int)((y - oy) / k);
    }
    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;
    if (sx >= s->vw) sx = s->vw - 1;
    if (sy >= s->vh) sy = s->vh - 1;
    XTestFakeMotionEvent(s->vdpy, DefaultScreen(s->vdpy), sx, sy, 0);
    XFlush(s->vdpy);
}

/* 修饰键 diff 同步：宿主 state 与 :N 侧 held_mods 不一致时补注入按下/释放。
 * X11 语义：KeyPress 的 state 不含本键、KeyRelease 的 state 含本键，
 * 故同步不会与修饰键事件本身的转发打架 */
static void sync_modifiers(ScaleSession *s, unsigned int host_state) {
    static const struct { unsigned int mask; KeySym sym; } M[] = {
        { ShiftMask,   XK_Shift_L },
        { ControlMask, XK_Control_L },
        { Mod1Mask,    XK_Alt_L },
        { Mod4Mask,    XK_Super_L },
    };
    for (size_t i = 0; i < sizeof(M) / sizeof(M[0]); i++) {
        unsigned int want = host_state & M[i].mask;
        unsigned int have = s->held_mods & M[i].mask;
        if (want == have) continue;
        KeyCode kc = XKeysymToKeycode(s->vdpy, M[i].sym);
        if (kc) XTestFakeKeyEvent(s->vdpy, kc, want != 0, 0);
        s->held_mods = want ? (s->held_mods | M[i].mask) : (s->held_mods & ~M[i].mask);
    }
}

/* 键盘转发：keysym 恒取 level 0（避免双重 shift），实际 Shift 效果靠修饰键同步 */
static void forward_key(Display *dpy, ScaleSession *s, XKeyEvent *ev) {
    if (!inject_ok(s)) return;
    sync_modifiers(s, ev->state);
    KeySym ks = XkbKeycodeToKeysym(dpy, ev->keycode, 0, 0);
    if (ks == NoSymbol) return;
    KeyCode kc = XKeysymToKeycode(s->vdpy, ks);
    if (!kc) return;
    XTestFakeKeyEvent(s->vdpy, kc, ev->type == KeyPress, 0);
    XFlush(s->vdpy);
}

/* ===== 放大镜固定模式 / chord / 边框拖拽辅助 ===== */

/* 边框命中检测：固定模式下指针距透镜边框 LOUPE_BAND 内 → 返回 ZONE_* 位组合 */
static int band_zone(const ScaleSession *s, int x, int y) {
    if (!s->loupe_fixed || s->flw < 1 || s->flh < 1) return 0;
    int x0 = s->fx, y0 = s->fy, x1 = s->fx + s->flw, y1 = s->fy + s->flh;
    int in_x_span = x >= x0 - LOUPE_BAND && x <= x1 + LOUPE_BAND;
    int in_y_span = y >= y0 - LOUPE_BAND && y <= y1 + LOUPE_BAND;
    int zone = 0;
    if (abs(x - x0) <= LOUPE_BAND && in_y_span) zone |= ZONE_LEFT;
    if (abs(x - x1) <= LOUPE_BAND && in_y_span) zone |= ZONE_RIGHT;
    if (abs(y - y0) <= LOUPE_BAND && in_x_span) zone |= ZONE_TOP;
    if (abs(y - y1) <= LOUPE_BAND && in_x_span) zone |= ZONE_BOTTOM;
    return zone;
}

/* 应用方向光标：zone 变化才切换；zone=0 恢复容器继承光标 */
static void cursor_apply(Display *dpy, ScaleSession *s, int zone) {
    if (zone == s->cur_zone) return;
    s->cur_zone = zone;
    if (zone == 0 || zone > 10 || !s->zone_cur[zone]) {
        XUndefineCursor(dpy, s->container);
    } else {
        XDefineCursor(dpy, s->container, s->zone_cur[zone]);
    }
    XFlush(dpy);
}

/* 进入固定模式：从最近一帧跟随模式缓存取几何快照；缓存无效（透镜未画出）忽略 */
static void loupe_enter_fixed(ScaleSession *s) {
    if (!s->last_valid || s->loupe_fixed) return;
    s->flw = s->last_lw; s->flh = s->last_lh;
    s->fx = s->last_dx;  s->fy = s->last_dy;
    s->fsx = s->last_sx; s->fsy = s->last_sy;
    /* 防御钳制（缓存理论已合法，容器/源尺寸变化兜底） */
    if (s->flw > s->vw) s->flw = s->vw;
    if (s->flh > s->vh) s->flh = s->vh;
    if (s->flw > s->pw) s->flw = s->pw;
    if (s->flh > s->ph) s->flh = s->ph;
    if (s->flw < LOUPE_MIN_W) s->flw = LOUPE_MIN_W;
    if (s->flh < LOUPE_MIN_H) s->flh = LOUPE_MIN_H;
    s->fsx = clampi(s->fsx, 0, s->vw - s->flw);
    s->fsy = clampi(s->fsy, 0, s->vh - s->flh);
    s->fx = clampi(s->fx, 0, s->pw - s->flw);
    s->fy = clampi(s->fy, 0, s->ph - s->flh);
    s->loupe_fixed = 1;
}

/* 退出固定模式：尺寸写回跟随模式（loupe_w），清拖拽状态并恢复光标 */
static void loupe_leave_fixed(Display *dpy, ScaleSession *s) {
    if (!s->loupe_fixed) return;
    s->loupe_fixed = 0;
    s->loupe_w = s->flw; /* 跟随模式沿用拖拽调整后的宽度 */
    s->resize_zone = 0;
    cursor_apply(dpy, s, 0);
}

/* M-7：固定模式冻结几何按当前容器/虚拟屏尺寸重钳。
 * 尺寸变化有两个来源：面板 resize（scale-update）与 RANDR 收缩
 * （tick 重建 pixmap 时检测到 vw/vh 变小）。若只靠 loupe_draw 每帧
 * 防御钳制绘制、而 forward_pointer/band_zone 仍用存储矩形做命中与
 * 1:1 映射，二者会出现像素级偏差（极端宽高比变化时点击与所见错位）。
 * 在尺寸变化源头统一重钳，保证存储几何 == 绘制几何 == 输入命中几何 */
static void loupe_reclamp(ScaleSession *s) {
    if (!s->loupe_fixed) return;
    if (s->vw < 1 || s->vh < 1 || s->pw < 1 || s->ph < 1) return;
    if (s->flw > s->vw) s->flw = s->vw;
    if (s->flh > s->vh) s->flh = s->vh;
    if (s->flw > s->pw) s->flw = s->pw;
    if (s->flh > s->ph) s->flh = s->ph;
    s->fsx = clampi(s->fsx, 0, s->vw - s->flw);
    s->fsy = clampi(s->fsy, 0, s->vh - s->flh);
    s->fx = clampi(s->fx, 0, s->pw - s->flw);
    s->fy = clampi(s->fy, 0, s->ph - s->flh);
}

/* 放大镜三态循环：关 → 跟随 → 固定 → 关（中键 / scale-loupe 命令共用）。
 * 跟随→固定 从最近一帧缓存取几何；缓存无效（刚开启未画出）时本轮保持跟随 */
static void loupe_cycle(Display *dpy, ScaleSession *s) {
    if (!s->loupe_on) {
        s->loupe_on = 1;
        s->loupe_fixed = 0;
        s->last_valid = 0; /* 不复用上一轮陈旧缓存 */
    } else if (!s->loupe_fixed) {
        loupe_enter_fixed(s);
    } else {
        s->loupe_on = 0;
        s->last_valid = 0;
        loupe_leave_fixed(dpy, s);
    }
}

/* 开始边框拖拽改大小：记录几何快照；拖拽期间事件一律不注入应用 */
static void resize_start(Display *dpy, ScaleSession *s, int zone, int btn, int x, int y) {
    s->resize_zone = zone;
    s->rz_btn = btn;
    s->rz_start_x = x; s->rz_start_y = y;
    s->rz_fx = s->fx; s->rz_fy = s->fy;
    s->rz_lw = s->flw; s->rz_lh = s->flh;
    cursor_apply(dpy, s, zone);
}

/* 拖拽中更新几何：右/下边锚定对边改尺寸，左/上边改尺寸同时移动框（对边锚定） */
static void resize_update(ScaleSession *s, int x, int y) {
    int z = s->resize_zone;
    if (!z) return;
    int maxw = s->pw < s->vw ? s->pw : s->vw;
    int maxh = s->ph < s->vh ? s->ph : s->vh;
    if (z & ZONE_RIGHT) {
        int hi = maxw - s->rz_fx;
        if (hi < LOUPE_MIN_W) hi = LOUPE_MIN_W;
        s->flw = clampi(s->rz_lw + (x - s->rz_start_x), LOUPE_MIN_W, hi);
    }
    if (z & ZONE_LEFT) {
        int right = s->rz_fx + s->rz_lw;
        int hi = right < maxw ? right : maxw;
        if (hi < LOUPE_MIN_W) hi = LOUPE_MIN_W;
        s->flw = clampi(right - x, LOUPE_MIN_W, hi);
        s->fx = right - s->flw;
    }
    if (z & ZONE_BOTTOM) {
        int hi = maxh - s->rz_fy;
        if (hi < LOUPE_MIN_H) hi = LOUPE_MIN_H;
        s->flh = clampi(s->rz_lh + (y - s->rz_start_y), LOUPE_MIN_H, hi);
    }
    if (z & ZONE_TOP) {
        int bottom = s->rz_fy + s->rz_lh;
        int hi = bottom < maxh ? bottom : maxh;
        if (hi < LOUPE_MIN_H) hi = LOUPE_MIN_H;
        s->flh = clampi(bottom - y, LOUPE_MIN_H, hi);
        s->fy = bottom - s->flh;
    }
}

/* 固定模式的 Ctrl+滚轮：冻结几何等比缩放（中心锚定并钳在容器内） */
static void fixed_wheel_zoom(ScaleSession *s, int up) {
    int maxw = s->pw < s->vw ? s->pw : s->vw;
    int maxh = s->ph < s->vh ? s->ph : s->vh;
    int nlw = clampi(s->flw + (up ? 40 : -40), LOUPE_MIN_W, maxw);
    int nlh = s->flw > 0 ? (int)((long)s->flh * nlw / s->flw) : (nlw * 3 / 4);
    nlh = clampi(nlh, LOUPE_MIN_H, maxh);
    int cx = s->fx + s->flw / 2;
    int cy = s->fy + s->flh / 2;
    s->flw = nlw; s->flh = nlh;
    s->fx = clampi(cx - nlw / 2, 0, s->pw - nlw);
    s->fy = clampi(cy - nlh / 2, 0, s->ph - nlh);
}

/* ButtonPress 统一 grab：宿主级指针保留（拖出容器仍收事件），与注入与否无关 */
static void press_grab(Display *dpy, ScaleSession *s, Time t) {
    if (s->grabbed == 0) {
        XGrabPointer(dpy, s->container, False,
                     ButtonPressMask | ButtonReleaseMask | PointerMotionMask,
                     GrabModeAsync, GrabModeAsync, None, None, t);
    }
    s->grabbed++;
}

/* 抽干宿主事件队列：容器上的指针/键盘事件换算后注入 :N */
void scale_drain_events(Display *dpy) {
    while (XPending(dpy)) {
        XEvent ev;
        XNextEvent(dpy, &ev);
        /* M-6：记录最近输入事件时间戳（focus 命令替代 CurrentTime 用）。
         * 仅指针/键盘/穿越事件带时间戳，FocusIn/Out 等没有，保持旧值 */
        Time evt = 0;
        if (ev.type == ButtonPress || ev.type == ButtonRelease) evt = ev.xbutton.time;
        else if (ev.type == MotionNotify) evt = ev.xmotion.time;
        else if (ev.type == KeyPress || ev.type == KeyRelease) evt = ev.xkey.time;
        else if (ev.type == EnterNotify || ev.type == LeaveNotify) evt = ev.xcrossing.time;
        if (evt) g_last_event_time = evt;
        ScaleSession *s = find_session(ev.xany.window);
        if (!s) continue;
        switch (ev.type) {
        case ButtonPress: {
            int btn = ev.xbutton.button;
            /* 抢宿主焦点（与直嵌现状点击 Xephyr 窗口抢焦点的行为一致） */
            if (!s->focused) {
                XSetInputFocus(dpy, s->container, RevertToParent, ev.xbutton.time);
                s->focused = 1;
            }
            s->ptr_x = ev.xbutton.x;
            s->ptr_y = ev.xbutton.y;
            /* 中键 = 放大镜三态循环（关→跟随→固定→关），不转发给应用 */
            if (btn == 2) {
                loupe_cycle(dpy, s);
                break;
            }
            /* Ctrl+滚轮 = 透镜尺寸调节（隐式开启放大镜），不转发给应用；
             * 固定模式下等比缩放冻结几何 */
            if ((btn == 4 || btn == 5) && (ev.xbutton.state & ControlMask)) {
                if (!s->loupe_on) {
                    s->loupe_on = 1;
                    s->loupe_fixed = 0;
                    s->last_valid = 0;
                }
                if (s->loupe_fixed) {
                    fixed_wheel_zoom(s, btn == 4);
                } else {
                    int maxw = s->pw < s->ph ? s->pw : s->ph;
                    int w = s->loupe_w > 0 ? s->loupe_w : (maxw * 4 / 10);
                    w += (btn == 4) ? 40 : -40;
                    if (w < 160) w = 160;
                    if (w > maxw) w = maxw;
                    s->loupe_w = w;
                }
                break;
            }
            /* 边框拖拽中：所有按键吞掉（不打断拖拽） */
            if (s->resize_zone) {
                press_grab(dpy, s, ev.xbutton.time);
                break;
            }
            /* 固定模式：边框命中带按下 → 拖拽改大小，不注入 */
            if (s->loupe_fixed) {
                int z = band_zone(s, ev.xbutton.x, ev.xbutton.y);
                if (z != 0) {
                    press_grab(dpy, s, ev.xbutton.time);
                    resize_start(dpy, s, z, btn, ev.xbutton.x, ev.xbutton.y);
                    break;
                }
            }
            /* 正常转发（点击零延迟；固定/跟随切换走 Ctrl+Shift+L 键盘快捷键） */
            press_grab(dpy, s, ev.xbutton.time);
            forward_pointer(s, ev.xbutton.x, ev.xbutton.y);
            if (inject_ok(s)) {
                XTestFakeButtonEvent(s->vdpy, btn, True, 0); /* 4/5/6/7 滚轮直转 */
                XFlush(s->vdpy);
            }
            break;
        }
        case ButtonRelease: {
            int btn = ev.xbutton.button;
            /* 中键 / Ctrl+滚轮 的释放同不转发（与 press 侧拦截配平） */
            if (btn == 2) break;
            if ((btn == 4 || btn == 5) && (ev.xbutton.state & ControlMask)) break;
            /* 拖拽结束（发起键）：吞掉释放，光标按指针当前位置恢复 */
            if (s->resize_zone && btn == s->rz_btn) {
                s->resize_zone = 0;
                cursor_apply(dpy, s, band_zone(s, ev.xbutton.x, ev.xbutton.y));
                goto release_tail;
            }
            /* 拖拽中的其他按键：吞掉 */
            if (s->resize_zone) goto release_tail;
            forward_pointer(s, ev.xbutton.x, ev.xbutton.y);
            if (inject_ok(s)) {
                XTestFakeButtonEvent(s->vdpy, btn, False, 0);
                XFlush(s->vdpy);
            }
        release_tail:
            if (s->grabbed > 0 && --s->grabbed == 0) {
                XUngrabPointer(dpy, ev.xbutton.time);
            }
            break;
        }
        case MotionNotify:
            s->ptr_x = ev.xmotion.x;
            s->ptr_y = ev.xmotion.y;
            /* 拖拽中：只更新几何，不注入应用 */
            if (s->resize_zone) {
                resize_update(s, ev.xmotion.x, ev.xmotion.y);
                break;
            }
            forward_pointer(s, ev.xmotion.x, ev.xmotion.y);
            /* 固定模式：边框命中带显示方向光标（仅 zone 变化时切换） */
            if (s->loupe_fixed) cursor_apply(dpy, s, band_zone(s, ev.xmotion.x, ev.xmotion.y));
            break;
        case EnterNotify:
            /* 进入即同步嵌套指针位置 */
            forward_pointer(s, ev.xcrossing.x, ev.xcrossing.y);
            if (s->loupe_fixed) cursor_apply(dpy, s, band_zone(s, ev.xcrossing.x, ev.xcrossing.y));
            break;
        case KeyPress:
        case KeyRelease:
            if (s->focused) forward_key(dpy, s, &ev.xkey); /* 失焦不转发 */
            break;
        case FocusOut:
            s->focused = 0;
            break;
        default:
            break;
        }
    }
}

/* caps 命令：编译期∧运行期能力 */
void scale_cmd_caps(Display *dpy) {
    (void)dpy;
    reply("ok features=%s", g_have_composite ? "scale" : "none");
}

/* scale-start <container> <src> <display>：注册缩放会话 */
void scale_cmd_start(Display *dpy, const char *line) {
    unsigned long cxid = 0, sxid = 0;
    char dname[64] = {0};
    if (sscanf(line, "%*s %lu %lu %63s", &cxid, &sxid, dname) != 3) {
        reply("err bad-args");
        return;
    }
    if (!g_have_composite) { reply("err no-composite"); return; }
    if (find_session((Window)cxid)) { reply("err exists"); return; }

    /* :N 持久连接 + XTest 能力查询 */
    Display *vd = XOpenDisplay(dname);
    if (!vd) { reply("err open-display"); return; }
    int tev = 0, terr = 0, tmaj = 0, tmin = 0;
    if (!XTestQueryExtension(vd, &tev, &terr, &tmaj, &tmin)) {
        XCloseDisplay(vd);
        reply("err no-xtest");
        return;
    }

    /* 手动重定向：内容保留在 backing pixmap，不再画到屏外父窗口 */
    g_x_error = 0;
    XCompositeRedirectWindow(dpy, (Window)sxid, CompositeRedirectManual);
    XSync(dpy, False);
    if (g_x_error) {
        XCloseDisplay(vd);
        reply("err redirect");
        return;
    }

    ScaleSession *s = calloc(1, sizeof(ScaleSession));
    if (!s) {
        XCompositeUnredirectWindow(dpy, (Window)sxid, CompositeRedirectManual);
        XCloseDisplay(vd);
        reply("err oom");
        return;
    }
    s->container = (Window)cxid;
    s->src = (Window)sxid;
    s->vdpy = vd;
    s->loupe_w = 0; /* 透镜尺寸自动 */

    /* 固定模式边框拖拽的方向光标：zone 位组合为下标（1=左 2=右 4=上 8=下，角为组合） */
    {
        static const unsigned int ZONE_GLYPH[11] = {
            0, XC_left_side, XC_right_side, 0, XC_top_side,
            XC_top_left_corner, XC_top_right_corner, 0, XC_bottom_side,
            XC_bottom_left_corner, XC_bottom_right_corner,
        };
        for (int i = 1; i <= 10; i++) {
            if (ZONE_GLYPH[i]) s->zone_cur[i] = XCreateFontCursor(dpy, ZONE_GLYPH[i]);
        }
    }

    /* 容器作缩放画布：建 dst picture + 选输入事件 */
    s->dstPic = XRenderCreatePicture(dpy, s->container,
        XRenderFindVisualFormat(dpy, DefaultVisual(dpy, DefaultScreen(dpy))), 0, NULL);
    XSelectInput(dpy, s->container,
                 ButtonPressMask | ButtonReleaseMask | PointerMotionMask |
                 KeyPressMask | KeyReleaseMask |
                 EnterWindowMask | LeaveWindowMask | FocusChangeMask);
    /* 初始面板尺寸取容器当前几何 */
    Window r; int gx, gy; unsigned int gw, gh, bw, dep;
    if (XGetGeometry(dpy, s->container, &r, &gx, &gy, &gw, &gh, &bw, &dep)) {
        s->pw = (int)gw; s->ph = (int)gh;
    }
    s->container_mapped = 0; /* 由后续 map/unmap 命令维护 */
    /* 首试重建：源未 viewable 时允许失败，tick 重试 */
    try_rebuild(dpy, s);

    s->next = g_sessions;
    g_sessions = s;
    reply("ok");
}

/* scale-update <container> <pw> <ph>：面板尺寸变化，下 tick 按新 letterbox 合成 */
void scale_cmd_update(Display *dpy, const char *line) {
    (void)dpy;
    unsigned long cxid = 0;
    int pw = 0, ph = 0;
    if (sscanf(line, "%*s %lu %d %d", &cxid, &pw, &ph) != 3 || pw < 1 || ph < 1) {
        reply("err bad-args");
        return;
    }
    ScaleSession *s = find_session((Window)cxid);
    if (!s) { reply("err no-session"); return; }
    s->pw = pw;
    s->ph = ph;
    /* M-7：容器尺寸变化 → 固定模式冻结几何在变化源头重钳，
     * 与绘制/输入命中矩形保持一致（原内联钳制只覆盖目标矩形一半） */
    loupe_reclamp(s);
    reply("ok");
}

/* scale-loupe <container>：推进放大镜三态循环（关→跟随→固定→关，与容器内中键等效，
 * 供标题栏按钮调用），返回推进后状态 ok loupe=0|1|2（0=关 1=跟随 2=固定） */
void scale_cmd_loupe(Display *dpy, const char *line) {
    unsigned long cxid = 0;
    if (sscanf(line, "%*s %lu", &cxid) != 1) {
        reply("err bad-args");
        return;
    }
    ScaleSession *s = find_session((Window)cxid);
    if (!s) { reply("err no-session"); return; }
    loupe_cycle(dpy, s);
    reply("ok loupe=%d", s->loupe_fixed ? 2 : (s->loupe_on ? 1 : 0));
}

/* 释放会话全部资源（与 mutter 的 redirect 引用计数配平） */
static void session_destroy(Display *dpy, ScaleSession *s) {
    free_src_resources(dpy, s);
    if (s->dstPic) XRenderFreePicture(dpy, s->dstPic);
    /* 恢复容器继承光标并释放方向光标 */
    XUndefineCursor(dpy, s->container);
    for (int i = 1; i <= 10; i++) {
        if (s->zone_cur[i]) XFreeCursor(dpy, s->zone_cur[i]);
    }
    XCompositeUnredirectWindow(dpy, s->src, CompositeRedirectManual);
    XSelectInput(dpy, s->container, NoEventMask);
    /* 连接已断时 XCloseDisplay 会触发 Xlib 致命 IO 错误，跳过（泄漏一个死连接无碍） */
    if (s->vdpy && inject_ok(s)) XCloseDisplay(s->vdpy);
    free(s);
}

/* scale-stop <container>：摘链并释放 */
void scale_cmd_stop(Display *dpy, const char *line) {
    unsigned long cxid = 0;
    sscanf(line, "%*s %lu", &cxid);
    ScaleSession **pp = &g_sessions;
    while (*pp) {
        if ((*pp)->container == (Window)cxid) {
            ScaleSession *dead = *pp;
            *pp = dead->next;
            session_destroy(dpy, dead);
            reply("ok");
            return;
        }
        pp = &(*pp)->next;
    }
    reply("ok"); /* 幂等 */
}

/* map/unmap 联动：隐藏暂停合成省电；显示立即补一帧 */
void scale_set_mapped(Display *dpy, Window container, int mapped) {
    ScaleSession *s = find_session(container);
    if (!s) return;
    s->container_mapped = mapped;
    if (mapped && s->pixmap_valid) composite_one(dpy, s);
}

/* daemon 退出前释放全部会话 */
void scale_dispose(Display *dpy) {
    while (g_sessions) {
        ScaleSession *dead = g_sessions;
        g_sessions = dead->next;
        session_destroy(dpy, dead);
    }
}

#endif /* !NEXUS_NO_SCALE */
