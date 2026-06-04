/**
 * XLSX 文件预览组件
 *
 * 使用 SheetJS (xlsx) 解析 .xlsx/.xls 文件，渲染为 HTML 表格。
 * 支持多 Sheet 切换。纯前端实现，无需外部依赖。
 *
 * 未来扩展：当检测到 LibreOffice 可用时，切换为高级模式
 * （soffice --headless 转换 + 编辑回写），支持单元格编辑。
 */

import React, { useEffect, useState, useCallback } from 'react'
import { useI18n } from '../../i18n'
import * as XLSX from 'xlsx'

interface SheetInfo {
  name: string
  data: unknown[][]
  /** 该 Sheet 是否有数据 */
  hasData: boolean
}

interface XlsxViewerProps {
  /** Base64 编码的文件内容 */
  base64: string
  /** 当前活动的 Sheet 索引 */
  activeSheet: number
  /** Sheet 切换回调 */
  onActiveSheetChange: (index: number) => void
  /** 所有 Sheet 信息（由组件内部解析并向上通知） */
  onSheetsLoaded?: (sheets: SheetInfo[]) => void
}

/**
 * 将 base64 转换为 ArrayBuffer
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
 * 格式化单元格值（处理数字、日期、布尔等）
 */
function formatCellValue(cell: unknown): string {
  if (cell == null) return ''
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE'
  if (typeof cell === 'number') {
    // 处理日期序列号（Excel 日期从 1900-01-01 开始计数）
    if (cell > 40000 && cell < 60000) {
      // 可能是日期序列号，尝试转换为日期
      const date = new Date((cell - 25569) * 86400 * 1000)
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('zh-CN')
      }
    }
    return String(cell)
  }
  return String(cell)
}

/**
 * XLSX 文件预览组件
 */
export function XlsxViewer({
  base64,
  activeSheet,
  onActiveSheetChange,
  onSheetsLoaded,
}: XlsxViewerProps) {
  const { t } = useI18n()
  const [sheets, setSheets] = useState<SheetInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!base64) return

    setLoading(true)
    setError(null)

    try {
      const arrayBuffer = base64ToArrayBuffer(base64)
      const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })

      const parsedSheets: SheetInfo[] = workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name]
        // 使用 sheet_to_json 获取原始数组数据
        const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
        return {
          name,
          data: jsonData,
          hasData: jsonData.length > 0,
        }
      })

      setSheets(parsedSheets)
      onSheetsLoaded?.(parsedSheets)
    } catch (err) {
      console.error('[XlsxViewer] 解析失败:', err)
      setError(`${t('fileViewer.xlsxParseError')}: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [base64, onSheetsLoaded])

  const handleSheetClick = useCallback((index: number) => {
    onActiveSheetChange(index)
  }, [onActiveSheetChange])

  const currentSheet = sheets[activeSheet]

  return (
    <div className="xlsx-viewer-container">
      {loading && (
        <div className="xlsx-loading">加载中...</div>
      )}
      {error && (
        <div className="xlsx-error">{error}</div>
      )}
      {currentSheet && (
        <>
          <div className="xlsx-table-container">
            <table className="xlsx-table">
              <thead>
                {currentSheet.data.length > 0 && (
                  <tr>
                    {/* 行号列 */}
                    <th className="xlsx-row-num"></th>
                    {currentSheet.data[0].map((_cell, colIndex) => (
                      <th key={colIndex}>
                        {String.fromCharCode(65 + colIndex)}
                      </th>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {currentSheet.data.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td className="xlsx-row-num">{rowIndex + 1}</td>
                    {row.map((cell, colIndex) => (
                      <td key={colIndex} className="xlsx-cell">
                        {formatCellValue(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Sheet 标签栏 */}
          {sheets.length > 1 && (
            <div className="xlsx-sheet-tabs">
              {sheets.map((sheet, index) => (
                <div
                  key={index}
                  className={`xlsx-sheet-tab ${index === activeSheet ? 'active' : ''}`}
                  onClick={() => handleSheetClick(index)}
                  title={sheet.name}
                >
                  {sheet.name}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {!loading && !error && !currentSheet && (
        <div className="xlsx-empty">此工作簿为空</div>
      )}
    </div>
  )
}
