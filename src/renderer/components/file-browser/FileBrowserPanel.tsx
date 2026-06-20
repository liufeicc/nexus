/**
 * 文件浏览器面板组件
 *
 * 提供文件浏览和轻量文件查看能力：
 * - 面包屑导航：显示从根目录到当前目录的路径，可点击跳转
 * - 大图标网格视图：90x90px 卡片展示文件/文件夹
 * - 文件查看器：双击文件进入全屏查看模式
 * - 文件状态栏：底部 28px，显示已打开文件标签，支持快速切换
 *
 * 业务逻辑已拆分为多个自定义 Hook：
 * - useFileNavigation: 目录导航、搜索、文件加载
 * - useFileViewer: 文件查看器状态与操作
 * - useFileOperations: 文件复制/粘贴/删除
 * - useKeyboardShortcuts: 键盘快捷键
 * - useNexusConnection: Nexus 连接管理
 */

import React, { useState, useEffect, useMemo } from 'react'
import { useAppStore, type OpenFileEntry } from '../../store'
import type { FileBrowserPanel as FileBrowserPanelType } from '../../store/types'
import { BasePanel } from '../common/BasePanel'
import { FileBreadcrumb } from './FileBreadcrumb'
import { FileGrid, type FileItem } from './FileGrid'
import { FileSearchBar } from './FileSearchBar'
import { FileStatusBar } from './FileStatusBar'
import { FileViewer } from './FileViewer'
import { useFileOperations } from './useFileOperations'
import { useFileNavigation } from './useFileNavigation'
import { useFileViewer } from './useFileViewer'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { useNexusConnection } from './useNexusConnection'
import { getCmSelectedText, getCapturedSelectedText } from './FileViewer'
import { fetchHomeDir, getFileType } from './file-viewer-constants'
import { useI18n } from '../../i18n'

/** 根据文件名获取文件类型 */
function getFileTypeFromName(fileName: string): 'text' | 'image' | 'pdf' | 'docx' | 'xlsx' | 'ppt' {
  return getFileType(fileName)
}

interface FileBrowserPanelProps {
  /** 面板唯一 ID */
  panelId: string
  /** 文件面板的根目录路径 */
  rootPath: string
  /** 当前浏览的目录路径（不传则默认为 rootPath） */
  currentPath?: string
}

/**
 * 文件浏览器面板组件
 */
