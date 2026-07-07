/**
 * DOCX 文件预览组件
 *
 * 使用 docx-preview 库将 .docx 文件渲染为 HTML。
 * 纯前端实现，无需外部依赖。
 *
 * 未来扩展：当检测到 LibreOffice 可用时，切换为高级模式
 * （soffice --headless --convert-to html），支持编辑和回写。
 */

import React, { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import { t } from '../../i18n'

interface DocxViewerProps {
  /** Base64 编码的文件内容 */
  base64: string
  /** 是否处于编辑模式（预留，LibreOffice 模式使用） */
  editable?: boolean
  /** 内容变化回调（预留，编辑模式使用） */
  onChange?: (content: string) => void
}

/**
 * 将 base64 转换为 ArrayBuffer（复用 PDF 加载的 atob + Uint8Array 模式）
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * DOCX 文件预览组件
 */
export function DocxViewer({ base64, editable = false }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!base64 || !containerRef.current) return

    setLoading(true)
    setError(null)

    const doRender = async () => {
      try {
        const arrayBuffer = base64ToArrayBuffer(base64)
        const container = containerRef.current!

        // 清空容器
        container.innerHTML = ''

        await renderAsync(arrayBuffer, container, undefined, {
          className: 'docx-wrapper',
          inWrapper: false,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: false,
          debug: false,
          experimental: false,
        })
      } catch (err) {
        console.error('[DocxViewer] 渲染失败:', err)
        setError(t('fileViewer.docxRenderError') + `: ${(err as Error).message}`)
      } finally {
        setLoading(false)
      }
    }

    doRender()
  }, [base64])

  return (
    <div className="docx-viewer-container">
      {loading && (
        <div className="docx-loading">加载中...</div>
      )}
      {error && (
        <div className="docx-error">{error}</div>
      )}
      <div ref={containerRef} className="docx-content" />
    </div>
  )
}
