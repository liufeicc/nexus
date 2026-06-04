/**
 * 文件操作自定义 Hook
 *
 * 封装文件复制、粘贴、删除操作，从 FileBrowserPanel 中解耦。
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useAppStore } from '../../store'
import { t } from '../../i18n'
import type { FileItem } from './FileGrid'
import { getBasename, getDirname } from '../../../core/utils/path-utils'

interface UseFileOperationsInput {
  panelId: string
  currentPath: string
  currentPathRef: React.MutableRefObject<string>
  selectedPaths: Set<string>
  items: FileItem[]
  loadDirectory: (dirPath: string) => void
}

interface UseFileOperationsOutput {
  handleFileCopy: () => void
  handleFilePaste: (targetDir: string) => Promise<void>
  handleDeleteFiles: () => void
}

/**
 * 文件操作 Hook
 */
export function useFileOperations({
  panelId,
  currentPath,
  currentPathRef,
  selectedPaths,
  items,
  loadDirectory,
}: UseFileOperationsInput): UseFileOperationsOutput {
  const { showToast, setFileClipboard, showConfirmModal } = useAppStore()

  /** 检查路径是否存在（同步缓存版），从 items 派生 */
  const existingNamesCache = useMemo(
    () => new Set(items.map(item => item.name)),
    [items]
  )

  /** 生成副本文件名，自动递增序号 */
  const generateCopyName = (name: string): string => {
    const lastDotIdx = name.lastIndexOf('.')
    let baseName: string
    let ext: string

    if (lastDotIdx > 0) {
      baseName = name.substring(0, lastDotIdx)
      ext = name.substring(lastDotIdx)
    } else {
      baseName = name
      ext = ''
    }

    const match = baseName.match(/^(.+)\(副本 (\d+)\)$/)
    const cleanBaseName = match ? match[1] : baseName

    for (let i = 1; i <= 100; i++) {
      const copyName = `${cleanBaseName}(副本 ${i})${ext}`
      if (!existingNamesCache.has(copyName)) {
        return copyName
      }
    }
    return `${cleanBaseName}(副本 100)${ext}`
  }

  /** 复制选中的文件到文件剪贴板 */
  const handleFileCopy = useCallback(() => {
    if (selectedPaths.size === 0) return
    setFileClipboard(Array.from(selectedPaths))
    showToast(t('fileOps.copyToast').replace('{n}', String(selectedPaths.size)), 1500)
  }, [selectedPaths, setFileClipboard, showToast])

  /** 粘贴文件到目标目录 */
  const handleFilePaste = useCallback(async (targetDir: string) => {
    try {
      let clipboardPaths: string[] = []
      let clipboardMode: 'copy' | 'cut' = 'copy'
      let isSystemClipboard = false

      // 步骤1：尝试从系统剪贴板读取文件路径（支持外部文件管理器复制）
      try {
        const systemFiles = await window.electronAPI.clipboard.readFiles()
        if (systemFiles && systemFiles.length > 0) {
          clipboardPaths = systemFiles
          isSystemClipboard = true
          // 系统剪贴板统一视为 copy，因为外部来源无法区分 cut/copy（macOS/Windows）
        }
      } catch {
        // 系统剪贴板读取失败，静默回退到内部 store
      }

      // 步骤2：如果系统剪贴板无文件，回退到内部 store
      if (!isSystemClipboard) {
        const internalClipboard = useAppStore.getState().fileClipboard
        if (!internalClipboard || internalClipboard.paths.length === 0) return
        clipboardPaths = internalClipboard.paths
        clipboardMode = internalClipboard.mode
      }

      const isCutMode = clipboardMode === 'cut'

      // 通知 FileBrowserPanel 开始粘贴
      window.dispatchEvent(new CustomEvent('file-paste-start', {
        detail: { panelId },
      }))

      let successCount = 0
      let skipCount = 0
      let errorCount = 0
      const cutSourcePaths: string[] = []

      for (const srcPath of clipboardPaths) {
        const fileName = getBasename(srcPath)
        const srcParent = getDirname(srcPath) || '/'
        const targetParent = targetDir

        const isSameDir = srcParent === targetParent

        let dstPath: string
        if (isSameDir) {
          // 同目录下剪切操作：不需要生成副本名，直接移动
          if (isCutMode) {
            dstPath = `${targetDir}/${fileName}`
          } else {
            const copyName = generateCopyName(fileName)
            dstPath = `${targetDir}/${copyName}`
          }
        } else {
          const checkResult = await window.electronAPI.fs.exists(`${targetDir}/${fileName}`)
          if (checkResult.exists) {
            if (!isCutMode) {
              // 复制模式：询问是否覆盖
              const confirmed = window.confirm(t('fileOps.fileExistsMsg').replace('{fileName}', fileName))
              if (!confirmed) {
                skipCount++
                continue
              }
            } else {
              // 剪切模式：跳过已存在的文件
              skipCount++
              continue
            }
          }
          dstPath = `${targetDir}/${fileName}`
        }

        const result = await window.electronAPI.fs.copyFile(srcPath, dstPath)
        if (result.error) {
          console.error(`[FileBrowser] 复制失败: ${srcPath} -> ${dstPath}`, result.error)
          errorCount++
        } else {
          successCount++
          if (isCutMode) {
            cutSourcePaths.push(srcPath)
          }
        }
      }

      // 剪切模式：复制成功后删除源文件
      if (isCutMode && cutSourcePaths.length > 0) {
        const trashResult = await window.electronAPI.fs.trashItem(cutSourcePaths)
        if (trashResult.errorCount > 0) {
          console.error('[FileBrowser] 剪切后清理源文件失败:', trashResult.errors)
        }
      }

      loadDirectory(targetDir)
      // 只有内部剪贴板才清除状态（系统剪贴板不归 Nexus 管理）
      if (!isSystemClipboard) {
        setFileClipboard(null)
      }

      // 通知 FileBrowserPanel 粘贴完成
      window.dispatchEvent(new CustomEvent('file-paste-end', {
        detail: { panelId },
      }))

      const msgs: string[] = []
      if (successCount > 0) msgs.push(t('fileOps.pasteSuccess').replace('{n}', String(successCount)))
      if (skipCount > 0) msgs.push(t('fileOps.pasteSkipped').replace('{n}', String(skipCount)))
      if (errorCount > 0) msgs.push(t('fileOps.pasteFailed').replace('{n}', String(errorCount)))
      if (msgs.length > 0) {
        showToast(t('fileOps.pasteComplete').replace('{details}', msgs.join('，')), 2000)
      }
    } catch (error) {
      console.error('[FileBrowser] 粘贴操作异常:', error)
      showToast(t('fileOps.pasteError'), 2000)
      // 异常时也要通知结束
      window.dispatchEvent(new CustomEvent('file-paste-end', {
        detail: { panelId },
      }))
    }
  }, [existingNamesCache, loadDirectory, setFileClipboard, showToast, panelId])

  /** 删除选中的文件到回收站 */
  const handleDeleteFiles = useCallback(() => {
    if (selectedPaths.size === 0) return

    showConfirmModal(
      t('fileOps.deleteTitle'),
      t('fileOps.deleteConfirmMsg').replace('{n}', String(selectedPaths.size)),
      async () => {
        try {
          const result = await window.electronAPI.fs.trashItem(Array.from(selectedPaths))
          if (result.successCount > 0) {
            showToast(t('fileOps.moveToTrashSuccess').replace('{n}', String(result.successCount)), 2000)
          }
          if (result.errorCount > 0) {
            console.error('[FileBrowser] 部分删除失败:', result.errors)
          }
          loadDirectory(currentPathRef.current!)
        } catch (error) {
          console.error('[FileBrowser] 删除文件失败:', error)
          showToast(t('fileOps.deleteError'), 2000)
        }
      }
    )
  }, [selectedPaths, showToast, loadDirectory, currentPathRef, showConfirmModal])

  /** 监听粘贴事件 */
  useEffect(() => {
    const handlePasteRequest = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.panelId === panelId && detail?.targetDir) {
        handleFilePaste(detail.targetDir)
      }
    }

    window.addEventListener('file-paste-request', handlePasteRequest)
    return () => {
      window.removeEventListener('file-paste-request', handlePasteRequest)
    }
  }, [panelId, handleFilePaste])

  return { handleFileCopy, handleFilePaste, handleDeleteFiles }
}
