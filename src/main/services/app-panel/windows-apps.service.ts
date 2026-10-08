/**
 * Windows 应用扫描服务（开始菜单 .lnk 枚举）
 *
 * 与 Linux 的 desktop-entry.service.ts 对等，供应用选择浮层与 exec 白名单共用。
 * 差异点：
 * - 扫描/解析/图标全部在桥接 daemon（C++）内完成（IShellLinkW/GDI+），
 *   本服务仅负责：调行协议命令、base64 结果映射为 DesktopAppMeta、缓存；
 * - appId = .lnk 全路径（跨目录唯一、rescan 稳定；get-icon 据此重新定位 lnk）；
 * - exec = target+arguments 拼串，白名单比对与 splitExec 分词作用同一字符串，
 *   安全闭环语义与 Linux 一致（review 0.6.11 I-2）。
 */

import { WinBridgeService } from './win-bridge.service'
import type { DesktopAppMeta } from './desktop-entry.service'

/** 缓存有效期（与 DesktopEntryService 一致：5 分钟） */
const CACHE_TTL_MS = 5 * 60 * 1000

export class WindowsAppsService {
  private static instance: WindowsAppsService | null = null

  private bridge = WinBridgeService.getInstance()
  private cache: DesktopAppMeta[] | null = null
  private cacheAt = 0
  /** 图标 dataURL 缓存（appId → dataUrl | null） */
  private iconCache = new Map<string, string | null>()

  static getInstance(): WindowsAppsService {
    if (!WindowsAppsService.instance) {
      WindowsAppsService.instance = new WindowsAppsService()
    }
    return WindowsAppsService.instance
  }

  /** 列出全部可嵌入的桌面应用（带 5 分钟缓存）。
   * 过滤规则在 daemon 侧（控制台程序/UWP/系统工具/重复），此处仅映射与排序 */
  async listApps(): Promise<DesktopAppMeta[]> {
    if (this.cache && Date.now() - this.cacheAt < CACHE_TTL_MS) {
      return this.cache
    }
    const raw = await this.bridge.listApps()
    const apps: DesktopAppMeta[] = raw.map(a => ({
      appId: a.appId,
      name: a.name,
      exec: a.exec,
    }))
    // 按名称本地化排序（与 Linux 一致）
    apps.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    this.cache = apps
    this.cacheAt = Date.now()
    return apps
  }

  /** 按 appId（= lnk 全路径）返回图标 dataURL（懒加载 + 缓存）。
   * 找不到返回 null，渲染端以首字母占位（与 Linux 行为一致） */
  async getIconDataUrl(appId: string): Promise<string | null> {
    if (this.iconCache.has(appId)) return this.iconCache.get(appId)!
    let dataUrl: string | null = null
    try {
      const pngB64 = await this.bridge.getIconPngBase64(appId)
      if (pngB64) dataUrl = `data:image/png;base64,${pngB64}`
    } catch {
      dataUrl = null // daemon 瞬时异常：不缓存，下次重试
    }
    if (dataUrl !== null) this.iconCache.set(appId, dataUrl)
    else this.iconCache.set(appId, null)
    return dataUrl
  }
}
