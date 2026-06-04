/**
 * 文件查看器 Hook
 * 从 FileBrowserPanel.tsx 提取
 * 职责：文件查看器状态管理、文件内容读取/监听、打开/关闭/切换文件
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppStore, type OpenFileEntry } from '../../store'
import { t } from '../../i18n'
import type { FileBrowserPanel as FileBrowserPanelType } from '../../store/types'
import type { FileType } from './file-viewer-constants'
import { getFileType } from './file-viewer-constants'
import { getBasename } from '../../../core/utils/path-utils'

export interface UseFileViewerInput {
  panelId: string
  isFileSupported: (fileName: string) => boolean
  currentPathRef: React.MutableRefObject<string>
}

export interface UseFileViewerOutput {
  activeFile: string | null
  viewerContent: string
  viewerFileName: string
  viewerFilePath: string
  viewerFileType: FileType
  viewerFileBase64: string
  viewerFileMimeType: string
  currentPdfPage: number
  currentXlsxSheet: number
  isDirty: boolean
  fileContentsMap: Map<string, string>
  fileBase64Map: Map<string, { base64: string; mimeType: string }>
  pdfPageRef: React.MutableRefObject<number>
  setCurrentXlsxSheet: React.Dispatch<React.SetStateAction<number>>
  handleOpenFile: (filePath: string, fileName: string) => Promise<void>
  handleSwitchFile: (filePath: string) => Promise<void>
  handleSaveFile: () => Promise<void>
  handleCloseFile: (filePath: string) => Promise<void>
  handleExitViewer: () => void
  handleBackToGrid: () => void
  handleContentChange: (newContent: string) => void
}

/** 读取文件内容的辅助函数 */
async function readTextFile(path: string): Promise<string> {
  const result = await window.electronAPI.fs.readFile(path)
  return result.error ? `[读取失败] ${result.error}` : result.content
}

async function readBinaryFile(path: string): Promise<{ base64: string; mimeType: string; error?: string }> {
  const result = await window.electronAPI.fs.readFileAsBase64(path)
  return { base64: result.base64, mimeType: result.mimeType, error: result.error ?? undefined }
}

