/**
 * 文件浏览器键盘快捷键 Hook
 * 从 FileBrowserPanel.tsx 提取
 * 职责：注册全局 keydown 监听，处理 Backspace/Ctrl+F/C/X/V/Escape/Delete
 */

import { useEffect } from 'react'
import { useAppStore } from '../../store'
import { t } from '../../i18n'
import { getParentDir } from '../../../core/utils/path-utils'

export interface UseKeyboardShortcutsInput {
  panelId: string
  activeFile: string | null
  currentPath: string
  selectedPaths: Set<string>
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  handleFileCopy: () => void
  handleFilePaste: (targetDir: string) => Promise<void>
  handleDeleteFiles: () => void
  handleBackToGrid: () => void
}

export function useKeyboardShortcuts({
  panelId,
  activeFile,
  currentPath,
  selectedPaths,
  searchOpen,
  setSearchOpen,
  handleFileCopy,
  handleFilePaste,
  handleDeleteFiles,
  handleBackToGrid,
}: UseKeyboardShortcutsInput) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (useAppStore.getState().activePanelId !== panelId) return

      const active = document.activeElement
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return

      if (e.key === 'Backspace' && !activeFile) {
        e.preventDefault()
        const parentPath = getParentDir(currentPath) || '/'
        useAppStore.getState().updatePanelCurrentPath(panelId, parentPath)
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !activeFile) {
        e.preventDefault()
        setSearchOpen(true)
        return
      }

      // Ctrl+F 在搜索打开时用于执行搜索/下一个
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && searchOpen) {
        e.preventDefault()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !activeFile) {
        if (!useAppStore.getState().hasTerminalSelection) {
          const paths = useAppStore.getState().selectedFilePaths.get(panelId) ?? new Set()
          e.preventDefault()
          if (paths.size > 0) {
            handleFileCopy()
          }
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'x' && !activeFile) {
        const paths = useAppStore.getState().selectedFilePaths.get(panelId) ?? new Set()
        if (paths.size > 0) {
          e.preventDefault()
          useAppStore.getState().setFileClipboard(Array.from(paths), 'cut')
          useAppStore.getState().showToast(t('fileOps.cutToast').replace('{n}', String(paths.size)), 1500)
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !activeFile) {
        e.preventDefault()
        handleFilePaste(currentPath)
        return
      }

      if (e.key === 'Escape' && activeFile) {
        e.preventDefault()
        handleBackToGrid()
        return
      }

      if (e.key === 'Escape' && searchOpen) {
        e.preventDefault()
        setSearchOpen(false)
        return
      }

      if (e.key === 'Delete' && !activeFile && selectedPaths.size > 0) {
        e.preventDefault()
        handleDeleteFiles()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [panelId, activeFile, currentPath, selectedPaths, searchOpen, setSearchOpen, handleFileCopy, handleFilePaste, handleDeleteFiles, handleBackToGrid])
}
