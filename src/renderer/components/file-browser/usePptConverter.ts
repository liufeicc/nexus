/**
 * PPT 转换器 Hook
 *
 * 职责：检查 LibreOffice 并将 PPT/PPTX 转换为 PDF，返回转换后的 base64 数据。
 * 从 FileViewer 组件中提取。
 */

import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'

export interface UsePptConverterInput {
  fileType: 'text' | 'image' | 'pdf' | 'docx' | 'xlsx' | 'ppt'
  filePath: string
}

export interface UsePptConverterOutput {
  pptLibreOfficeInstalled: boolean | null
  pptConverting: boolean
  pptConvertError: string | null
  pptPdfBase64: string | null
}

export function usePptConverter({ fileType, filePath }: UsePptConverterInput): UsePptConverterOutput {
  const { t } = useI18n()

  const [pptLibreOfficeInstalled, setPptLibreOfficeInstalled] = useState<boolean | null>(null)
  const [pptConverting, setPptConverting] = useState(false)
  const [pptConvertError, setPptConvertError] = useState<string | null>(null)
  const [pptPdfBase64, setPptPdfBase64] = useState<string | null>(null)

  useEffect(() => {
    if (fileType !== 'ppt' || !filePath) return

    setPptLibreOfficeInstalled(null)
    setPptConverting(false)
    setPptConvertError(null)
    setPptPdfBase64(null)

    const processPpt = async () => {
      // 1. 检查 LibreOffice
      const checkResult = await window.electronAPI.fs.checkLibreOffice()
      if (!checkResult.success || !checkResult.installed) {
        setPptLibreOfficeInstalled(false)
        return
      }

      setPptLibreOfficeInstalled(true)
      setPptConverting(true)

      try {
        // 2. 转换为 PDF
        const convertResult = await window.electronAPI.fs.convertToPdf(filePath)
        if (!convertResult.success || !convertResult.pdfPath) {
          const errorMap: Record<string, string> = {
            '源文件不存在': t('fileOps.sourceFileNotExist'),
            '转换后未找到 PDF 文件': t('fileOps.convertPdfNotFound'),
          }
          setPptConvertError(errorMap[convertResult.error || ''] || convertResult.error || t('fileViewer.pptConvertError'))
          return
        }

        // 3. 读取生成的 PDF
        const pdfResult = await window.electronAPI.fs.readFileAsBase64(convertResult.pdfPath)
        if (pdfResult.error) {
          setPptConvertError(`${t('fileViewer.pptReadPdfFailed')}: ${pdfResult.error}`)
          return
        }

        setPptPdfBase64(pdfResult.base64)
      } catch (err) {
        setPptConvertError(`${t('fileViewer.convertException')}: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setPptConverting(false)
      }
    }

    processPpt()
  }, [fileType, filePath, t])

  return {
    pptLibreOfficeInstalled,
    pptConverting,
    pptConvertError,
    pptPdfBase64,
  }
}
