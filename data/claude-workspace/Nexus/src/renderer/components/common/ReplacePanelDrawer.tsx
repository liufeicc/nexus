/**
 * 替换面板抽屉组件
 *
 * 点击面板标题栏的"替换"按钮后，从按钮下方弹出，
 * 提供"终端面板"、"文件面板"、"浏览器面板"三个选项。
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../store'

interface ReplacePanelDrawerProps {
  /** 要替换的面板 ID */
  panelId: string
  /** 触发按钮的引用元素，用于定位 */
  anchorEl: HTMLButtonElement
  /** 关闭抽屉 */
  onClose: () => void
}

/** 面板类型图标 SVG path */
const PANEL_ICONS = {
  terminal: {
    path: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM7.5 13l2.5 2.5 5-6L16 8l-6 7-2.5-2.5z',
    color: '#4caf50',
    labelKey: 'panel.terminalPanel',
  },
  file: {
    path: 'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
    color: '#42a5f5',
    labelKey: 'panel.filePanel',
  },
  browser: {
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
    color: '#ff9800',
    labelKey: 'panel.browserPanel',
  },
} as const

export function ReplacePanelDrawer({ panelId, anchorEl, onClose }: ReplacePanelDrawerProps) {
  const { t } = useI18n()
  const {
    panels,
    replacePanelInPlace,
    saveSnapshot,
    activeSessionId,
    showPathSelectorModal,
    showToast,
  } = useAppStore()

  const drawerRef = useRef<HTMLDivElement>(null)

  // 计算位置：相对于面板容器定位
  const getPos = useCallback(() => {
    const rect = anchorEl.getBoundingClientRect()
    return {
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    }
  }, [anchorEl])

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const drawer = drawerRef.current
      if (!drawer) return
      if (anchorEl.contains(e.target as Node)) return
      if (!drawer.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // 使用 setTimeout 延迟注册，避免首次 mousedown 立即关闭
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEsc)
    }, 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose, anchorEl])

  // 清理旧 PTY
  const killOldPty = () => {
    const panel = panels.find(p => p.id === panelId)
    if (panel?.panelType === 'terminal' && panel.ptyId) {
      try { window.electronAPI.pty.kill(panel.ptyId) } catch {}
    }
  }

  // 替换为终端面板
  const handleReplaceTerminal = async () => {
    const panel = panels.find(p => p.id === panelId)
    if (!panel) return
    killOldPty()

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
        replacePanelInPlace(panelId, {
          panelType: 'terminal',
          ptyId,
          cwd: selectedPath,
          title: `${t('panel.terminal')} - ${selectedPath.split('/').pop() || selectedPath}`,
        })
        saveSnapshot(activeSessionId!)
        onClose()
      } catch (error) {
        console.error('[ReplacePanelDrawer] 替换为终端面板失败:', error)
        showToast(t('toast.createTerminalFailed'))
      }
    })
  }

  // 替换为文件面板
  const handleReplaceFile = () => {
    const panel = panels.find(p => p.id === panelId)
    if (!panel) return
    killOldPty()

    showPathSelectorModal((selectedPath) => {
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
  }

  // 替换为浏览器面板
  const handleReplaceBrowser = async () => {
    const panel = panels.find(p => p.id === panelId)
    if (!panel) return
    killOldPty()

    let resolvedUrl = 'about:blank'
    try {
      const defaultUrl = await window.electronAPI.config.get('browserDefaultUrl')
      if (defaultUrl && typeof defaultUrl === 'string' && defaultUrl.trim()) {
        resolvedUrl = defaultUrl.trim()
      }
    } catch {}

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

  const pos = getPos()

  return (
    <div
      ref={drawerRef}
      className="replace-panel-drawer"
      style={{
        position: 'fixed',
        top: pos.top,
        right: pos.right,
        zIndex: 9999,
      }}
    >
      {(['terminal', 'file', 'browser'] as const).map((type) => {
        const icon = PANEL_ICONS[type]
        const handler = type === 'terminal' ? handleReplaceTerminal
          : type === 'file' ? handleReplaceFile
          : handleReplaceBrowser
        return (
          <div
            key={type}
            className="replace-panel-item"
            onClick={(e) => {
              e.stopPropagation()
              handler()
            }}
          >
            <svg className="replace-panel-icon" viewBox="0 0 24 24" fill={icon.color}>
              <path d={icon.path} />
            </svg>
            <span>{t(icon.labelKey)}</span>
          </div>
        )
      })}
    </div>
  )
}
