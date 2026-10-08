/**
 * 桌面应用扫描服务（.desktop 解析）
 *
 * 扫描系统已安装的桌面程序（freedesktop .desktop），供应用选择浮层展示。
 * 过滤 NoDisplay/Hidden/Terminal/无 Exec 的条目；Exec 剥离字段码；
 * 图标按简化 freedesktop 规则解析为 dataURL（懒加载 + 缓存）。
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

/** 扫描结果中的应用元数据 */
export interface DesktopAppMeta {
  /** 稳定标识（desktop 文件名，如 dbeaver-ce.desktop） */
  appId: string
  /** 展示名称 */
  name: string
  /** 启动命令（已剥离字段码） */
  exec: string
  /** Icon 字段原值（名称或绝对路径） */
  icon?: string
  startupWMClass?: string
  categories?: string
}

/** .desktop 扫描目录 */
const SCAN_DIRS = [
  '/usr/share/applications',
  '/usr/local/share/applications',
  '/var/lib/flatpak/exports/share/applications',
  path.join(os.homedir(), '.local/share/applications'),
]

/** 图标查找目录（简化 freedesktop，不做 index.theme 继承解析） */
const ICON_DIRS = [
  '/usr/share/icons/hicolor',
  '/usr/share/icons/Adwaita',
  '/usr/share/pixmaps',
]
const ICON_SIZES = ['scalable', '256x256', '128x128', '64x64', '48x48', '32x32']
const ICON_EXTS = ['svg', 'png', 'xpm']

/** 缓存有效期（5 分钟） */
const CACHE_TTL_MS = 5 * 60 * 1000

export class DesktopEntryService {
  private static instance: DesktopEntryService | null = null

  private cache: DesktopAppMeta[] | null = null
  private cacheAt = 0
  /** 图标 dataURL 缓存（appId → dataUrl | null） */
  private iconCache = new Map<string, string | null>()
  /** appId → 原始 icon 字段 */
  private iconField = new Map<string, string | undefined>()

  static getInstance(): DesktopEntryService {
    if (!DesktopEntryService.instance) {
      DesktopEntryService.instance = new DesktopEntryService()
    }
    return DesktopEntryService.instance
  }

  /** 列出全部可嵌入的桌面应用（带缓存） */
  listApps(): DesktopAppMeta[] {
    if (this.cache && Date.now() - this.cacheAt < CACHE_TTL_MS) {
      return this.cache
    }
    const apps: DesktopAppMeta[] = []
    const seen = new Set<string>()

    for (const dir of SCAN_DIRS) {
      if (!fs.existsSync(dir)) continue
      let files: string[] = []
      try {
        files = fs.readdirSync(dir).filter(f => f.endsWith('.desktop'))
      } catch {
        continue
      }
      for (const file of files) {
        const meta = this.parseDesktop(path.join(dir, file))
        if (!meta) continue
        // 同名应用以先扫描到的为准（系统级优先于用户级）
        if (seen.has(meta.appId)) continue
        seen.add(meta.appId)
        apps.push(meta)
      }
    }

    // 按名称本地化排序
    apps.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    this.cache = apps
    this.cacheAt = Date.now()
    return apps
  }

  /** 解析单个 .desktop，返回 null 表示不可用 */
  private parseDesktop(filePath: string): DesktopAppMeta | null {
    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf8')
    } catch {
      return null
    }

    // 只取 [Desktop Entry] 段
    const lines = content.split(/\r?\n/)
    let inEntry = false
    const kv: Record<string, string> = {}
    for (const raw of lines) {
      const line = raw.trim()
      if (line.startsWith('[')) {
        inEntry = line === '[Desktop Entry]'
        continue
      }
      if (!inEntry || !line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim()
      // M-8：显式跳过本地化变体键（Name[zh_CN]、Icon[de] 等）。本服务只消费裸键，
      // 变体键入库只会撑大键表，且在个别 .desktop 键序异常时引入不确定性
      if (key.includes('[')) continue
      if (!(key in kv)) kv[key] = val // 首个为准
    }

    const exec = this.cleanExec(kv['Exec'] || '')
    if (!exec) return null
    if (/^true$/i.test(kv['NoDisplay'] || '')) return null
    if (/^true$/i.test(kv['Hidden'] || '')) return null
    if (/^true$/i.test(kv['Terminal'] || '')) return null

    const name = kv['Name'] || path.basename(filePath, '.desktop')
    const appId = path.basename(filePath)
    this.iconField.set(appId, kv['Icon'])

    return {
      appId,
      name,
      exec,
      icon: kv['Icon'],
      startupWMClass: kv['StartupWMClass'],
      categories: kv['Categories'],
    }
  }

  /** 剥离 Exec 字段码与多余参数，得到可执行命令 */
  private cleanExec(exec: string): string {
    if (!exec) return ''
    // 去除环境变量前缀（如 `env FOO=bar cmd`）
    let s = exec.replace(/^(\w+=\S+\s+)+/, '')
    // 移除字段码 %x
    s = s.replace(/%[fFuUdDnNickvm]/g, ' ')
    // 取命令与必要参数（保留首个 token 及非选项参数会过于复杂，直接取整串去空格）
    s = s.replace(/\s+/g, ' ').trim()
    return s
  }

  /** 按 appId 返回图标 dataURL（懒加载 + 缓存） */
  getIconDataUrl(appId: string): string | null {
    if (this.iconCache.has(appId)) return this.iconCache.get(appId)!
    const icon = this.iconField.get(appId)
    const dataUrl = this.resolveIcon(icon)
    this.iconCache.set(appId, dataUrl)
    return dataUrl
  }

  /** 解析图标为 dataURL，找不到返回 null（渲染端用首字母占位） */
  private resolveIcon(icon?: string): string | null {
    if (!icon) return null
    let filePath: string | null = null

    if (icon.includes('/') || icon.includes('\\')) {
      // 绝对路径
      filePath = fs.existsSync(icon) ? icon : null
    } else {
      // 按名称在图标目录查找
      outer: for (const base of ICON_DIRS) {
        if (base.endsWith('pixmaps')) {
          for (const ext of ICON_EXTS) {
            const p = path.join(base, `${icon}.${ext}`)
            if (fs.existsSync(p)) { filePath = p; break outer }
          }
        } else {
          for (const size of ICON_SIZES) {
            for (const ext of ICON_EXTS) {
              const p = path.join(base, size, 'apps', `${icon}.${ext}`)
              if (fs.existsSync(p)) { filePath = p; break outer }
            }
          }
        }
      }
    }

    if (!filePath) return null
    if (filePath.endsWith('.xpm')) return null // 不支持 XPM
    try {
      const buf = fs.readFileSync(filePath)
      const mime = filePath.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  }
}
