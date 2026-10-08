/**
 * nexus-win-panel 应用枚举模块（开始菜单 .lnk 扫描 + 图标提取）
 *
 * 与 Linux desktop-entry.service.ts 对等：扫描开始菜单 .lnk，
 * 经 IShellLinkW 解析目标/参数，过滤控制台程序、UWP、系统工具，
 * 输出 base64(JSON)；图标经 ExtractIconExW + GDI+ 编码为 PNG base64。
 *
 * base64/UTF 转换工具由主文件 nexus_win_panel.cpp 提供（见下方声明）。
 */
#pragma once

#include <string>
#include <vector>

/** 扫描开始菜单，返回 base64(JSON)。
 * JSON 结构: {"apps":[{"appId":"<lnk全路径>","name":"<展示名>","exec":"<目标+参数拼串>"}]} */
std::string apps_list_json_b64();

/** GDI+ 初始化/关闭（图标编码依赖；主循环起止处各调一次） */
bool apps_gdiplus_init();
void apps_gdiplus_shutdown();

/** 按 .lnk 全路径（UTF-8）提取图标，返回 base64(PNG)；失败返回空串。
 * 图标来源优先级：lnk IconLocation → 目标文件首图标。 */
std::string apps_get_icon_b64(const std::string &lnk_path_utf8);

/* ---------- 以下工具定义在 nexus_win_panel.cpp ---------- */

/** base64 编码 */
std::string b64_encode(const unsigned char *data, size_t len);
/** base64 解码（非法字符静默忽略） */
std::vector<unsigned char> b64_decode(const std::string &in);
/** UTF-16 → UTF-8 */
std::string utf16_to_utf8(const std::wstring &w);
/** UTF-8 → UTF-16 */
std::wstring utf8_to_utf16(const std::string &s);
