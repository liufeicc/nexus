/**
 * 通用面板包装器组件
 *
 * 提供所有面板类型共享的基础功能：
 * - 外层容器 DOM（terminal-panel class + drag 状态 class + data-focused 属性）
 * - 面板焦点管理（onClick -> setActivePanelId）
 * - 拖拽集成（内部调用 usePanelDrag）
 * - 右键菜单绑定（contextmenu 事件）
 * - 标题栏（左侧插槽 + 右侧关闭按钮）
 */

import React, { useRef, useEffect, useState } from 'react'
import { useAppStore } from '../../store'
import { usePanelDrag } from '../terminal/usePanelDrag'
import { ReplacePanelIcons } from './ReplacePanelIcons'
import { useI18n } from '../../i18n'

interface BasePanelProps {
  /** 面板唯一 ID */
  panelId: string
  /** 用于拖拽时显示的标题文本 */
  displayTitle: string
  /** 标题栏左侧内容（图标 + 标题文本） */
  headerLeft: React.ReactNode
  /** 面板主体内容 */
  children: React.ReactNode
  /** 自定义关闭逻辑，不提供则使用默认的 closePanel */
  onClose?: () => void
  /** 自定义右键菜单处理，不提供则使用默认的 showContextMenu */
  onContextMenu?: (e: MouseEvent) => void
  /** 标题栏右侧替换按钮之前的额外内容 */
  headerRightBefore?: React.ReactNode
}

export function BasePanel({
  panelId,
  displayTitle,
  headerLeft,
  children,
  onClose,
  onContextMenu,
  headerRightBefore,
}: BasePanelProps) {
  const { t } = useI18n()
  const {
    activePanelId,
    setActivePanelId,
    draggingPanelId,
    dropTargetPanelId,
    panels,
    closePanel,
    showContextMenu,
  } = useAppStore()

  const panelRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const replaceBtnRef = useRef<HTMLButtonElement>(null)
  const [showReplaceDrawer, setShowReplaceDrawer] = useState(false)

  const isActive = activePanelId === panelId
  const isDragging = draggingPanelId === panelId
  const isDropTarget = dropTargetPanelId === panelId

  // 使用拖拽 Hook（传入 refs，内部处理拖拽逻辑）
  usePanelDrag({ panelId, displayPath: displayTitle, headerRef, panelRef })

  // 点击面板选中
  const handleSelectPanel = () => {
    // 若当前获得焦点的是非终端面板，通知失去焦点的终端清除视觉选区
    // 需在 setActivePanelId 之前派发，确保能读取到旧的 activePanelId
    const prevActivePanelId = useAppStore.getState().activePanelId
    const prevActivePanel = prevActivePanelId
      ? panels.find((p) => p.id === prevActivePanelId)
      : null
    if (prevActivePanel && prevActivePanel.panelType === 'terminal') {
      window.dispatchEvent(
        new CustomEvent('terminal-clear-selection', {
          detail: { panelId: prevActivePanelId },
        })
      )
    }

    setActivePanelId(panelId)
    // 通知终端面板获取输入焦点
    window.dispatchEvent(new CustomEvent('terminal-focus', { detail: { panelId } }))
  }

  // 关闭面板
  const handleClose = () => {
    if (onClose) {
      onClose()
    } else {
      closePanel(panelId)
    }
  }

  // 右键菜单
  useEffect(() => {
    const panelEl = panelRef.current
    if (!panelEl) return

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      if (onContextMenu) {
        onContextMenu(e)
      } else {
        showContextMenu(e.clientX, e.clientY, undefined, panelId, false)
      }
    }

    panelEl.addEventListener('contextmenu', handleContextMenu, true)
    return () => {
      panelEl.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [panelId, showContextMenu, onContextMenu])

  return (
    <div
      ref={panelRef}
      className={`terminal-panel ${isDragging ? 'terminal-panel-dragging' : ''} ${isDropTarget ? 'terminal-panel-drop-target' : ''}`}
      data-panel-id={panelId}
      data-focused={isActive ? 'true' : 'false'}
      onClick={handleSelectPanel}
    >
      <div ref={headerRef} className="terminal-header" style={{ cursor: 'grab' }}>
        <div className="terminal-header-left">
          {headerLeft}
        </div>
        <div className="terminal-header-right">
          {headerRightBefore}
          {showReplaceDrawer && (
            <ReplacePanelIcons
              panelId={panelId}
              onClose={() => setShowReplaceDrawer(false)}
            />
          )}
          <button
            ref={replaceBtnRef}
            className="terminal-replace-btn"
            title={t('panel.replacePanel')}
            onClick={(e) => {
              e.stopPropagation()
              setShowReplaceDrawer(true)
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/>
            </svg>
          </button>
          <button
            className="terminal-close-btn"
            title={t('panel.closePanel')}
            onClick={(e) => {
              e.stopPropagation()
              handleClose()
            }}
          >
            <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
      </div>
      <div className="base-panel-body">
        {children}
      </div>
    </div>
  )
}

export default BasePanel
