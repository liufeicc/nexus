/**
 * 终端区域组件
 */

import React, { useEffect } from 'react'
import { useAppStore, PanelState } from '../../store'
import type { TerminalPanel as TerminalPanelType, FileBrowserPanel as FileBrowserPanelType } from '../../store/types'
import LayoutRenderer from '../layout/LayoutRenderer'
import TerminalPanel from './TerminalPanel'
import FileBrowserPanel from '../file-browser/FileBrowserPanel'

export function TerminalArea() {
  const { activeSessionId, sessionsPanels, sessionsLayouts } = useAppStore()

  // 监听 cwd 变化事件，强制触发重渲染
  const [, forceUpdate] = React.useState(0)
  useEffect(() => {
    const handleCwdChange = () => forceUpdate(n => n + 1)
    window.addEventListener('panel-cwd-change', handleCwdChange)
    return () => window.removeEventListener('panel-cwd-change', handleCwdChange)
  }, [])

  return (
    <div className="terminal-area">
      {activeSessionId ? (
        <>
          {/* 为每个会话渲染一个容器，通过 display 控制显示/隐藏 */}
          {Array.from(sessionsPanels.entries()).map(([sessionId, panels]) => {
            const layout = sessionsLayouts.get(sessionId) || null
            const isActive = sessionId === activeSessionId

            // 创建面板映射
            const panelsMap = new Map<string, PanelState>()
            for (const panel of panels) {
              panelsMap.set(panel.id, panel)
            }

            return (
              <div
                key={sessionId}
                className="panels-container"
                id={`panels-container-${sessionId}`}
                style={{
                  display: isActive ? 'flex' : 'none',
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                {panels.length === 0 ? (
                  <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                  }}>
                    <p style={{ fontSize: '14px', marginBottom: '8px' }}>会话已激活</p>
                    <p style={{ fontSize: '13px' }}>点击工具栏按钮创建面板</p>
                  </div>
                ) : layout ? (
                  // 有布局树，使用树形渲染
                  <LayoutRenderer
                    layout={layout}
                    panelsMap={panelsMap}
                  />
                ) : (
                  // 没有布局树，单个面板占满容器
                  <div
                    className="terminal-panel-wrapper"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      minHeight: 0,
                    }}
                  >
                    {panels.map((panel) => {
                      if (panel.panelType === 'file-browser') {
                        const fbp = panel as FileBrowserPanelType
                        return (
                          <FileBrowserPanel
                            key={panel.id}
                            panelId={panel.id}
                            rootPath={fbp.rootPath || ''}
                            currentPath={fbp.currentPath}
                          />
                        )
                      }
                      if (panel.panelType === 'terminal') {
                        const tp = panel as TerminalPanelType
                        return (
                          <TerminalPanel
                            key={panel.id}
                            panelId={panel.id}
                            ptyId={tp.ptyId || ''}
                            cwd={tp.cwd || ''}
                          />
                        )
                      }
                      return null
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </>
      ) : (
        <div className="empty-state">
          <p className="empty-state-title">没有会话</p>
          <p className="empty-state-hint">请点击左侧边栏底部的 [+] 按钮新建会话</p>
        </div>
      )}
    </div>
  )
}

export default TerminalArea
