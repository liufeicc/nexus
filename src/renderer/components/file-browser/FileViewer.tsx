/**
 * 文件查看器组件
 *
 * 支持文件类型：
 * - text：使用 CodeMirror 编辑器编辑文本内容，支持搜索高亮
 * - image：使用 <img> 标签渲染 base64 编码的图片
 * - pdf：使用 pdf.js 渲染 PDF 到 canvas
 * - docx：使用 docx-preview 渲染 Word 文档为 HTML
 * - xlsx：使用 SheetJS 解析 Excel 表格，支持多 Sheet 切换
 * - ppt：PPT/PPTX 文件，通过 LibreOffice 转换为 PDF 后渲染
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useI18n } from '../../i18n'
import { CodeMirrorEditor, getCmSelectedText, getCapturedSelectedText } from './CodeMirrorEditor'
import { DocxViewer } from './DocxViewer'
import { XlsxViewer } from './XlsxViewer'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { FileSearchBar } from './FileSearchBar'
import { usePdfViewer } from './usePdfViewer'
import { usePptConverter } from './usePptConverter'

interface FileViewerProps {
  /** 编辑器实例标识（用于隔离多实例的选中文本状态） */
  editorId: string
  /** 当前查看的文件路径 */
  filePath: string
  /** 当前查看的文件名 */
  fileName: string
  /** 文件文本内容（仅 text 类型） */
  content: string
  /** 文件类型 */
  fileType: 'text' | 'image' | 'pdf' | 'docx' | 'xlsx' | 'ppt'
  /** Base64 编码的文件内容（用于 image、pdf 和 Office 类型） */
  base64: string
  /** MIME 类型 */
  mimeType: string
  /** 关闭查看器，回到文件网格 */
  onBack: () => void
  /** 初始页码 */
  initialPage?: number
  /** 页码变化时的回调 */
  onPdfPageChange?: (page: number) => void
  /** 是否有未保存的编辑（仅 text 类型使用） */
  isDirty?: boolean
  /** 内容编辑变化时的回调（仅 text 类型使用） */
  onChange?: (content: string) => void
  /** 保存文件回调（仅 text 类型使用） */
  onSave?: () => void
  /** XLSX 当前 Sheet 索引 */
  xlsxActiveSheet?: number
  /** XLSX Sheet 切换回调 */
  onXlsxSheetChange?: (index: number) => void
}

// 保持模块级 getter 函数供 ContextMenu 使用
export { getCmSelectedText, getCapturedSelectedText }

/** 获取文件图标颜色 */
function getFileIconColor(fileType: string): string {
  switch (fileType) {
    case 'image': return '#22c55e'
    case 'pdf': return '#ef4444'
    case 'docx': return '#2563eb'
    case 'xlsx': return '#16a34a'
    case 'ppt': return '#ea580c'
    default: return 'var(--accent-color)'
  }
}

/** 获取文件图标路径 */
function getFileIconPath(fileType: string) {
  switch (fileType) {
    case 'image':
      return <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
    default:
      return <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z" />
  }
}

/**
 * 文件查看器组件
 */