export function useFileViewer({
  panelId,
  isFileSupported,
  currentPathRef,
}: UseFileViewerInput): UseFileViewerOutput {
  const { updatePanelFileState, showToast, showConfirmModal } = useAppStore()

  /** 更新文件面板的 openFiles 和 activeFile */
  const setPanelFileState = useCallback((updates: { openFiles?: OpenFileEntry[]; activeFile?: string | null }) => {
    updatePanelFileState(panelId, updates)
  }, [panelId, updatePanelFileState])

  // ===== 从 store 读取文件面板状态 =====

  const panels = useAppStore(state => state.panels)
  const panelState = panels.find(p => p.id === panelId) as FileBrowserPanelType | undefined
  const openFiles: OpenFileEntry[] = panelState?.openFiles || []
  const activeFile: string | null = panelState?.activeFile ?? null

  /** 文件查看器状态 - 使用 Map 存储每个文件的内容 */
  const [fileContentsMap, setFileContentsMap] = useState<Map<string, string>>(new Map())
  const [fileBase64Map, setFileBase64Map] = useState<Map<string, { base64: string; mimeType: string }>>(new Map())
  const [viewerFileName, setViewerFileName] = useState('')
  const [viewerFilePath, setViewerFilePath] = useState('')
  const [viewerFileType, setViewerFileType] = useState<FileType>('text')

  /** 当前激活文件的派生 state */
  const viewerContent = fileContentsMap.get(viewerFilePath) || ''
  const viewerFileBase64 = fileBase64Map.get(viewerFilePath)?.base64 || ''
  const viewerFileMimeType = fileBase64Map.get(viewerFilePath)?.mimeType || ''

  /** 更新文件内容 Map */
  const setFileContent = useCallback((filePath: string, content: string) => {
    setFileContentsMap(prev => {
      const next = new Map(prev)
      next.set(filePath, content)
      return next
    })
  }, [])

  /** 更新文件 base64 Map */
  const setFileBase64 = useCallback((filePath: string, base64: string, mimeType: string) => {
    setFileBase64Map(prev => {
      const next = new Map(prev)
      next.set(filePath, { base64, mimeType })
      return next
    })
  }, [])

  /** 文件是否有未保存的编辑 */
  const [isDirty, setIsDirty] = useState(false)

  /** PDF 页码 */
  const [currentPdfPage, setCurrentPdfPage] = useState(1)
  const pdfPageRef = useRef(1)
  useEffect(() => {
    pdfPageRef.current = currentPdfPage
  }, [currentPdfPage])

  /** XLSX Sheet 索引 */
  const [currentXlsxSheet, setCurrentXlsxSheet] = useState(0)

  /** 文件变化事件的 debounce timer */
  const fileWatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 当前正在监听的的文件路径 */
  const watchedFilePathRef = useRef<string | null>(null)

  // ===== 组件重新挂载后，自动恢复文件内容 =====
  useEffect(() => {
    if (activeFile && !viewerFilePath) {
      const fileName = getBasename(activeFile)
      const fileType = getFileType(fileName)
      setViewerFileName(fileName)
      setViewerFilePath(activeFile)
      setViewerFileType(fileType)

      if (fileType === 'pdf') {
        const fileEntry = openFiles.find(f => f.path === activeFile)
        const savedPage = fileEntry?.pdfPage
        if (savedPage && savedPage > 1) {
          pdfPageRef.current = savedPage
          setCurrentPdfPage(savedPage)
        } else {
          pdfPageRef.current = 1
          setCurrentPdfPage(1)
        }
      }

      if (fileType === 'xlsx') {
        const fileEntry = openFiles.find(f => f.path === activeFile)
        setCurrentXlsxSheet(fileEntry?.xlsxSheet ?? 0)
      }

      if (fileType !== 'text') {
        readBinaryFile(activeFile).then(result => {
          if (result.error) {
            setFileContent(activeFile, `[读取失败] ${result.error}`)
          } else {
            setFileBase64(activeFile, result.base64, result.mimeType)
          }
        })
      } else {
        readTextFile(activeFile).then(content => setFileContent(activeFile, content))
      }
    }
  }, [activeFile, viewerFilePath, openFiles])

  // ===== 组件卸载前，保存当前查看位置到 store =====
  useEffect(() => {
    return () => {
      if (!activeFile) return

      const currentOpenFiles = (useAppStore.getState().panels.find(p => p.id === panelId) as FileBrowserPanelType | undefined)?.openFiles || []
      const updates: Record<string, unknown> = {}

      if (viewerFileType === 'pdf') {
        const page = pdfPageRef.current
        if (page > 1) updates.pdfPage = page
      } else if (viewerFileType === 'xlsx') {
        updates.xlsxSheet = currentXlsxSheet
      }

      if (Object.keys(updates).length > 0) {
        const updatedFiles = currentOpenFiles.map(f =>
          f.path === activeFile ? { ...f, ...updates } : f
        )
        updatePanelFileState(panelId, { openFiles: updatedFiles })
      }
    }
  }, [activeFile, viewerFileType, panelId, updatePanelFileState, currentXlsxSheet])

  // ===== 文件内容监听 =====
  useEffect(() => {
    const thisPath = activeFile
    if (thisPath) {
      window.electronAPI.fs.watchFile(thisPath).catch(() => {})
      watchedFilePathRef.current = thisPath
    }

    return () => {
      if (watchedFilePathRef.current === thisPath && thisPath !== null) {
        window.electronAPI.fs.unwatchFile(thisPath).catch(() => {})
        watchedFilePathRef.current = null
      }
      if (fileWatchTimerRef.current) {
        clearTimeout(fileWatchTimerRef.current)
        fileWatchTimerRef.current = null
      }
    }
  }, [activeFile])

  // 监听目录/文件变更的 ref 持有最新 handleCloseFile
  const handleCloseFileRef = useRef<(filePath: string) => void>(() => {})

  // 监听文件变更事件
  useEffect(() => {
    const unsubscribe = window.electronAPI.fs.onFileChanged(({ filePath, eventType, newPath }) => {
      if (filePath !== watchedFilePathRef.current) return

      if (eventType === 'deleted') {
        handleCloseFileRef.current(filePath)
        return
      }

      if (eventType === 'renamed' && newPath) {
        const newFileName = getBasename(newPath)
        const newFileType = getFileType(newFileName)

        watchedFilePathRef.current = newPath

        const currentOpenFiles = (useAppStore.getState().panels.find(p => p.id === panelId) as FileBrowserPanelType | undefined)?.openFiles || []
        const newOpenFiles = currentOpenFiles.map((f: OpenFileEntry) =>
          f.path === filePath ? { ...f, path: newPath, name: newFileName, pdfPage: newFileType === 'pdf' ? f.pdfPage : undefined, xlsxSheet: newFileType === 'xlsx' ? f.xlsxSheet : undefined } : f
        )
        updatePanelFileState(panelId, { openFiles: newOpenFiles, activeFile: newPath })

        setViewerFileName(newFileName)
        setViewerFilePath(newPath)
        setViewerFileType(newFileType)

        if (newFileType !== 'text') {
          readBinaryFile(newPath).then(result => {
            if (result.error) {
              setFileContent(newPath, `[读取失败] ${result.error}`)
            } else {
              setFileBase64(newPath, result.base64, result.mimeType)
            }
          })
        } else {
          readTextFile(newPath).then(content => setFileContent(newPath, content))
        }
        return
      }

      // eventType === 'change': 防抖后重读
      if (fileWatchTimerRef.current) {
        clearTimeout(fileWatchTimerRef.current)
      }

      fileWatchTimerRef.current = setTimeout(() => {
        const currentWatchedPath = watchedFilePathRef.current
        if (!currentWatchedPath) return

        const currentType = viewerFileType
        if (currentType === 'text') {
          readTextFile(currentWatchedPath).then((content) => {
            if (currentWatchedPath !== watchedFilePathRef.current) return
            setFileContent(currentWatchedPath, content)
          })
        } else {
          readBinaryFile(currentWatchedPath).then((result) => {
            if (currentWatchedPath !== watchedFilePathRef.current) return
            if (result.error) {
              setFileContent(currentWatchedPath, `[读取失败] ${result.error}`)
            } else {
              setFileBase64(currentWatchedPath, result.base64, result.mimeType)
            }
          })
        }
        fileWatchTimerRef.current = null
      }, 300)
    })

    return () => {
      unsubscribe()
      if (fileWatchTimerRef.current) {
        clearTimeout(fileWatchTimerRef.current)
        fileWatchTimerRef.current = null
      }
    }
  }, [viewerFileType, panelId, updatePanelFileState])

  // ===== 文件操作 =====

  /** 打开文件查看器 */
  const handleOpenFile = useCallback(async (filePath: string, fileName: string) => {
    if (!isFileSupported(fileName)) {
      // 不支持内置查看器的文件，使用系统默认程序打开
      const result = await window.electronAPI.fs.openWithSystem(filePath)
      if (result.error) {
        showToast(t('fileViewer.unsupportedFileType'), 2000)
      }
      return
    }

    const fileType = getFileType(fileName)

    const existingIndex = openFiles.findIndex(f => f.path === filePath)
    if (existingIndex !== -1) {
      // 文件已在 openFiles 中，只需激活它
      setViewerFileType(fileType)
      setViewerFileName(fileName)
      setViewerFilePath(filePath)
      setPanelFileState({ activeFile: filePath })
      setIsDirty(false)
      if (fileType === 'xlsx') setCurrentXlsxSheet(0)
      return
    }

    // 首次打开新文件，读取内容并添加到 openFiles
    if (fileType !== 'text') {
      const result = await readBinaryFile(filePath)
      if (result.error) {
        showToast(result.error, 2000)
        return
      }
      setFileBase64(filePath, result.base64, result.mimeType)
    } else {
      const content = await readTextFile(filePath)
      if (content.startsWith('[读取失败]')) {
        showToast(content, 2000)
        return
      }
      setFileContent(filePath, content)
    }

    const newEntry: OpenFileEntry = { path: filePath, name: fileName }
    setPanelFileState({ openFiles: [...openFiles, newEntry], activeFile: filePath })
    setViewerFileType(fileType)
    setViewerFileName(fileName)
    setViewerFilePath(filePath)
    setIsDirty(false)
    if (fileType === 'xlsx') setCurrentXlsxSheet(0)
  }, [openFiles, isFileSupported, showToast, setPanelFileState, viewerFilePath])

  /** 切换查看文件 */
  const handleSwitchFile = useCallback(async (filePath: string) => {
    const file = openFiles.find(f => f.path === filePath)
    if (!file) return

    const fileType = getFileType(file.name)
    setViewerFileType(fileType)
    setPanelFileState({ activeFile: filePath })
    setViewerFileName(file.name)
    setViewerFilePath(file.path)
    setIsDirty(false)

    if (fileType === 'xlsx') {
      setCurrentXlsxSheet(file.xlsxSheet ?? 0)
    }
  }, [openFiles, setPanelFileState])

  /** 编辑器内容变化回调 */
  const handleContentChange = useCallback((newContent: string) => {
    if (viewerFilePath) {
      setFileContent(viewerFilePath, newContent)
    }
    setIsDirty(true)
  }, [viewerFilePath, setFileContent])

  /** 保存文件 */
  const handleSaveFile = useCallback(async () => {
    if (!activeFile || viewerFileType !== 'text') return
    const result = await window.electronAPI.fs.writeFile(activeFile, viewerContent)
    if (result.error) {
      showToast(t('fileViewer.saveErrorMsg').replace('{error}', result.error), 3000)
      return
    }
    setIsDirty(false)
  }, [activeFile, viewerFileType, viewerContent, showToast])

  /** 执行关闭文件的后续逻辑 */
  const doCloseFile = useCallback((filePath: string) => {
    const currentOpenFiles = (useAppStore.getState().panels.find(p => p.id === panelId) as FileBrowserPanelType | undefined)?.openFiles || []
    const currentActiveFile = (useAppStore.getState().panels.find(p => p.id === panelId) as FileBrowserPanelType | undefined)?.activeFile

    const newFiles = currentOpenFiles.filter((f: OpenFileEntry) => f.path !== filePath)

    if (filePath === currentActiveFile) {
      if (newFiles.length > 0) {
        const nextFile = newFiles[0]
        const nextFileType = getFileType(nextFile.name)
        setPanelFileState({ openFiles: newFiles, activeFile: nextFile.path })
        setViewerFileType(nextFileType)
        setViewerFileName(nextFile.name)
        setViewerFilePath(nextFile.path)
        setIsDirty(false)
        if (nextFileType === 'xlsx') {
          setCurrentXlsxSheet(nextFile.xlsxSheet ?? 0)
        }
        if (nextFileType !== 'text') {
          readBinaryFile(nextFile.path).then(result => {
            if (result.error) {
              setFileContent(nextFile.path, `[读取失败] ${result.error}`)
            } else {
              setFileBase64(nextFile.path, result.base64, result.mimeType)
            }
          })
        } else {
          readTextFile(nextFile.path).then(content => setFileContent(nextFile.path, content))
        }
      } else {
        setPanelFileState({ openFiles: [], activeFile: null })
        setFileContentsMap(new Map())
        setFileBase64Map(new Map())
        setIsDirty(false)
      }
    } else {
      setPanelFileState({ openFiles: newFiles })
    }
  }, [panelId, setPanelFileState])

  /** 关闭已打开的文件 */
  const handleCloseFile = useCallback(async (filePath: string) => {
    const isCurrentFile = filePath === activeFile
    if (isCurrentFile && isDirty && viewerFileType === 'text') {
      showConfirmModal(
        t('fileViewer.saveChangesTitle'),
        t('fileViewer.saveChangesMsg'),
        async () => {
          await handleSaveFile()
          doCloseFile(filePath)
        },
        () => { doCloseFile(filePath) }
      )
      return
    }
    doCloseFile(filePath)
  }, [activeFile, isDirty, viewerFileType, handleSaveFile, showConfirmModal, doCloseFile])

  /** 持有最新的 handleCloseFile 引用 */
  useEffect(() => {
    handleCloseFileRef.current = handleCloseFile
  }, [handleCloseFile])

  /** 执行退出查看器的后续逻辑 */
  const doExitViewer = useCallback(() => {
    const exitingFile = activeFile
    const currentOpenFiles = (useAppStore.getState().panels.find(p => p.id === panelId) as FileBrowserPanelType | undefined)?.openFiles || []
    const newFiles = currentOpenFiles.filter((f: OpenFileEntry) => f.path !== exitingFile)
    setPanelFileState({ openFiles: newFiles, activeFile: null })
    setFileContentsMap(new Map())
    setFileBase64Map(new Map())
    setIsDirty(false)
  }, [activeFile, panelId, setPanelFileState])

  /** 退出文件查看器 */
  const handleExitViewer = useCallback(() => {
    if (isDirty && viewerFileType === 'text') {
      showConfirmModal(
        t('fileViewer.saveChangesTitle'),
        t('fileViewer.saveChangesMsg'),
        async () => {
          await handleSaveFile()
          doExitViewer()
        },
        () => { doExitViewer() }
      )
      return
    }
    doExitViewer()
  }, [isDirty, viewerFileType, handleSaveFile, showConfirmModal, doExitViewer])

  /** 回到文件网格浏览 */
  const handleBackToGrid = useCallback(() => {
    setPanelFileState({ activeFile: null })
  }, [setPanelFileState])

  return {
    activeFile,
    viewerContent,
    viewerFileName,
    viewerFilePath,
    viewerFileType,
    viewerFileBase64,
    viewerFileMimeType,
    currentPdfPage,
    currentXlsxSheet,
    isDirty,
    fileContentsMap,
    fileBase64Map,
    pdfPageRef,
    setCurrentXlsxSheet,
    handleOpenFile,
    handleSwitchFile,
    handleSaveFile,
    handleCloseFile,
    handleExitViewer,
    handleBackToGrid,
    handleContentChange,
  }
}
