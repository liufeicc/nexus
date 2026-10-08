/**
 * 应用目录平台路由薄层
 *
 * 统一"已安装应用列表 / 应用图标"两个查询的平台差异：
 * - linux：DesktopEntryService（同步 .desktop 文件扫描）；
 * - win32：WindowsAppsService（经桥接 daemon 行协议扫描开始菜单，异步）。
 *
 * 消费方两处（且仅两处）：
 * 1. IPC handler（LIST_APPS / GET_ICON）——应用选择浮层数据源；
 * 2. AppPanelService.isExecAllowed——launch 的 exec 白名单校验
 *    （review 0.6.11 I-2，快照恢复防任意命令执行）。
 *
 * 不拆"接口 + 双实现"的原因：Linux 侧纯同步文件扫描、Windows 侧依赖 daemon
 * 异步行协议，强行统一接口只会引入适配层；薄路由改动最小且白名单语义
 * （launch 比对扫描结果）原样保留。
 */

import { DesktopEntryService, DesktopAppMeta } from './desktop-entry.service'
import { WindowsAppsService } from './windows-apps.service'

/** 列出当前平台全部可嵌入的桌面应用 */
export async function listInstalledApps(): Promise<DesktopAppMeta[]> {
  if (process.platform === 'win32') {
    return WindowsAppsService.getInstance().listApps()
  }
  return DesktopEntryService.getInstance().listApps()
}

/** 按 appId 取图标 dataURL（找不到返回 null，渲染端首字母占位） */
export async function getAppIconDataUrl(appId: string): Promise<string | null> {
  if (process.platform === 'win32') {
    return WindowsAppsService.getInstance().getIconDataUrl(appId)
  }
  return DesktopEntryService.getInstance().getIconDataUrl(appId)
}
