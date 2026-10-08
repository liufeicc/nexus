/**
 * 应用面板组件（虚拟显示器嵌入）
 *
 * 在面板内通过 Xephyr 虚拟显示器运行桌面程序。
 * 占位区域 app-panel-embed 为嵌入窗口的落位区；
 * starting/exited/error 时显示状态层（含重新打开/重试按钮）。
 */

import React, { useRef } from 'react'
import { useAppStore } from '../../store'
import { useI18n } from '../../i18n'
import type { AppPanel as AppPanelState } from '../../store/types'
import { BasePanel } from '../common/BasePanel'
import { useAppPanelSync } from './use-app-panel-sync'

interface AppPanelProps {
  panelId: string
}

export function AppPanel({ panelId }: AppPanelProps) {
  const { t } = useI18n()
  const panel = useAppStore(s => s.panels.find(p => p.id === panelId)) as AppPanelState | undefined
  const updateAppPanelRunState = useAppStore(s => s.updateAppPanelRunState)
  const showToast = useAppStore(s => s.showToast)
  const placeholderRef = useRef<HTMLDivElement>(null)

  const appCommand = panel?.appCommand || ''
  const appName = panel?.appName || ''
  const runState = panel?.appRunState || 'starting'
  const runDetail = panel?.appRunDetail

  useAppPanelSync({ panelId, appCommand, appName, runState, placeholderRef })

  /** 重新打开 / 重试：重置回 starting 触发 launch */
  const handleRelaunch = () => {
    updateAppPanelRunState(panelId, 'starting')
  }

  /** 切换放大镜（与面板内中键等效，三态循环：关→跟随→固定）。
   * M-9：后端返回 null（直嵌模式无缩放会话 / 环境不支持）时不再静默，
   * toast 说明放大镜仅缩放模式可用，避免"点了没反应"的困惑 */
  const handleLoupeToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.electronAPI?.appPanel?.toggleLoupe?.(panelId).then(state => {
      if (state === null) showToast(t('appPanel.loupeUnavailable'))
    }).catch(() => {})
  }

  return (
    <BasePanel
      panelId={panelId}
      displayTitle={appName}
      headerLeft={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 500 }}>
          <svg className="icon" viewBox="0 0 24 24" fill="var(--accent-color)" style={{ width: '15px', height: '15px' }}>
            <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" />
          </svg>
          <span>{appName}</span>
        </span>
      }
      headerRightBefore={
        <button
          className="terminal-replace-btn"
          title={t('appPanel.loupeToggle')}
          onClick={handleLoupeToggle}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* zoom-in 造型（放大镜+加号） */}
          <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z" />
            <path d="M9 7h1v5H9zM7 9h5v1H7z" />
          </svg>
        </button>
      }
    >
      <div className="app-panel-body">
        {/* 嵌入目标占位区域：Xephyr 容器窗口覆盖于此 */}
        <div ref={placeholderRef} className="app-panel-embed" />

        {/* 启动中状态层 */}
        {runState === 'starting' && (
          <div className="app-panel-overlay">
            <div className="app-panel-spinner" />
            <div className="app-panel-overlay-text">{t('appPanel.starting')} {appName} …</div>
          </div>
        )}

        {/* 启动失败状态层 */}
        {runState === 'error' && (
          <div className="app-panel-overlay">
            <div className="app-panel-overlay-text">{t('appPanel.launchFailed')}</div>
            {runDetail && <div className="app-panel-overlay-detail">{runDetail}</div>}
            <button className="app-panel-action" onClick={handleRelaunch}>{t('appPanel.retry')}</button>
          </div>
        )}

        {/* 程序已退出状态层 */}
        {runState === 'exited' && (
          <div className="app-panel-overlay">
            <div className="app-panel-overlay-text">{appName} {t('appPanel.exited')}</div>
            <button className="app-panel-action" onClick={handleRelaunch}>{t('appPanel.relaunch')}</button>
          </div>
        )}
      </div>
    </BasePanel>
  )
}

export default AppPanel
