/**
 * 侧边栏组件
 */

import React from 'react'
import { useAppStore } from '../../store'
import type { Session } from '@core/types'
import { SessionListItem } from '../session/SessionListItem'
import { restoreSessionPanels } from '../../utils/session-snapshot'
import { useI18n } from '../../i18n'

export function Sidebar() {
  const { sidebarWidth, setSidebarWidth, sidebarCollapsed, setSidebarCollapsed, setActiveSessionId, setSessionIds, sessionsPanels, sessionsLayouts } = useAppStore()
  const { t } = useI18n()

  // 会话列表状态
  const [allSessions, setAllSessions] = React.useState<Session[]>([])
  const [recentSessions, setRecentSessions] = React.useState<Session[]>([])
  const [recentExpanded, setRecentExpanded] = React.useState(false)

  // 标记是否已恢复过面板（应用启动时）
  const hasRestoredPanelRef = React.useRef(false)

  // 恢复会话快照（使用 useCallback 避免无限循环）
  const restoreSnapshot = React.useCallback(async (sessionId: string, isAppStartup = false) => {
    await restoreSessionPanels(sessionId)
  }, [])

  // 加载会话列表
  const loadSessions = React.useCallback(async () => {
    try {
      const sessions = await window.electronAPI.session.list()
      setAllSessions(sessions)
      setSessionIds(sessions.map((s: Session) => s.id))

      // 加载最近使用的会话（最多 3 个，包含活动会话）
      const recent = await window.electronAPI.session.getRecent(3)
      setRecentSessions(recent)

      // 获取活动会话并设置到 store（应用启动时恢复）
      const activeSession = await window.electronAPI.session.getActive()
      if (activeSession && !hasRestoredPanelRef.current) {
        setActiveSessionId(activeSession.id)

        hasRestoredPanelRef.current = true
        restoreSnapshot(activeSession.id, true)
      } else if (activeSession) {
        setActiveSessionId(activeSession.id)
      }
    } catch (error) {
      console.error('[Sidebar] 加载会话列表失败:', error)
    }
  }, [setSessionIds, setActiveSessionId, restoreSnapshot])

  // 组件挂载时加载会话列表，并注册会话变化事件监听
  React.useEffect(() => {
    loadSessions()

    const handleSessionsChange = () => {
      loadSessions()
    }

    window.addEventListener('sessions-change', handleSessionsChange)

    return () => {
      window.removeEventListener('sessions-change', handleSessionsChange)
    }
  }, [loadSessions])

  // 新建会话
  const handleNewSession = async () => {
    try {
      const newSession = await window.electronAPI.session.create()
      await window.electronAPI.session.setActive(newSession.id)
      setActiveSessionId(newSession.id)

      try {
        const sessions = await window.electronAPI.session.list()
        setAllSessions(sessions)
        setSessionIds(sessions.map((s: Session) => s.id))
        const recent = await window.electronAPI.session.getRecent(3)
        setRecentSessions(recent)
      } catch (error) {
        console.error('[Sidebar] 刷新会话列表失败:', error)
      }
    } catch (error) {
      console.error('[Sidebar] 创建会话失败:', error)
    }
  }

  // 拖拽相关
  const [isResizing, setIsResizing] = React.useState(false)
  const [startX, setStartX] = React.useState(0)
  const [startWidth, setStartWidth] = React.useState(0)

  // 开始调整大小
  const handleResizeStart = (e: React.MouseEvent) => {
    setIsResizing(true)
    setStartX(e.pageX)
    setStartWidth(sidebarWidth)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // 调整大小中
  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const deltaX = e.pageX - startX
      const newWidth = Math.max(160, Math.min(400, startWidth + deltaX))
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.electronAPI.config.save('sidebarWidth', sidebarWidth)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, startX, startWidth, sidebarWidth, setSidebarWidth])

  // 切换侧边栏折叠状态
  const handleToggleSidebar = () => {
    const newCollapsed = !sidebarCollapsed
    setSidebarCollapsed(newCollapsed)
    window.electronAPI.config.save('sidebarCollapsed', newCollapsed)
  }

  // 监听侧边栏宽度变化，保存到配置
  // 添加类型检查：只有当值为有效数字且不为默认值时才保存
  React.useEffect(() => {
    if (typeof sidebarWidth === 'number' && sidebarWidth !== 224) {
      window.electronAPI.config.save('sidebarWidth', sidebarWidth)
    }
  }, [sidebarWidth])

  // 监听侧边栏收起状态变化，保存到配置
  // 添加类型检查：只有当值为有效布尔值且不为默认值时才保存
  React.useEffect(() => {
    if (typeof sidebarCollapsed === 'boolean' && sidebarCollapsed !== false) {
      window.electronAPI.config.save('sidebarCollapsed', sidebarCollapsed)
    }
  }, [sidebarCollapsed])

  // 切换最近会话展开/收起状态
  const handleToggleRecent = () => {
    const newExpanded = !recentExpanded
    setRecentExpanded(newExpanded)
    window.electronAPI.config.save('recentExpanded', newExpanded)
  }

  // 加载最近会话展开状态
  React.useEffect(() => {
    const loadRecentExpanded = async () => {
      const expanded = await window.electronAPI.config.get('recentExpanded')
      if (expanded !== null && expanded !== undefined) {
        setRecentExpanded(expanded)
      }
    }
    loadRecentExpanded()
  }, [])

  return (
    <>
      <aside
        className="sidebar"
        style={{
          width: sidebarCollapsed ? 0 : sidebarWidth,
          opacity: sidebarCollapsed ? 0 : 1,
          pointerEvents: sidebarCollapsed ? 'none' : 'auto',
        }}
      >
        {/* 侧边栏标题 */}
        <div className="sidebar-header">
          <span className="sidebar-title">{t('sidebar.title')}</span>
          <button className="sidebar-add-btn" title={t('sidebar.newSession')} onClick={handleNewSession}>
            <svg className="icon" viewBox="0 0 24 24">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
          </button>
        </div>

        {/* 会话列表内容 */}
        <div className="sidebar-content">
          {/* 最近使用 */}
          <div className="sidebar-section">
            <div
              className="sidebar-section-label"
              style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              onClick={handleToggleRecent}
              title={t('sidebar.toggleExpand')}
            >
              <span>{t('sidebar.recentUsed')}</span>
              <button
                className="section-toggle-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  handleToggleRecent()
                }}
                title={t('sidebar.toggleExpand')}
              >
                <svg
                  className="icon"
                  viewBox="0 0 24 24"
                  style={{
                    transform: recentExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s ease',
                    width: '16px',
                    height: '16px',
                  }}
                >
                  <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                </svg>
              </button>
            </div>
            {recentExpanded && (
              <div className="session-items">
                {recentSessions.length === 0 ? (
                  <div className="empty-session-text">{t('sidebar.noRecentSessions')}</div>
                ) : (
                  recentSessions.map((session) => (
                    <SessionListItem key={session.id} session={session} showActive={false} />
                  ))
                )}
              </div>
            )}
          </div>

          {/* 分割线 */}
          <div
            style={{
              height: '1px',
              backgroundColor: 'var(--border-color)',
              margin: '8px 16px',
            }}
          />

          {/* 全部会话 */}
          <div className="sidebar-section">
            <div className="sidebar-section-label">{t('sidebar.allSessions')}</div>
            <div className="session-items">
              {allSessions.length === 0 ? (
                <div className="empty-session-text">{t('sidebar.noSessions')}</div>
              ) : (
                allSessions.map((session) => (
                  <SessionListItem key={session.id} session={session} />
                ))
              )}
            </div>
          </div>
        </div>

        {/* 侧边栏底部 */}
        <div className="sidebar-footer">
          <button className="btn-new-session" onClick={handleNewSession}>
            <svg className="icon" viewBox="0 0 24 24">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            {t('sidebar.newSession')}
          </button>
        </div>
      </aside>

      {/* 可拖拽分割线 */}
      <div className="resizer" onMouseDown={handleResizeStart}>
        <button className="sidebar-toggle-btn" onClick={handleToggleSidebar} title={t('sidebar.toggleSidebar')}>
          <svg
            className="icon"
            viewBox="0 0 24 24"
            style={{
              transform: sidebarCollapsed ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s ease',
            }}
          >
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
          </svg>
        </button>
      </div>
    </>
  )
}

export default Sidebar
