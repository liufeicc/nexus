/**
 * PDF 查看器 Hook
 *
 * 职责：PDF 文档加载、渲染、翻页、滚动跟踪。
 * 从 FileViewer 组件中提取。
 */

import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

export interface UsePdfViewerInput {
  base64: string
  filePath: string
  initialPage?: number
  onPdfPageChange?: (page: number) => void
}

export interface UsePdfViewerOutput {
  pdfDocRef: React.MutableRefObject<pdfjsLib.PDFDocumentProxy | null>
  pdfPageRef: React.MutableRefObject<number>
  pdfReadyRef: React.MutableRefObject<boolean>
  firstLoadDoneRef: React.MutableRefObject<boolean>
  displayPage: number
  pdfTotalPages: number
  pdfPagesContainerRef: React.RefObject<HTMLDivElement>
  renderedPagesRef: React.MutableRefObject<Set<number>>
  pdfScrollContainerRef: React.RefObject<HTMLDivElement>
  goToPage: (newPage: number) => void
}

/** 渲染单个 PDF 页面到 canvas（返回 Promise，支持顺序渲染） */
async function renderPdfPage(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  page: number,
  canvas: HTMLCanvasElement
): Promise<void> {
  try {
    const pdfPage = await pdfDoc.getPage(page)
    const viewport = pdfPage.getViewport({ scale: 1.5 })
    // 获取容器宽度，用于自适应缩放
    const containerWidth = canvas.parentElement?.clientWidth || 800
    const fitScale = containerWidth / viewport.width
    const scaledViewport = pdfPage.getViewport({ scale: 1.5 * fitScale })

    canvas.width = scaledViewport.width
    canvas.height = scaledViewport.height

    const renderContext = {
      canvasContext: canvas.getContext('2d')!,
      viewport: scaledViewport,
    }
    const task = pdfPage.render(renderContext)
    await task.promise
  } catch (err) {
    if ((err as Error).name !== 'RenderingCancelledException') {
      console.error('[usePdfViewer] PDF 页面渲染失败:', err)
    }
  }
}

