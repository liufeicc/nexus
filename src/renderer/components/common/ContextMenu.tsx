/**
 * 右键菜单组件
 *
 * 菜单结构由 context-menu-config.ts 定义，本组件负责渲染和交互。
 */

import React, { useLayoutEffect, useRef } from 'react'
import { useAppStore } from '../../store'
import type { Session } from '@core/types'
import type { FileBrowserPanel, TerminalPanel } from '../../store/types'
import { getBasename, getParentDir, joinPath } from '../../../core/utils/path-utils'
import { buildContextMenu } from './context-menu-config'
import { useI18n } from '../../i18n'

export function ContextMenu() {
  const { contextMenu, hideContextMenu, showRenameModal, showConfirmModal, setActiveSessionId, setSessionIds, deleteSessionCache, activeSessionId, activePanelId, panels, splitPanelWithPty, closePanel, showPathSelectorModal, createPanel, createFilePanel, splitPanelWithFilePanel, fileClipboard, setFileClipboard, showToast, selectedFilePaths, createBrowserPanel, splitPanelWithBrowserPanel, replacePanelInPlace } = useAppStore()
  const { t } = useI18n()
  const [allSessions, setAllSessions] = React.useState<Session[]>([])
  const [clipboardText, setClipboardText] = React.useState('')
  const [hasSystemClipboardFiles, setHasSystemClipboardFiles] = React.useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [activeSubmenu, setActiveSubmenu] = React.useState<string | null>(null)

  const loadSessions = async () => {
    try {
      const sessions = await window.electronAPI.session.list()
      setAllSessions(sessions)
      setSessionIds(sessions.map((s: Session) => s.id))
      window.dispatchEvent(new CustomEvent('sessions-change'))
    } catch (error) {
      console.error('[ContextMenu] 加载会话列表失败:', error)
    }
  }

  React.useEffect(() => {
    loadSessions()
  }, [])

  React.useEffect(() => {
    if (contextMenu?.visible) {
      window.electronAPI.clipboard.readText().then((text: string) => {
        setClipboardText(text)
      }).catch(() => {
        setClipboardText('')
      })
      // 文件面板上下文时，检查系统剪贴板是否有文件
      const panel = panels.find(p => p.id === contextMenu.selectedPanelId)
      if (panel?.panelType === 'file-browser') {
        window.electronAPI.clipboard.readFiles().then((files: string[]) => {
          setHasSystemClipboardFiles(files && files.length > 0)
        }).catch(() => {
          setHasSystemClipboardFiles(false)
        })
      } else {
        setHasSystemClipboardFiles(false)
      }
    }
  }, [contextMenu?.visible, contextMenu?.selectedPanelId, panels])

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenu.visible || !menuRef.current) return
    const menuEl = menuRef.current
    const rect = menuEl.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    let newTop = contextMenu.y
    let newLeft = contextMenu.x
    if (rect.bottom > viewportHeight) {
      newTop = viewportHeight - rect.height
      if (newTop < 0) newTop = 0
    }
    if (rect.right > viewportWidth) {
      newLeft = viewportWidth - rect.width
      if (newLeft < 0) newLeft = 0
    }
    if (newTop !== contextMenu.y || newLeft !== contextMenu.x) {
      menuEl.style.top = `${newTop}px`
      menuEl.style.left = `${newLeft}px`
    }
  }, [contextMenu])

  if (!contextMenu || !contextMenu.visible) {
    return null
  }

  // ---- 事件处理 ----

  const handleAction = async (actionId: string) => {
    hideContextMenu()

    switch (actionId) {
      case 'copy-path': {
        const copyPath = contextMenu.rightClickedFilePath || (contextPanel?.panelType === 'file-browser' ? (contextPanel as FileBrowserPanel).currentPath : undefined)
        if (copyPath) {
          window.electronAPI.clipboard.writeText(copyPath)
          showToast(t('toast.copySuccess'), 1500)
        }
        break
      }
      case 'copy': {
        if (!contextMenu.selectedPanelId) return
        const panel = panels.find(p => p.id === contextMenu.selectedPanelId)
        if (panel?.panelType === 'file-browser') {
          const selectedText = contextMenu.rightClickedSelectedText

          if (selectedText) {
            // 文件查看器中有文本选中：复制选中文本到系统剪贴板
            window.electronAPI.clipboard.writeText(selectedText)
            showToast(t('toast.copySuccess'), 1500)
          } else {
            // 否则复制文件路径到文件剪贴板
            const paths = selectedFilePaths.get(contextMenu.selectedPanelId) ?? new Set()
            if (paths.size === 0) return
            setFileClipboard(Array.from(paths))
            showToast(t('fileOps.copyToast').replace('{n}', String(paths.size)), 1500)
          }
        } else {
          const copyEvent = new CustomEvent('terminal-copy', { detail: { panelId: contextMenu.selectedPanelId } })
          window.dispatchEvent(copyEvent)
        }
        break
      }
      case 'paste': {
        if (!contextMenu.selectedPanelId) return
        const panel = panels.find(p => p.id === contextMenu.selectedPanelId)
        if (panel?.panelType === 'file-browser') {
          const fp = panel as any
          const isViewingFile = fp.activeFile !== null

          // 文件查看器打开时，优先尝试粘贴文本
          if (isViewingFile && clipboardText) {
            // 尝试触发编辑器的粘贴（需要聚焦编辑器）
            // 这里简单地将剪贴板文本发送到编辑器
            window.dispatchEvent(new CustomEvent('file-viewer-paste-text', {
              detail: { text: clipboardText }
            }))
          } else {
            // 文件面板：粘贴文件
            if (!fileClipboard || fileClipboard.paths.length === 0) {
              // 尝试从系统剪贴板读取文件
              try {
                const systemFiles = await window.electronAPI.clipboard.readFiles()
                if (!systemFiles || systemFiles.length === 0) return
              } catch {
                return
              }
            }
            if (!panel.currentPath) return
            window.dispatchEvent(new CustomEvent('file-paste-request', {
              detail: { panelId: contextMenu.selectedPanelId, targetDir: panel.currentPath },
            }))
          }
        } else {
          // 终端面板：粘贴文本
          const text = await window.electronAPI.clipboard.readText()
          if (text && (panel as TerminalPanel)?.ptyId) {
            await window.electronAPI.pty.write((panel as TerminalPanel).ptyId, text)
            window.dispatchEvent(new CustomEvent('terminal-paste', { detail: { panelId: contextMenu.selectedPanelId } }))
          }
        }
        break
      }
      case 'new-session': {
        try {
          const newSession = await window.electronAPI.session.create()
          await window.electronAPI.session.setActive(newSession.id)
          setActiveSessionId(newSession.id)
          await loadSessions()
        } catch (error) {
          console.error('[ContextMenu] 创建会话失败:', error)
        }
        break
      }
      case 'rename-session': {
        const sid = contextMenu.selectedSessionId
        if (!sid) return
        const session = await window.electronAPI.session.get(sid)
        if (session) showRenameModal(sid, session.name)
        break
      }
      case 'delete-session': {
        const sid = contextMenu.selectedSessionId
        if (!sid) return
        const session = allSessions.find(s => s.id === sid)
        if (!session) return
        showConfirmModal(t('session.deleteSession'), `${t('session.confirmDelete').replace('{name}', session.name)}`, async () => {
          try {
            await window.electronAPI.session.delete(sid)
            await loadSessions()
            deleteSessionCache(sid)
            if (activeSessionId === sid) setActiveSessionId(null)
          } catch (error) {
            console.error('[ContextMenu] 删除会话失败:', error)
          }
        })
        break
      }
      case 'cut': {
        const pid = contextMenu.selectedPanelId
        if (!pid) return
        const cutPanel = panels.find(p => p.id === pid)
        if (cutPanel?.panelType === 'file-browser') {
          const selectedText = contextMenu.rightClickedSelectedText

          if (selectedText) {
            // 文件查看器中有文本选中：触发 CodeMirror 的剪切（调用内置 cut 命令）
            window.dispatchEvent(new CustomEvent('file-viewer-cut', {
              detail: { panelId: pid }
            }))
          } else {
            // 否则剪切文件
            const paths = selectedFilePaths.get(pid) ?? new Set()
            if (paths.size === 0) return
            setFileClipboard(Array.from(paths), 'cut')
            showToast(t('fileOps.cutToast').replace('{n}', String(paths.size)), 1500)
          }
        }
        break
      }
      case 'paste-file': {
        if (!fileClipboard || fileClipboard.paths.length === 0) return
        const panel = panels.find(p => p.id === contextMenu?.selectedPanelId)
        if (!panel || panel.panelType !== 'file-browser' || !panel.currentPath) return
        window.dispatchEvent(new CustomEvent('file-paste-request', {
          detail: { panelId: contextMenu.selectedPanelId, targetDir: panel.currentPath },
        }))
        break
      }
      case 'trash-file': {
        const pid = contextMenu.selectedPanelId
        const paths = selectedFilePaths.get(pid ?? '') ?? new Set()
        if (paths.size === 0) return
        showConfirmModal(t('fileOps.deleteTitle'), t('fileOps.deleteConfirmMsg').replace('{n}', String(paths.size)), async () => {
          try {
            const result = await window.electronAPI.fs.trashItem(Array.from(paths))
            if (result.successCount > 0) showToast(t('fileOps.moveToTrashSuccess').replace('{n}', String(result.successCount)), 2000)
            if (result.errorCount > 0) console.error('[ContextMenu] 部分删除失败:', result.errors)
            window.dispatchEvent(new CustomEvent('files-trashed', { detail: { paths: Array.from(paths) } }))
          } catch (error) {
            console.error('[ContextMenu] 删除文件失败:', error)
            showToast(t('fileOps.deleteError'), 2000)
          }
        })
        break
      }
      case 'rename': {
        const pid = contextMenu.selectedPanelId
        let targetPath = contextMenu.rightClickedFilePath
        if (!targetPath) {
          const paths = selectedFilePaths.get(pid ?? '') ?? new Set()
          targetPath = Array.from(paths)[0]
        }
        if (targetPath && pid) {
          useAppStore.getState().showFileRenameModal(targetPath, pid)
        }
        break
      }
      case 'new-folder':
      case 'new-text': {
        const pid = contextMenu.selectedPanelId
        const panel = panels.find(p => p.id === pid)
        if (!panel || panel.panelType !== 'file-browser') return
        const targetDir = contextMenu.rightClickedFilePath ? getParentDir(contextMenu.rightClickedFilePath) : (panel.currentPath || '')
        if (!targetDir) return
        const fileName = actionId === 'new-folder' ? t('fileOps.defaultFolderName') : t('fileOps.defaultFileName')
        const filePath = joinPath(targetDir, fileName)
        const result = actionId === 'new-folder'
          ? await window.electronAPI.fs.createDir(filePath)
          : await window.electronAPI.fs.createFile(filePath, '')
        if (result.error) {
          // 将主进程返回的错误消息映射为 i18n 翻译
          const errorMap: Record<string, string> = {
            '无法创建文件夹：重名过多': t('fileOps.createFolderFailed'),
            '无法创建文件：重名过多': t('fileOps.createFileFailed'),
          }
          showToast(t('fileOps.createFailed').replace('{error}', errorMap[result.error] || result.error), 2000)
        }
        else showToast(t('fileOps.created').replace('{name}', getBasename(result.resolvedPath)), 1500)
        break
      }
      case 'split-horizontal':
      case 'split-vertical': {
        const direction = actionId === 'split-horizontal' ? 'horizontal' : 'vertical'
        const targetPanelId = contextMenu.selectedPanelId
        const onConfirm = async (selectedPath: string) => {
          try {
            if (targetPanelId) await splitPanelWithPty(targetPanelId, direction, selectedPath)
            else if (activeSessionId) await createPanel(selectedPath)
          } catch (error) {
            console.error('[ContextMenu] 分屏失败:', error)
          }
        }
        useAppStore.getState().showPathSelectorModal(onConfirm, activeSessionId || undefined)
        break
      }
      case 'split-horizontal-file':
      case 'split-vertical-file': {
        const direction = actionId.includes('horizontal') ? 'horizontal' : 'vertical'
        const onConfirm = async (selectedPath: string) => {
          try {
            if (contextMenu.selectedPanelId) await splitPanelWithFilePanel(contextMenu.selectedPanelId, direction, selectedPath)
            else if (activeSessionId) await createFilePanel(selectedPath)
          } catch (error) {
            console.error('[ContextMenu] 创建文件面板失败:', error)
          }
        }
        useAppStore.getState().showPathSelectorModal(onConfirm, activeSessionId || undefined)
        break
      }
      case 'split-horizontal-browser':
      case 'split-vertical-browser': {
        const targetPanelId = contextMenu.selectedPanelId
        if (targetPanelId) {
          try { await splitPanelWithBrowserPanel(targetPanelId, actionId.includes('horizontal') ? 'horizontal' : 'vertical') }
          catch (error) { console.error('[ContextMenu] 创建浏览器面板失败:', error) }
        } else if (activeSessionId) {
          try { await createBrowserPanel() }
          catch (error) { console.error('[ContextMenu] 创建浏览器面板失败:', error) }
        }
        break
      }
      case 'replace-terminal': {
        const targetPanelId = contextMenu.selectedPanelId
        if (!targetPanelId) return
        const panel = panels.find(p => p.id === targetPanelId)
        if (!panel) return
        showPathSelectorModal(async (selectedPath) => {
          try {
            const ptyId = await window.electronAPI.pty.create({
              cwd: selectedPath,
              shell: window.electronAPI.platform.isWindows ? 'powershell.exe' : undefined,
            })
            if (!ptyId) { showToast(t('toast.createTerminalFailed')); return }
            if (panel.panelType === 'terminal' && panel.ptyId) { try { window.electronAPI.pty.kill(panel.ptyId) } catch {} }
            replacePanelInPlace(targetPanelId, {
              panelType: 'terminal', ptyId, cwd: selectedPath,
              title: t('panel.terminal') + ' - ' + getBasename(selectedPath),
            })
            useAppStore.getState().saveSnapshot(useAppStore.getState().activeSessionId!)
          } catch (error) {
            console.error('[ContextMenu] 替换为终端面板失败:', error)
            showToast(t('toast.createTerminalFailed'))
          }
        })
        break
      }
      case 'replace-file': {
        const targetPanelId = contextMenu.selectedPanelId
        if (!targetPanelId) return
        const panel = panels.find(p => p.id === targetPanelId)
        if (!panel) return
        showPathSelectorModal((selectedPath) => {
          if (panel.panelType === 'terminal' && panel.ptyId) { try { window.electronAPI.pty.kill(panel.ptyId) } catch {} }
          replacePanelInPlace(targetPanelId, {
            panelType: 'file-browser', rootPath: selectedPath, currentPath: selectedPath,
            openFiles: [], activeFile: null,
            title: t('panel.fileBrowser') + ' - ' + getBasename(selectedPath),
          })
          useAppStore.getState().saveSnapshot(useAppStore.getState().activeSessionId!)
        })
        break
      }
      case 'replace-browser': {
        const targetPanelId = contextMenu.selectedPanelId
        if (!targetPanelId) return
        const panel = panels.find(p => p.id === targetPanelId)
        if (!panel) return
        ;(async () => {
          let resolvedUrl = 'about:blank'
          try {
            const defaultUrl = await window.electronAPI.config.get('browserDefaultUrl')
            if (defaultUrl && typeof defaultUrl === 'string' && defaultUrl.trim()) resolvedUrl = defaultUrl.trim()
          } catch {}
          const initialTabId = `tab-${Date.now()}-init`
          if (panel.panelType === 'terminal' && panel.ptyId) { try { window.electronAPI.pty.kill(panel.ptyId) } catch {} }
          replacePanelInPlace(targetPanelId, {
            panelType: 'browser', title: t('panel.browser'),
            browserTabs: new Map([[initialTabId, { id: initialTabId, url: resolvedUrl, title: t('panel.newTab'), isLoading: false }]]),
            activeTabId: initialTabId,
          })
          useAppStore.getState().saveSnapshot(useAppStore.getState().activeSessionId!)
        })()
        break
      }
      case 'close-panel': {
        const targetPanelId = contextMenu.selectedPanelId
        if (!targetPanelId) return
        showConfirmModal(t('toolbar.confirmClosePanel'), t('toolbar.confirmClosePanelMsg'), async () => {
          try { await closePanel(targetPanelId) }
          catch (error) { console.error('[ContextMenu] 关闭面板失败:', error) }
        })
        break
      }
    }
  }

  // ---- 构建菜单数据 ----

  const contextPanel = panels.find(p => p.id === contextMenu?.selectedPanelId)
  const isFilePanel = contextPanel?.panelType === 'file-browser'
  const isFileViewerOpen = isFilePanel && !!(contextPanel as any).activeFile
  const viewerSelectedText = !!(contextMenu?.rightClickedSelectedText && contextMenu.rightClickedSelectedText.length > 0)
  const hasSelectedSession = !!contextMenu.selectedSessionId
  const hasSelectedPanel = !!contextMenu?.selectedPanelId
  const hasActiveSession = !!activeSessionId
  const hasTerminalSelection = !!contextMenu?.hasTerminalSelection
  const hasClipboardText = clipboardText.length > 0
  const hasFileClipboard = (fileClipboard !== null && fileClipboard.paths.length > 0) || hasSystemClipboardFiles
  const selectedPanelPaths = contextMenu?.selectedPanelId ? (selectedFilePaths.get(contextMenu.selectedPanelId) ?? new Set()) : new Set()
  const hasFileSelection = selectedPanelPaths.size > 0

  const menuItems = buildContextMenu({
    isFilePanel, hasSelectedSession, hasSelectedPanel, hasActiveSession,
    hasTerminalSelection, hasClipboardText, hasFileClipboard, hasFileSelection,
    isFileViewerOpen, viewerSelectedText,
  })

  // ---- 渲染 ----

  const renderMenuItem = (item: ReturnType<typeof buildContextMenu>[0]) => {
    if (item.dividerBefore) {
      return <div key={`divider-${item.id}`} className="context-menu-divider" />
    }

    const enabled = item.enabled !== false

    if (item.children) {
      return (
        <div
          key={item.id}
          className="context-menu-item context-menu-submenu"
          onMouseEnter={() => { if (enabled) setActiveSubmenu(item.id) }}
          onMouseLeave={() => setActiveSubmenu(null)}
          onClick={(e) => e.stopPropagation()}
        >
          <svg className="icon" viewBox="0 0 24 24" fill={item.strokeIcon ? 'none' : (item.iconColor || 'currentColor')} stroke={item.strokeIcon ? 'currentColor' : undefined} strokeWidth={item.strokeIcon ? 1.5 : undefined} strokeLinecap={item.strokeIcon ? 'round' : undefined} strokeLinejoin={item.strokeIcon ? 'round' : undefined}>
            <path d={item.icon} />
          </svg>
          <span>{item.label ? t(item.label) : ''}</span>
          <svg className="submenu-arrow" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
          </svg>
          {activeSubmenu === item.id && (
            <div className="context-menu-submenu-panel" onClick={(e) => e.stopPropagation()}>
              {item.children.map(child => renderMenuItem(child))}
            </div>
          )}
        </div>
      )
    }

    return (
      <div
        key={item.id}
        className={`context-menu-item ${!enabled ? 'disabled' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          if (enabled) handleAction(item.id)
          else hideContextMenu()
        }}
      >
        <svg className="icon" viewBox="0 0 24 24" fill={item.strokeIcon ? 'none' : (item.iconColor || 'currentColor')} stroke={item.strokeIcon ? 'currentColor' : undefined} strokeWidth={item.strokeIcon ? 1.5 : undefined} strokeLinecap={item.strokeIcon ? 'round' : undefined} strokeLinejoin={item.strokeIcon ? 'round' : undefined}>
          <path d={item.icon} />
        </svg>
        <span>{item.label ? t(item.label) : ''}</span>
      </div>
    )
  }

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ top: contextMenu.y, left: contextMenu.x, position: 'fixed', zIndex: 1000 }}
      onClick={(e) => { e.stopPropagation(); hideContextMenu() }}
    >
      {menuItems.map(renderMenuItem)}
    </div>
  )
}

export default ContextMenu
