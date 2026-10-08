/**
 * 应用选择浮层
 *
 * 展示系统已安装桌面程序（.desktop 扫描），支持搜索过滤与图标懒加载。
 * 选中应用后：替换模式 → 原地替换目标面板；否则有选中面板 → 分屏；无 → 新建。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store'
import { useI18n } from '../../i18n'

interface AppItem {
  appId: string
  name: string
  exec: string
  icon?: string
}

/** 单个应用卡片（图标懒加载，缺失用首字母占位；右上角置顶按钮可切换置顶状态） */
function AppCard({ app, isPinned, onPick, onTogglePin }: {
  app: AppItem
  isPinned: boolean
  onPick: (app: AppItem) => void
  onTogglePin: (app: AppItem) => void
}) {
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  const { t } = useI18n()

  useEffect(() => {
    let cancelled = false
    window.electronAPI.appPanel.getIcon(app.appId).then(url => {
      if (!cancelled) setIconUrl(url)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [app.appId])

  return (
    <div className="app-picker-card" onClick={() => onPick(app)} title={app.exec}>
      {/* 置顶按钮：hover 显示；已置顶时常驻高亮。阻止冒泡避免触发打开应用 */}
      <button
        className={`app-picker-pin-btn ${isPinned ? 'pinned' : ''}`}
        title={isPinned ? t('appPanel.unpin') : t('appPanel.pin')}
        onClick={(e) => { e.stopPropagation(); onTogglePin(app) }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
        </svg>
      </button>
      <div className="app-picker-card-icon">
        {iconUrl ? (
          <img src={iconUrl} alt={app.name} draggable={false} />
        ) : (
          <span>{app.name.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="app-picker-card-name">{app.name}</div>
    </div>
  )
}

export function AppPickerOverlay() {
  const { t } = useI18n()
  const {
    appPicker, setAppPickerVisible, activePanelId, activeSessionId,
    panels, replacePanelInPlace, saveSnapshot, createAppPanel, splitPanelWithAppPanel,
    splitMode, showToast,
  } = useAppStore()

  const [apps, setApps] = useState<AppItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  // 置顶应用 ID 列表（持久化到 config.pinnedApps，按置顶先后排序）
  const [pinnedApps, setPinnedApps] = useState<string[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const visible = appPicker.visible

  // 打开时加载应用列表与置顶列表并聚焦搜索框
  useEffect(() => {
    if (!visible) return
    setQuery('')
    setLoading(true)
    window.electronAPI.appPanel.listApps().then(({ apps }) => {
      setApps(apps)
      setLoading(false)
    }).catch(() => setLoading(false))
    // 读取置顶列表（失败不阻塞，视为无置顶）
    window.electronAPI.config.get('pinnedApps').then(v => {
      if (Array.isArray(v)) setPinnedApps(v.filter(id => typeof id === 'string'))
    }).catch(() => {})
    setTimeout(() => searchRef.current?.focus(), 50)
  }, [visible])

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!visible) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setAppPickerVisible(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAppPickerVisible(false)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [visible, setAppPickerVisible])

  // 搜索过滤 + 置顶排序：置顶应用按置顶先后排最前，其余保持名称排序（sort 稳定）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? apps.filter(a =>
          a.name.toLowerCase().includes(q) || a.exec.toLowerCase().includes(q),
        )
      : apps
    if (pinnedApps.length === 0) return list
    const order = new Map(pinnedApps.map((id, i) => [id, i]))
    return [...list].sort((a, b) => {
      const oa = order.get(a.appId)
      const ob = order.get(b.appId)
      if (oa !== undefined && ob !== undefined) return oa - ob
      if (oa !== undefined) return -1
      if (ob !== undefined) return 1
      return 0
    })
  }, [apps, query, pinnedApps])

  /** 切换置顶状态：新置顶的插到最前，持久化到 config */
  const togglePin = (app: AppItem) => {
    const next = pinnedApps.includes(app.appId)
      ? pinnedApps.filter(id => id !== app.appId)
      : [app.appId, ...pinnedApps]
    setPinnedApps(next)
    window.electronAPI.config.save('pinnedApps', next).catch(e => {
      console.error('[AppPicker] 保存置顶列表失败:', e)
    })
  }

  if (!visible) return null

  /** 选中应用 → 替换 / 分屏 / 新建 */
  const handlePick = async (app: AppItem) => {
    setAppPickerVisible(false)

    // 替换模式：原地替换目标面板（旧面板资源由 replacePanelInPlace 统一清理）
    if (appPicker.replacePanelId) {
      const panel = panels.find(p => p.id === appPicker.replacePanelId)
      if (!panel) return
      replacePanelInPlace(appPicker.replacePanelId, {
        panelType: 'app',
        title: `${t('panel.appPanel')} - ${app.name}`,
        appCommand: app.exec,
        appName: app.name,
      })
      if (activeSessionId) saveSnapshot(activeSessionId)
      return
    }

    // 新建 / 分屏：按工具条当前分屏模式拆分活跃面板（原地替换仅"替换面板"入口触发）
    try {
      // 右键菜单分屏子菜单入口：对指定面板按指定方向分屏
      if (appPicker.split) {
        await splitPanelWithAppPanel(appPicker.split.panelId, appPicker.split.direction, app)
        if (activeSessionId) saveSnapshot(activeSessionId)
        return
      }
      if (activePanelId) {
        await splitPanelWithAppPanel(activePanelId, splitMode, app)
      } else {
        await createAppPanel(app)
      }
      if (activeSessionId) saveSnapshot(activeSessionId)
    } catch (e) {
      showToast(`${t('appPanel.launchFailed')}: ${e}`)
    }
  }

  return (
    <div className="app-picker-overlay">
      <div ref={rootRef} className="app-picker-panel">
        <div className="app-picker-header">
          <input
            ref={searchRef}
            className="app-picker-search"
            placeholder={t('appPanel.searchPlaceholder')}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <div className="app-picker-grid">
          {loading ? (
            <div className="app-picker-empty">{t('common.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="app-picker-empty">{t('appPanel.empty')}</div>
          ) : (
            filtered.map(app => (
              <AppCard
                key={app.appId}
                app={app}
                isPinned={pinnedApps.includes(app.appId)}
                onPick={handlePick}
                onTogglePin={togglePin}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default AppPickerOverlay