export function usePdfViewer({ base64, filePath, initialPage, onPdfPageChange }: UsePdfViewerInput): UsePdfViewerOutput {
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const pdfPageRef = useRef(1)
  const pdfReadyRef = useRef(false)
  const firstLoadDoneRef = useRef(false)
  const pdfPagesContainerRef = useRef<HTMLDivElement>(null)
  const renderedPagesRef = useRef<Set<number>>(new Set())
  const pdfScrollContainerRef = useRef<HTMLDivElement>(null)

  // 用 ref 保存回调，避免 useEffect 因回调引用变化而重新执行
  const onPdfPageChangeRef = useRef(onPdfPageChange)
  onPdfPageChangeRef.current = onPdfPageChange

  const [pdfTotalPages, setPdfTotalPages] = useState(0)
  const [displayPage, setDisplayPage] = useState(1)

  // 加载 PDF 文档（仅当 base64/filePath/initialPage 变化时重新加载）
  useEffect(() => {
    if (!base64) return

    // 用 AbortController 风格的标志位，在 effect 清理时阻止后续操作
    let cancelled = false

    firstLoadDoneRef.current = false
    pdfReadyRef.current = false
    pdfDocRef.current = null
    renderedPagesRef.current = new Set()

    const loadPdf = async () => {
      try {
        const binaryString = atob(base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }

        const pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise
        if (cancelled) { pdfDoc.destroy(); return }

        pdfDocRef.current = pdfDoc
        pdfReadyRef.current = true
        setPdfTotalPages(pdfDoc.numPages)

        const restoredPage = (initialPage && initialPage >= 1 && initialPage <= pdfDoc.numPages)
          ? initialPage
          : 1
        pdfPageRef.current = restoredPage
        setDisplayPage(restoredPage)
        onPdfPageChangeRef.current?.(restoredPage)

        // 等待 DOM 就绪后再渲染
        const container = await waitForContainer(pdfPagesContainerRef)
        if (cancelled) return

        container.innerHTML = ''
        renderedPagesRef.current = new Set()

        // 先创建所有页面的 DOM 结构（canvas 占位）
        const canvases: HTMLCanvasElement[] = []
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          const pageWrapper = document.createElement('div')
          pageWrapper.className = 'pdf-page-wrapper'
          pageWrapper.dataset.pageNumber = String(i)

          const canvas = document.createElement('canvas')
          canvas.className = 'file-viewer-pdf-canvas'
          pageWrapper.appendChild(canvas)

          if (i < pdfDoc.numPages) {
            const separator = document.createElement('div')
            separator.className = 'pdf-page-separator'
            pageWrapper.appendChild(separator)
          }

          container.appendChild(pageWrapper)
          renderedPagesRef.current.add(i)
          canvases.push(canvas)
        }

        firstLoadDoneRef.current = true

        // 如果需要恢复到之前的页码位置
        if (restoredPage > 1) {
          const targetPage = container.querySelector(`[data-page-number="${restoredPage}"]`)
          if (targetPage) {
            targetPage.scrollIntoView({ behavior: 'auto', block: 'start' })
          }
        }

        // 逐页顺序渲染，避免并发请求压垮 pdfjs worker
        for (let i = 0; i < canvases.length; i++) {
          if (cancelled) break
          await renderPdfPage(pdfDoc, i + 1, canvases[i])
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[usePdfViewer] PDF 加载失败:', err)
        }
      }
    }

    // 等待容器 DOM 就绪
    const waitForContainer = (ref: React.RefObject<HTMLDivElement>): Promise<HTMLDivElement> => {
      return new Promise((resolve) => {
        const check = () => {
          if (ref.current) {
            resolve(ref.current)
          } else if (!cancelled) {
            requestAnimationFrame(check)
          }
        }
        requestAnimationFrame(check)
      })
    }

    loadPdf()

    return () => {
      cancelled = true
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy()
        pdfDocRef.current = null
      }
      pdfReadyRef.current = false
      firstLoadDoneRef.current = false
      setPdfTotalPages(0)
      renderedPagesRef.current = new Set()
    }
  }, [base64, filePath, initialPage])

  // 翻页处理（按钮点击）
  const goToPage = (newPage: number) => {
    const page = Math.max(1, Math.min(pdfTotalPages, newPage))
    pdfPageRef.current = page
    setDisplayPage(page)
    onPdfPageChangeRef.current?.(page)

    if (pdfPagesContainerRef.current) {
      const targetPage = pdfPagesContainerRef.current.querySelector(`[data-page-number="${page}"]`)
      if (targetPage) {
        targetPage.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }

  // 监听滚动，更新当前页码（使用 ref 避免依赖 displayPage 反复注册监听）
  const displayPageRef = useRef(displayPage)
  displayPageRef.current = displayPage

  useEffect(() => {
    const container = pdfScrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const pageWrappers = container.querySelectorAll('.pdf-page-wrapper')
      if (pageWrappers.length === 0) return

      let currentPage = 1
      let maxVisibleArea = 0

      pageWrappers.forEach((wrapper) => {
        const rect = wrapper.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        const visibleTop = Math.max(rect.top, containerRect.top)
        const visibleBottom = Math.min(rect.bottom, containerRect.bottom)
        const visibleHeight = Math.max(0, visibleBottom - visibleTop)

        if (visibleHeight > maxVisibleArea) {
          maxVisibleArea = visibleHeight
          currentPage = parseInt((wrapper as HTMLElement).dataset.pageNumber || '1', 10)
        }
      })

      if (currentPage !== displayPageRef.current) {
        setDisplayPage(currentPage)
        pdfPageRef.current = currentPage
        onPdfPageChangeRef.current?.(currentPage)
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  return {
    pdfDocRef, pdfPageRef, pdfReadyRef, firstLoadDoneRef,
    displayPage, pdfTotalPages,
    pdfPagesContainerRef, renderedPagesRef, pdfScrollContainerRef,
    goToPage,
  }
}
