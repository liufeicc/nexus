/*
 * nexus_x11_bridge_scale.h —— 缩放嵌入模块接口（主文件与 scale 模块共享）
 *
 * full 变体（默认编译）：nexus_x11_bridge_scale.c 提供实现；
 * lite 变体（-DNEXUS_NO_SCALE，缺 Xcomposite/Xtst 头文件时的降级编译）：
 *   仅编译主文件，本头文件提供内联 stub，行协议响应保持一致（err no-scale-support）。
 */
#ifndef NEXUS_X11_BRIDGE_SCALE_H
#define NEXUS_X11_BRIDGE_SCALE_H

#include <X11/Xlib.h>

/* 主文件提供：行协议响应、X 错误旗标与最近事件时间戳（focus 用） */
extern void reply(const char *fmt, ...);
extern int g_x_error;
extern Time g_last_event_time;

#ifndef NEXUS_NO_SCALE

/* 启动时查询宿主 X 的 Composite(>=0.2)/Render 扩展能力（缓存结论） */
void scale_env_init(Display *dpy);
/* 创建 33ms 周期合成定时器（timerfd）；环境不支持返回 -1 */
int scale_timer_fd(void);
/* 定时 tick：对所有缩放会话做"源尺寸检测 + 重建 + 缩放合成" */
void scale_tick(Display *dpy);
/* 抽干宿主 X 事件队列，把容器上的指针/键盘事件换算后注入 :N */
void scale_drain_events(Display *dpy);
/* caps 命令：ok features=scale|none */
void scale_cmd_caps(Display *dpy);
/* scale-start <container> <src> <display> */
void scale_cmd_start(Display *dpy, const char *line);
/* scale-update <container> <pw> <ph> */
void scale_cmd_update(Display *dpy, const char *line);
/* scale-stop <container> */
void scale_cmd_stop(Display *dpy, const char *line);
/* scale-loupe <container>：推进放大镜三态循环（中键等效），返回 ok loupe=0|1|2（0=关 1=跟随 2=固定） */
void scale_cmd_loupe(Display *dpy, const char *line);
/* map/unmap 命令联动：容器隐藏时暂停合成，显示时立即补一帧 */
void scale_set_mapped(Display *dpy, Window container, int mapped);
/* daemon 退出前释放全部缩放会话 */
void scale_dispose(Display *dpy);

#else /* NEXUS_NO_SCALE：lite 降级 stub */

static inline void scale_env_init(Display *d) { (void)d; }
static inline int scale_timer_fd(void) { return -1; }
static inline void scale_tick(Display *d) { (void)d; }
static inline void scale_drain_events(Display *d) { (void)d; }
static inline void scale_cmd_caps(Display *d) { (void)d; reply("ok features=none"); }
static inline void scale_cmd_start(Display *d, const char *l) { (void)d; (void)l; reply("err no-scale-support"); }
static inline void scale_cmd_update(Display *d, const char *l) { (void)d; (void)l; reply("err no-scale-support"); }
static inline void scale_cmd_stop(Display *d, const char *l) { (void)d; (void)l; reply("err no-scale-support"); }
static inline void scale_cmd_loupe(Display *d, const char *l) { (void)d; (void)l; reply("err no-scale-support"); }
static inline void scale_set_mapped(Display *d, Window w, int m) { (void)d; (void)w; (void)m; }
static inline void scale_dispose(Display *d) { (void)d; }

#endif /* NEXUS_NO_SCALE */

#endif /* NEXUS_X11_BRIDGE_SCALE_H */
