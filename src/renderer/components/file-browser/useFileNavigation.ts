/**
 * 文件导航与搜索 Hook
 * 从 FileBrowserPanel.tsx 提取
 * 职责：目录导航、文件加载、搜索、文件选中管理
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useAppStore } from '../../store'
import { t } from '../../i18n'
import type { FileItem } from './FileGrid'
import { SUPPORTED_EXTENSIONS, expandTildeSync } from './file-viewer-constants'
import { getParentDir } from '../../../core/utils/path-utils'

export interface UseFileNavigationInput {
  rootPath: string
  initialCurrentPath: string | undefined
  panelId: string
  initialViewMode?: 'grid' | 'list'
}

export interface UseFileNavigationOutput {
  currentPath: string
  setCurrentPath: React.Dispatch<React.SetStateAction<string>>
  currentPathRef: React.MutableRefObject<string>
  selectedPaths: Set<string>
  setSelectedPaths: React.Dispatch<React.SetStateAction<Set<string>>>
  items: FileItem[]
  isLoading: boolean
  fsError: string | null
  searchOpen: boolean
  searchText: string
  searchMatches: string[]
  currentMatchIndex: number
  hasParentDir: boolean
  gridContainerRef: React.RefObject<HTMLDivElement>
  viewMode: 'grid' | 'list'
  setViewMode: React.Dispatch<React.SetStateAction<'grid' | 'list'>>
  handleNavigate: (targetPath: string) => Promise<void>
  handleGoUp: () => Promise<void>
  isFileSupported: (fileName: string) => boolean
  loadDirectory: (dirPath: string) => void
  executeSearch: (text: string) => void
  handleCloseSearch: () => void
  handleSearchPrev: () => void
  handleSearchNext: () => void
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export function useFileNavigation({
  rootPath,
  initialCurrentPath,
  panelId,
  initialViewMode,
}: UseFileNavigationInput): UseFileNavigationOutput {
  const { updatePanelCurrentPath, setSelectedFilePaths, showToast } = useAppStore()

  /** 当前浏览的目录路径 */
  const [currentPath, setCurrentPath] = useState(initialCurrentPath || rootPath)
  /** 始终持有最新的 currentPath，避免异步回调中读到过期值 */
  const currentPathRef = useRef(currentPath)
  useEffect(() => {
    currentPathRef.current = currentPath
  }, [currentPath])

  /** 同步 currentPath 变化到 store，供新建面板时继承 */
  useEffect(() => {
    updatePanelCurrentPath(panelId, currentPath)
  }, [currentPath, panelId, updatePanelCurrentPath])

  /** 当前选中的文件/文件夹路径集合 */
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  /** 同步选中路径到 store，供右键菜单直接使用 */
  useEffect(() => {
    setSelectedFilePaths(panelId, selectedPaths)
  }, [selectedPaths, setSelectedFilePaths, panelId])

  /** 文件网格容器的 ref，用于判断点击是否在网格区域内 */
  const gridContainerRef = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>

  /** 点击网格区域外时，取消选中（排除右键菜单和重命名弹窗） */
  useEffect(() => {
    const handleDocumentMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      const contextMenu = (target as HTMLElement).closest('.context-menu')
      const renameModal = (target as HTMLElement).closest('.rename-modal')
      if (contextMenu || renameModal) return

      if (
        gridContainerRef.current &&
        !gridContainerRef.current.contains(target)
      ) {
        setSelectedPaths(new Set())
      }
    }
    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown)
  }, [])

  /** 文件列表 */
  const [items, setItems] = useState<FileItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [fsError, setFsError] = useState<string | null>(null)

  /** 读取目录内容 */
  const loadDirectory = useCallback(async (dirPath: string) => {
    setIsLoading(true)
    setFsError(null)
    try {
      const result = await window.electronAPI.fs.readdir(dirPath)
      if (result.error) {
        const errorMsg = result.error.includes('ENOENT') || result.error.includes('no such file')
          ? t('fileNav.pathNotExist').replace('{path}', dirPath)
          : result.error.includes('EACCES') || result.error.includes('permission denied')
            ? t('fileNav.noPermission').replace('{path}', dirPath)
            : result.error.includes('ENOTDIR')
              ? t('fileNav.notADir').replace('{path}', dirPath)
              : t('fileNav.readDirFailed').replace('{error}', result.error)
        setFsError(errorMsg)
        setItems([])
      } else {
        setItems(result.items as FileItem[])
      }
    } catch (error) {
      setFsError(t('fileNav.readDirFailed').replace('{error}', (error as Error).message))
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  /** 当 currentPath 变化时，自动加载目录 */
  useEffect(() => {
    loadDirectory(currentPath)
  }, [currentPath, loadDirectory])

  /** 导航到指定路径 */
  const handleNavigate = useCallback(async (targetPath: string) => {
    const existsResult = await window.electronAPI.fs.exists(targetPath)
    if (!existsResult.exists) {
      showToast(t('fileNav.pathNotExist').replace('{path}', targetPath), 3000)
      return
    }
    setCurrentPath(targetPath)
  }, [showToast])

  /** 返回上级目录 */
  const handleGoUp = useCallback(async () => {
    const parentPath = getParentDir(currentPath)
    if (!parentPath) return
    handleNavigate(parentPath)
  }, [currentPath, handleNavigate])

  /** 判断文件是否支持查看 */
  const isFileSupported = useCallback((fileName: string): boolean => {
    const parts = fileName.split('.')
    if (parts.length <= 1) return false

    const ext = parts.pop()?.toLowerCase() || ''
    const nameWithoutExt = parts.join('.')

    if (SUPPORTED_EXTENSIONS.has(ext)) return true
    if (SUPPORTED_EXTENSIONS.has(fileName.toLowerCase())) return true
    if (SUPPORTED_EXTENSIONS.has(nameWithoutExt.toLowerCase())) return true

    return false
  }, [])

  /** 是否有父目录可返回 */
  const hasParentDir = useMemo(() => {
    const parent = getParentDir(currentPath)
    return parent !== ''
  }, [currentPath])

  /** 视图模式：grid（网格）或 list（列表） */
  const storePanel = useAppStore(state => state.panels.find(p => p.id === panelId))
  const storeViewMode = (storePanel as { viewMode?: 'grid' | 'list' } | undefined)?.viewMode
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(initialViewMode || storeViewMode || 'grid')

  /** viewMode 变化时同步到 store，供快照保存使用 */
  useEffect(() => {
    if (storeViewMode !== viewMode) {
      useAppStore.getState().updatePanelViewMode(panelId, viewMode)
    }
  }, [viewMode, panelId])

  // ===== 搜索逻辑 =====

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchMatches, setSearchMatches] = useState<string[]>([])
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)

  const executeSearch = useCallback((text: string) => {
    setSearchText(text)
    if (!text.trim()) {
      setSearchMatches([])
      setCurrentMatchIndex(0)
      return
    }
    const lower = text.toLowerCase()
    const matched = items
      .filter(item => item.name.toLowerCase().includes(lower))
      .map(item => item.path)
    setSearchMatches(matched)
    setCurrentMatchIndex(matched.length > 0 ? 0 : -1)
  }, [items])

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchText('')
    setSearchMatches([])
    setCurrentMatchIndex(0)
  }, [])

  const handleSearchPrev = useCallback(() => {
    if (searchMatches.length === 0) return
    setCurrentMatchIndex(prev => (prev <= 0 ? searchMatches.length - 1 : prev - 1))
  }, [searchMatches.length])

  const handleSearchNext = useCallback(() => {
    if (searchMatches.length === 0) return
    setCurrentMatchIndex(prev => (prev >= searchMatches.length - 1 ? 0 : prev + 1))
  }, [searchMatches.length])

  /** 目录变化时清空搜索 */
  useEffect(() => {
    if (searchOpen && searchMatches.length > 0) {
      handleCloseSearch()
    }
  }, [currentPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // ===== 目录变化监听 =====
  useEffect(() => {
    console.log('[useFileNavigation] 注册 watchDir:', currentPath)
    window.electronAPI.fs.watchDir(currentPath).catch((err) => {
      console.error('[useFileNavigation] watchDir 失败:', err)
    })
    return () => {
      console.log('[useFileNavigation] 取消 watchDir:', currentPath)
      window.electronAPI.fs.unwatchDir(currentPath).catch(() => {})
    }
  }, [currentPath])

  // 监听目录变化事件，自动刷新（带防抖）
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const unsubscribe = window.electronAPI.fs.onDirChanged(({ dirPath }) => {
      console.log('[useFileNavigation] 收到 dir-changed:', dirPath)
      const current = expandTildeSync(currentPathRef.current)
      console.log('[useFileNavigation] 当前路径(展开):', current, '匹配结果:', dirPath === current)
      if (dirPath === current) {
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current)
        }
        console.log('[useFileNavigation] 300ms 后将刷新目录:', current)
        refreshTimerRef.current = setTimeout(() => {
          loadDirectory(currentPathRef.current)
          refreshTimerRef.current = null
        }, 300)
      }
    })
    return () => {
      unsubscribe()
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [loadDirectory])

  // 监听文件被删除到废纸篓的事件，自动刷新目录
  useEffect(() => {
    const handleFilesTrashed = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const cp = expandTildeSync(currentPathRef.current)
      if (detail?.paths && detail.paths.some((p: string) => p.startsWith(cp))) {
        loadDirectory(currentPathRef.current)
      }
    }
    window.addEventListener('files-trashed', handleFilesTrashed)
    return () => window.removeEventListener('files-trashed', handleFilesTrashed)
  }, [loadDirectory])

  // 监听文件被重命名的事件，自动刷新目录
  useEffect(() => {
    const handleFileRenamed = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.panelId === panelId && detail?.oldPath) {
        loadDirectory(currentPathRef.current)
      }
    }
    window.addEventListener('file-rename-completed', handleFileRenamed)
    return () => window.removeEventListener('file-rename-completed', handleFileRenamed)
  }, [loadDirectory, panelId])

  return {
    currentPath,
    setCurrentPath,
    currentPathRef,
    selectedPaths,
    setSelectedPaths,
    items,
    isLoading,
    fsError,
    searchOpen,
    searchText,
    searchMatches,
    currentMatchIndex,
    hasParentDir,
    gridContainerRef,
    viewMode,
    setViewMode,
    handleNavigate,
    handleGoUp,
    isFileSupported,
    loadDirectory,
    executeSearch,
    handleCloseSearch,
    handleSearchPrev,
    handleSearchNext,
    setSearchOpen,
  }
}
