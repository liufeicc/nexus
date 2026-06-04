/**
 * 工具栏组件
 */

import React from 'react'
import { useAppStore } from '../../store'
import { useI18n } from '../../i18n'

export function Toolbar() {
  const { activePanelId, activeSessionId, showPathSelectorModal, showConfirmModal, showAlertModal, createPanel, splitPanelWithPty, closePanel, createFilePanel, splitPanelWithFilePanel, createBrowserPanel, splitPanelWithBrowserPanel, setNexusProfileModalVisible } = useAppStore()
  const { t } = useI18n()

  // 分屏模式：horizontal = 左右分屏，vertical = 上下分屏
  const [splitMode, setSplitMode] = React.useState<'horizontal' | 'vertical'>('horizontal')

  // 检查是否有选中的面板
  const hasSelectedPanel = !!activePanelId

  // 选择分屏模式
  const handleSelectSplitMode = (direction: 'horizontal' | 'vertical') => {
    setSplitMode(direction)
  }

  // 新增终端面板
  const handleAddTerminalPanel = async () => {
    if (!activeSessionId) {
      console.warn('[Toolbar] 没有活动会话，无法创建面板')
      showAlertModal(t('toolbar.noActiveSession'), t('toolbar.noActiveSession'))
      return
    }

    const onConfirm = async (selectedPath: string) => {
      try {
        if (hasSelectedPanel) {
          // 有选中面板，执行分屏
          await splitPanelWithPty(activePanelId, splitMode, selectedPath)
        } else {
          // 没有面板，创建第一个面板
          await createPanel(selectedPath)
        }
      } catch (error) {
        console.error('[Toolbar] 创建终端面板失败:', error)
      }
    }

    showPathSelectorModal(onConfirm, activeSessionId)
  }

  // 新增文件面板
  const handleAddFilePanel = async () => {
    if (!activeSessionId) {
      console.warn('[Toolbar] 没有活动会话，无法创建文件面板')
      showAlertModal(t('toolbar.noActiveSession'), t('toolbar.noActiveSession'))
      return
    }

    const onConfirm = async (selectedPath: string) => {
      try {
        if (hasSelectedPanel) {
          // 有选中面板，在其旁边分割文件面板
          await splitPanelWithFilePanel(activePanelId, splitMode, selectedPath)
        } else {
          // 没有面板，创建第一个文件面板
          await createFilePanel(selectedPath)
        }
      } catch (error) {
        console.error('[Toolbar] 创建文件面板失败:', error)
      }
    }

    showPathSelectorModal(onConfirm, activeSessionId)
  }

  // 新增浏览器面板
  const handleAddBrowserPanel = async () => {
    if (!activeSessionId) {
      console.warn('[Toolbar] 没有活动会话，无法创建浏览器面板')
      showAlertModal(t('toolbar.noActiveSession'), t('toolbar.noActiveSession'))
      return
    }

    try {
      if (hasSelectedPanel) {
        // 有选中面板，在其旁边分割浏览器面板
        await splitPanelWithBrowserPanel(activePanelId, splitMode)
      } else {
        // 没有面板，创建第一个浏览器面板
        await createBrowserPanel()
      }
    } catch (error) {
      console.error('[Toolbar] 创建浏览器面板失败:', error)
    }
  }

  // 关闭面板
  const handleClosePanel = async () => {
    if (!activePanelId) {
      console.warn('[Toolbar] 没有选中的面板，无法关闭')
      return
    }

    showConfirmModal(
      t('toolbar.confirmClosePanel'),
      t('toolbar.confirmClosePanelMsg'),
      async () => {
        try {
          await closePanel(activePanelId)
        } catch (error) {
          console.error('[Toolbar] 关闭面板失败:', error)
        }
      }
    )
  }

  // 打开目录说明面板
  const handleOpenNexusProfile = () => {
    setNexusProfileModalVisible(true)
  }

  return (
    <div className="toolbar">
      <span className="toolbar-label">{t('toolbar.operations')}</span>

      {/* 分屏按钮组 - 仅选择分屏方向 */}
      <div className="toolbar-group">
        {/* 水平分屏模式 - 左右排列 */}
        <button
          className="toolbar-btn"
          title={t('toolbar.horizontalSplitTip')}
          onClick={() => handleSelectSplitMode('horizontal')}
          style={{
            backgroundColor: splitMode === 'horizontal' ? 'var(--accent-color)' : undefined,
            color: splitMode === 'horizontal' ? '#fff' : undefined,
          }}
        >
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="7.5" height="14" rx="2"/>
            <rect x="13.5" y="5" width="7.5" height="14" rx="2"/>
            <line x1="12" y1="3" x2="12" y2="21"/>
          </svg>
        </button>

        {/* 垂直分屏模式 - 上下排列 */}
        <button
          className="toolbar-btn"
          title={t('toolbar.verticalSplitTip')}
          onClick={() => handleSelectSplitMode('vertical')}
          style={{
            backgroundColor: splitMode === 'vertical' ? 'var(--accent-color)' : undefined,
            color: splitMode === 'vertical' ? '#fff' : undefined,
          }}
        >
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="3" width="16" height="8" rx="2"/>
            <rect x="4" y="13" width="16" height="8" rx="2"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
          </svg>
        </button>
      </div>

      {/* 分割线 */}
      <div className="toolbar-divider" />

      {/* 新建终端面板按钮 */}
      <button
        className="toolbar-btn"
        title={t('toolbar.newTerminal')}
        onClick={handleAddTerminalPanel}
        disabled={!activeSessionId}
        style={{
          opacity: activeSessionId ? 1 : 0.5,
          cursor: activeSessionId ? 'pointer' : 'not-allowed',
        }}
      >
        <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12z"/>
        </svg>
      </button>

      {/* 新建文件面板按钮 */}
      <button
        className="toolbar-btn"
        title={t('toolbar.newFileBrowser')}
        onClick={handleAddFilePanel}
        disabled={!activeSessionId}
        style={{
          opacity: activeSessionId ? 1 : 0.5,
          cursor: activeSessionId ? 'pointer' : 'not-allowed',
        }}
      >
        <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
      </button>

      {/* 新建浏览器面板按钮 */}
      <button
        className="toolbar-btn"
        title={t('toolbar.newBrowser')}
        onClick={handleAddBrowserPanel}
        disabled={!activeSessionId}
        style={{
          opacity: activeSessionId ? 1 : 0.5,
          cursor: activeSessionId ? 'pointer' : 'not-allowed',
        }}
      >
        <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
      </button>

      {/* 关闭面板按钮 */}
      <button
        className="toolbar-btn"
        title={t('toolbar.closePanel')}
        onClick={handleClosePanel}
        disabled={!hasSelectedPanel}
        style={{
          opacity: hasSelectedPanel ? 1 : 0.5,
          cursor: hasSelectedPanel ? 'pointer' : 'not-allowed',
        }}
      >
        <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>

      {/* 分割线 */}
      <div className="toolbar-divider" />

      {/* 目录说明按钮 */}
      <button
        className="toolbar-btn"
        title={t('toolbar.nexusProfile')}
        onClick={handleOpenNexusProfile}
      >
        <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
        </svg>
      </button>
    </div>
  )
}

export default Toolbar
