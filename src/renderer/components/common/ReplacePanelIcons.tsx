/**
 * 替换面板图标条
 *
 * 点击"替换面板"按钮后，在按钮左侧滑出 3 个小图标（终端/文件/浏览器），
 * 点击图标后执行与右键菜单"替换面板"相同的逻辑。
 * 纯内联渲染，不依赖 Portal。
 */

import React, { useEffect, useRef, useCallback } from 'react'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../store'

interface ReplacePanelIconsProps {
  /** 要替换的面板 ID */
  panelId: string
  onClose: () => void
}

export function ReplacePanelIcons({ panelId, onClose }: ReplacePanelIconsProps) {
  const { t } = useI18n()
  const {
    panels,
    replacePanelInPlace,
    saveSnapshot,
    activeSessionId,
    showPathSelectorModal,
    showToast,
  } = useAppStore()

  const barRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const bar = barRef.current
      if (!bar) return
      if (!bar.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // 使用捕获阶段监听，确保不被其他 stopPropagation 阻止
    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

  const handleReplace = useCallback(async (type: 'terminal' | 'file' | 'browser') => {
    const panel = panels.find(p => p.id === panelId)
    if (!panel) return

    if (type === 'terminal') {
      // 先弹出路径选择，选完再 kill 旧 PTY 并替换
      showPathSelectorModal(async (selectedPath) => {
        try {
          const ptyId = await window.electronAPI.pty.create({
            cwd: selectedPath,
            shell: window.electronAPI.platform.isWindows ? 'powershell.exe' : undefined,
          })
          if (!ptyId) {
            showToast(t('toast.createTerminalFailed'))
            return
          }
          // 替换前才 kill 旧 PTY，避免用户选择路径时终端先显示"进程已退出"
          if (panel.panelType === 'terminal' && panel.ptyId) {
            try { window.electronAPI.pty.kill(panel.ptyId) } catch {}
          }
          replacePanelInPlace(panelId, {
            panelType: 'terminal',
            ptyId,
            cwd: selectedPath,
            title: `${t('panel.terminal')} - ${selectedPath.split('/').pop() || selectedPath}`,
          })
          saveSnapshot(activeSessionId!)
          onClose()
        } catch (error) {
          console.error('[ReplacePanel] 替换为终端面板失败:', error)
          showToast(t('toast.createTerminalFailed'))
        }
      })
    } else if (type === 'file') {
      // 文件面板替换前 kill 旧 PTY
      showPathSelectorModal((selectedPath) => {
        if (panel.panelType === 'terminal' && panel.ptyId) {
          try { window.electronAPI.pty.kill(panel.ptyId) } catch {}
        }
        replacePanelInPlace(panelId, {
          panelType: 'file-browser',
          rootPath: selectedPath,
          currentPath: selectedPath,
          openFiles: [],
          activeFile: null,
          title: `${t('panel.fileBrowser')} - ${selectedPath.split('/').pop() || selectedPath}`,
        })
        saveSnapshot(activeSessionId!)
        onClose()
      })
    } else {
      // 浏览器面板替换前 kill 旧 PTY
      let resolvedUrl = 'about:blank'
      try {
        const defaultUrl = await window.electronAPI.config.get('browserDefaultUrl')
        if (defaultUrl && typeof defaultUrl === 'string' && defaultUrl.trim()) {
          resolvedUrl = defaultUrl.trim()
        }
      } catch {}
      if (panel.panelType === 'terminal' && panel.ptyId) {
        try { window.electronAPI.pty.kill(panel.ptyId) } catch {}
      }
      const initialTabId = `tab-${Date.now()}-init`
      const initialTab = { id: initialTabId, url: resolvedUrl, title: t('panel.newTab'), isLoading: false }
      replacePanelInPlace(panelId, {
        panelType: 'browser',
        title: t('panel.browser'),
        browserTabs: new Map([[initialTabId, initialTab]]),
        activeTabId: initialTabId,
      })
      saveSnapshot(activeSessionId!)
      onClose()
    }
  }, [panelId, panels, replacePanelInPlace, saveSnapshot, activeSessionId, showPathSelectorModal, showToast, onClose, t])

  return (
    <div ref={barRef} className="replace-panel-bar">
      <div
        className="replace-panel-bar-item"
        title={t('panel.terminalPanel')}
        onClick={(e) => {
          e.stopPropagation()
          handleReplace('terminal')
        }}
      >
        <svg viewBox="0 0 24 24" fill="#4caf50">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM7.5 13l2.5 2.5 5-6L16 8l-6 7-2.5-2.5z" />
        </svg>
      </div>
      <div
        className="replace-panel-bar-item"
        title={t('panel.filePanel')}
        onClick={(e) => {
          e.stopPropagation()
          handleReplace('file')
        }}
      >
        <svg viewBox="0 0 24 24" fill="#42a5f5">
          <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
        </svg>
      </div>
      <div
        className="replace-panel-bar-item"
        title={t('panel.browserPanel')}
        onClick={(e) => {
          e.stopPropagation()
          handleReplace('browser')
        }}
      >
        <svg viewBox="0 0 24 24" fill="#ff9800">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
        </svg>
      </div>
    </div>
  )
}