export function FileBrowserPanel({ panelId, rootPath, currentPath: initialCurrentPath }: FileBrowserPanelProps) {
  const { closePanel, panels, showContextMenu, fileClipboard } = useAppStore()
  const { t } = useI18n()

  // ===== Nexus 连接 =====
  const { isConnected, handleToggleNexus } = useNexusConnection({ panelId })

  // ===== 目录导航与搜索 =====
  const nav = useFileNavigation({ rootPath, initialCurrentPath, panelId })

  // ===== 文件查看器 =====
  const viewer = useFileViewer({
    panelId,
    isFileSupported: nav.isFileSupported,
    currentPathRef: nav.currentPathRef,
  })

  // ===== 文件操作（复制/粘贴/删除） =====
  const { handleFileCopy, handleFilePaste, handleDeleteFiles } = useFileOperations({
    panelId,
    currentPath: nav.currentPath,
    currentPathRef: nav.currentPathRef,
    selectedPaths: nav.selectedPaths,
    items: nav.items,
    loadDirectory: nav.loadDirectory,
  })

  // ===== 键盘快捷键 =====
  useKeyboardShortcuts({
    panelId,
    activeFile: viewer.activeFile,
    currentPath: nav.currentPath,
    selectedPaths: nav.selectedPaths,
    searchOpen: nav.searchOpen,
    setSearchOpen: nav.setSearchOpen,
    handleFileCopy,
    handleFilePaste,
    handleDeleteFiles,
    handleBackToGrid: viewer.handleBackToGrid,
  })

  // ===== 粘贴状态 =====
  const [isPasting, setIsPasting] = useState(false)

  useEffect(() => {
    const handlePasteStart = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.panelId === panelId) setIsPasting(true)
    }
    const handlePasteEnd = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.panelId === panelId) setIsPasting(false)
    }
    window.addEventListener('file-paste-start', handlePasteStart)
    window.addEventListener('file-paste-end', handlePasteEnd)
    return () => {
      window.removeEventListener('file-paste-start', handlePasteStart)
      window.removeEventListener('file-paste-end', handlePasteEnd)
    }
  }, [panelId])

  // ===== 挂载时获取主目录 =====
  useEffect(() => {
    fetchHomeDir()
  }, [])

  // ===== Store 状态读取 =====
  const panelState = panels.find(p => p.id === panelId) as FileBrowserPanelType | undefined
  const openFiles: OpenFileEntry[] = panelState?.openFiles || []
  const agentActiveFiles: string[] = panelState?.agentActiveFiles || []
  const agentRunning: boolean = panelState?.agentRunning ?? false

  // 监听 store 中本面板的 currentPath 变化（如 replacePanelInPlace 替换路径）
  const storeCurrentPath = panelState?.currentPath
  useEffect(() => {
    if (storeCurrentPath && storeCurrentPath !== nav.currentPath) {
      nav.setCurrentPath(storeCurrentPath)
    }
  }, [storeCurrentPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // 剪切模式下的文件路径集合
  const cutFilePaths = useMemo(() => {
    if (fileClipboard?.mode === 'cut') {
      return new Set(fileClipboard.paths)
    }
    return new Set<string>()
  }, [fileClipboard])

  // ===== 渲染 =====

  const isViewingFile = viewer.activeFile !== null

  const nexusButtonIcon = (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a6 6 0 0 1-12 0V8z" />
    </svg>
  )

  return (
    <BasePanel
      panelId={panelId}
      displayTitle={nav.currentPath}
      headerLeft={
        <span style={{ fontSize: '13px', fontWeight: 500 }}>
          {rootPath}
        </span>
      }
      onContextMenu={(e) => {
        const target = e.target as HTMLElement
        const fileEl = target.closest('[data-file-path]')
        const rightClickedFilePath = fileEl ? (fileEl as HTMLElement).dataset.filePath : undefined

        if (rightClickedFilePath) {
          const currentSelection = useAppStore.getState().selectedFilePaths.get(panelId) ?? new Set<string>()
          if (!currentSelection.has(rightClickedFilePath)) {
            useAppStore.getState().setSelectedFilePaths(panelId, new Set([rightClickedFilePath]))
          }
        } else if (viewer.activeFile) {
          const currentSelection = useAppStore.getState().selectedFilePaths.get(panelId) ?? new Set<string>()
          if (currentSelection.size === 0) {
            useAppStore.getState().setSelectedFilePaths(panelId, new Set([viewer.activeFile]))
          }
        }

        // 右键时立即捕获 CodeMirror 编辑器中的选中文本
        // 使用 mousedown 时捕获的值（contextmenu 时 CodeMirror 已清空选中）
        const selectedText = viewer.activeFile ? getCapturedSelectedText(panelId) : ''

        useAppStore.getState().showContextMenu(
          e.clientX, e.clientY, undefined, panelId, false, rightClickedFilePath, selectedText
        )
      }}
      headerRightBefore={
        <>
          {isPasting && (
            <div className="panel-pasting-indicator">
              <span>{t('filePanel.pasting')}</span>
              <div className="panel-pasting-spinner">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          )}
          <button
            className={`terminal-nexus-btn ${isConnected ? 'nexus-connected' : ''}`}
            onClick={handleToggleNexus}
            title={isConnected ? t('filePanel.disconnectNexus') : t('filePanel.connectNexus')}
          >
            {nexusButtonIcon}
          </button>
          {!isViewingFile && (
            <>
              {/* 视图切换按钮 */}
              <button
                className="file-view-toggle-btn"
                onClick={() => nav.setViewMode(nav.viewMode === 'grid' ? 'list' : 'grid')}
                title={nav.viewMode === 'grid' ? t('filePanel.toggleListView') : t('filePanel.toggleGridView')}
              >
                {nav.viewMode === 'grid' ? (
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }}>
                    <path d="M3 4h18v2H3V4zm0 7h18v2H3v-2zm0 7h18v2H3v-2z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }}>
                    <path d="M3 3h8v8H3V3zm0 10h8v8H3v-8zM13 3h8v8h-8V3zm0 10h8v8h-8v-8z" />
                  </svg>
                )}
              </button>
              <button
                className={`file-search-toggle-btn ${nav.searchOpen ? 'active' : ''}`}
                onClick={() => nav.setSearchOpen(true)}
                title={`${t('filePanel.searchFile')} (Ctrl+F)`}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }}>
                  <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </svg>
              </button>
            </>
          )}
        </>
      }
      onClose={() => closePanel(panelId)}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* 文件查看器视图 - 每个文件独立实例，用 CSS 切换显示 */}
        <div style={{ display: isViewingFile ? 'flex' : 'none', flex: 1, flexDirection: 'column', minHeight: 0, position: 'relative' }}>
          {openFiles.map((file) => {
            const isActive = file.path === viewer.activeFile
            const fileContent = viewer.fileContentsMap.get(file.path) || ''
            const fileBase64 = viewer.fileBase64Map.get(file.path)?.base64 || ''
            const fileMimeType = viewer.fileBase64Map.get(file.path)?.mimeType || ''
            const fileDirty = viewer.viewerFilePath === file.path ? viewer.isDirty : false
            const fileType = getFileTypeFromName(file.name)
            return (
              <div key={file.path} style={{ display: isActive ? 'flex' : 'none', flex: 1, flexDirection: 'column', minHeight: 0, position: isActive ? 'relative' : 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                <FileViewer
                  editorId={panelId}
                  filePath={file.path}
                  fileName={file.name}
                  content={fileContent}
                  fileType={fileType}
                  base64={fileBase64}
                  mimeType={fileMimeType}
                  onBack={viewer.handleExitViewer}
                  initialPage={isActive && fileType === 'pdf' ? viewer.currentPdfPage : undefined}
                  onPdfPageChange={(page) => {
                    if (isActive) viewer.pdfPageRef.current = page
                  }}
                  isDirty={fileDirty}
                  onChange={viewer.handleContentChange}
                  onSave={viewer.handleSaveFile}
                  xlsxActiveSheet={viewer.currentXlsxSheet}
                  onXlsxSheetChange={viewer.setCurrentXlsxSheet}
                />
              </div>
            )
          })}
          <FileStatusBar
            openFiles={openFiles}
            activeFile={viewer.activeFile}
            onSwitch={viewer.handleSwitchFile}
            onCloseFile={viewer.handleCloseFile}
            onNavigateToGrid={viewer.handleBackToGrid}
            agentActiveFiles={agentActiveFiles}
            agentRunning={agentRunning}
          />
        </div>
        {/* 网格浏览视图 */}
        <div style={{ display: isViewingFile ? 'none' : 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
          <FileBreadcrumb
            currentPath={nav.currentPath}
            rootPath={rootPath}
            onNavigate={nav.handleNavigate}
          />
          {nav.searchOpen && (
            <FileSearchBar
              onClose={nav.handleCloseSearch}
              onChange={nav.executeSearch}
              onSearch={nav.executeSearch}
              onPrev={nav.handleSearchPrev}
              onNext={nav.handleSearchNext}
              currentMatch={nav.searchMatches.length > 0 ? nav.currentMatchIndex + 1 : 0}
              totalMatches={nav.searchMatches.length}
            />
          )}
          {nav.isLoading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              {t('common.loading')}
            </div>
          ) : nav.fsError ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e53935', fontSize: '13px', padding: '16px', textAlign: 'center' }}>
              {nav.fsError}
            </div>
          ) : (
            <FileGrid
              items={nav.items}
              viewMode={nav.viewMode}
              onNavigate={nav.handleNavigate}
              onOpenFile={viewer.handleOpenFile}
              selectedPaths={nav.selectedPaths}
              onSelectChange={nav.setSelectedPaths}
              containerRef={nav.gridContainerRef}
              onContextMenu={(e, filePath) => {
                if (filePath) {
                  const currentSelection = useAppStore.getState().selectedFilePaths.get(panelId) ?? new Set<string>()
                  if (!currentSelection.has(filePath)) {
                    useAppStore.getState().setSelectedFilePaths(panelId, new Set([filePath]))
                  }
                }
                showContextMenu(e.clientX, e.clientY, undefined, panelId, false, filePath)
              }}
              onGoUp={nav.hasParentDir ? nav.handleGoUp : null}
              cutFilePaths={cutFilePaths}
              searchMatches={nav.searchMatches}
              currentMatchIndex={nav.currentMatchIndex}
              agentActiveFiles={agentActiveFiles}
            />
          )}
          <FileStatusBar
            openFiles={openFiles}
            activeFile={viewer.activeFile}
            onSwitch={viewer.handleSwitchFile}
            onCloseFile={viewer.handleCloseFile}
            onNavigateToGrid={viewer.handleBackToGrid}
            agentActiveFiles={agentActiveFiles}
            agentRunning={agentRunning}
          />
        </div>
      </div>
    </BasePanel>
  )
}

export default FileBrowserPanel