export function FileViewer({
  editorId,
  filePath,
  fileName,
  content,
  fileType,
  base64,
  mimeType,
  onBack,
  initialPage,
  onPdfPageChange,
  isDirty,
  onChange,
  onSave,
  xlsxActiveSheet = 0,
  onXlsxSheetChange,
}: FileViewerProps) {
  const { t } = useI18n()
  const contentRef = useRef<HTMLDivElement>(null)

  // ===== 搜索功能 =====
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [currentMatch, setCurrentMatch] = useState(0)
  const [totalMatches, setTotalMatches] = useState(0)
  const cmNavRef = useRef<{ findNext: () => void; findPrev: () => void } | null>(null)

  const handleSearchResults = useCallback((current: number, total: number) => {
    setCurrentMatch(current)
    setTotalMatches(total)
  }, [])

  const handleSearchInputChange = (text: string) => setSearchText(text)
  const handleSearchExecute = (text: string) => setSearchText(text)

  const handlePrev = () => {
    if (totalMatches === 0) return
    const prev = currentMatch <= 1 ? totalMatches : currentMatch - 1
    setCurrentMatch(prev)
    cmNavRef.current?.findPrev()
  }

  const handleNext = () => {
    if (totalMatches === 0) return
    const next = currentMatch >= totalMatches ? 1 : currentMatch + 1
    setCurrentMatch(next)
    cmNavRef.current?.findNext()
  }

  const handleCloseSearch = () => {
    setSearchOpen(false)
    setSearchText('')
    setTotalMatches(0)
    setCurrentMatch(0)
  }

  // ===== PPT 转换 =====
  const { pptLibreOfficeInstalled, pptConverting, pptConvertError, pptPdfBase64 } = usePptConverter({
    fileType,
    filePath,
  })

  // ===== PDF 查看 =====
  const isPdf = fileType === 'pdf' || (fileType === 'ppt' && pptPdfBase64)
  const currentPdfBase64 = fileType === 'pdf' ? base64 : (pptPdfBase64 || '')
  const pdf = usePdfViewer({
    base64: currentPdfBase64,
    filePath,
    initialPage,
    onPdfPageChange,
  })

  // ===== Ctrl+S 保存 + Ctrl+F 搜索快捷键 =====
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        e.stopPropagation()
        onSave?.()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        e.stopPropagation()
        if (['text', 'docx', 'xlsx', 'ppt'].includes(fileType)) {
          setSearchOpen(true)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onSave, fileType])

  return (
    <div className="file-viewer">
      {/* 顶部文件名标签 */}
      <div className="file-viewer-header">
        <svg
          style={{ width: '12px', height: '12px', color: getFileIconColor(fileType), flexShrink: 0 }}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          {getFileIconPath(fileType)}
        </svg>
        <span className="file-name" title={filePath}>
          {isDirty && fileType === 'text' && <span style={{ color: '#f59e0b', marginRight: '2px' }}>*</span>}
          {fileName}
        </span>

        {/* PDF 翻页控制 */}
        {isPdf && pdf.pdfTotalPages > 0 && (
          <div className="pdf-page-controls" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '8px' }}>
            <button
              className="btn btn-small btn-ghost"
              onClick={() => pdf.goToPage(pdf.displayPage - 1)}
              disabled={pdf.displayPage <= 1}
              title={t('fileViewer.prevPage')}
            >
              ‹
            </button>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', minWidth: '48px', textAlign: 'center' }}>
              {pdf.displayPage} / {pdf.pdfTotalPages}
            </span>
            <button
              className="btn btn-small btn-ghost"
              onClick={() => pdf.goToPage(pdf.displayPage + 1)}
              disabled={pdf.displayPage >= pdf.pdfTotalPages}
              title={t('fileViewer.nextPage')}
            >
              ›
            </button>
          </div>
        )}

        {/* 搜索按钮 */}
        {['text', 'docx', 'xlsx', 'ppt'].includes(fileType) && (
          <button
            className={`file-search-toggle-btn ${searchOpen ? 'active' : ''}`}
            onClick={() => searchOpen ? handleCloseSearch() : setSearchOpen(true)}
            title={`${t('common.search')} (Ctrl+F)`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '12px', height: '12px' }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        )}

        {/* 关闭按钮 */}
        <button className="file-viewer-close-btn" onClick={onBack} title={t('common.close')}>
          <svg style={{ width: '12px', height: '12px' }} viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>

      {/* 搜索栏 */}
      {searchOpen && (
        <FileSearchBar
          onClose={handleCloseSearch}
          onChange={handleSearchInputChange}
          onSearch={handleSearchExecute}
          onPrev={handlePrev}
          onNext={handleNext}
          currentMatch={currentMatch}
          totalMatches={totalMatches}
        />
      )}

      {/* 内容区 */}
      <div className="file-viewer-content" ref={contentRef}>
        {fileType === 'text' && (
          <CodeMirrorEditor
            editorId={editorId}
            content={content}
            onChange={onChange}
            onSave={onSave}
            searchOpen={searchOpen}
            searchText={searchText}
            onSearchResults={handleSearchResults}
            onNavRef={(nav) => { cmNavRef.current = nav }}
            onSearchOpenChange={setSearchOpen}
          />
        )}

        {fileType === 'image' && base64 && (
          <div className="file-viewer-image-container">
            <img src={`data:${mimeType};base64,${base64}`} alt={fileName} title={fileName} />
          </div>
        )}

        {isPdf && (
          <div className="file-viewer-pdf-scroll-container" ref={pdf.pdfScrollContainerRef}>
            <div className="file-viewer-pdf-container" ref={pdf.pdfPagesContainerRef}>
              {/* 所有页面 canvas 由 JS 动态创建 */}
            </div>
          </div>
        )}

        {fileType === 'docx' && base64 && (
          <ErrorBoundary errorTitle={t('fileViewer.docxErrorTitle')}>
            <DocxViewer base64={base64} />
          </ErrorBoundary>
        )}

        {fileType === 'xlsx' && base64 && (
          <ErrorBoundary errorTitle={t('fileViewer.xlsxErrorTitle')}>
            <XlsxViewer
              base64={base64}
              activeSheet={xlsxActiveSheet}
              onActiveSheetChange={onXlsxSheetChange!}
            />
          </ErrorBoundary>
        )}

        {/* PPT 状态显示 */}
        {fileType === 'ppt' && pptLibreOfficeInstalled === false && (
          <div className="ppt-require-libreoffice">
            <svg style={{ width: '48px', height: '48px', color: '#ea580c', marginBottom: '16px' }} viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15h14v3H5z" />
            </svg>
            <h3 style={{ marginBottom: '8px', color: 'var(--text-primary)' }}>{t('fileViewer.pptNeedLibreOffice')}</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', maxWidth: '400px', textAlign: 'center' }}>
              {t('fileViewer.pptNeedLibreOfficeDesc')}<br />
              {t('fileViewer.pptRestartRequired')}
            </p>
            <a
              href="https://www.libreoffice.org/download/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-block', padding: '8px 16px', backgroundColor: '#ea580c', color: 'white', borderRadius: '4px', textDecoration: 'none', fontSize: '14px', fontWeight: 500 }}
            >
              {t('fileViewer.downloadFromWebsite')}
            </a>
          </div>
        )}

        {fileType === 'ppt' && pptLibreOfficeInstalled === true && pptConverting && (
          <div className="ppt-converting" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ color: 'var(--text-secondary)' }}>{t('fileViewer.pptOpening')}</div>
          </div>
        )}

        {fileType === 'ppt' && pptConvertError && (
          <div className="ppt-error">
            <div style={{ color: '#ef4444' }}>{t('fileViewer.pptConvertError')}: {pptConvertError}</div>
          </div>
        )}
      </div>
    </div>
  )
}
