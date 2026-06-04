/**
 * 文件附件管理 hook
 *
 * 负责所有文件附件相关操作：
 * - 文件选择对话框
 * - 粘贴图片
 * - 拖拽文件 / 拖拽图片 / 拖拽路径
 * - 输入框路径自动检测
 * - 通用附件处理流程
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '../store'
import { detectFilePath } from '../components/agent/file-attachment-utils'
import type { AttachedFile } from '@core/types/agent'
import type { AgentUIState } from './use-dynamic-island-types'

/** 返回给组件的接口 */
export interface FileAttachmentHandlers {
  /** 打开文件选择对话框 */
  handleFilePicker: () => Promise<void>
  /** 处理粘贴事件 */
  handlePaste: (e: React.ClipboardEvent) => Promise<void>
  /** 处理拖拽本地文件 */
  handleDrop: (e: React.DragEvent) => Promise<void>
  /** 处理拖拽浏览器图片 */
  handleDropImage: (e: React.DragEvent) => Promise<void>
  /** 处理拖拽文件路径 */
  handleDropPath: (e: React.DragEvent, filePath: string) => Promise<void>
  /** 拖拽进入中 */
  isDragOver: boolean
  /** onDragOver handler */
  handleDragOver: (e: React.DragEvent) => void
  /** onDragLeave handler */
  handleDragLeave: (e: React.DragEvent) => void
  /** 是否跳过下一次路径检测（粘贴图片后需跳过） */
  skipNextPathDetectionRef: React.MutableRefObject<boolean>
}

/**
 * 生成附件唯一 ID
 */
function generateFileId(): string {
  return `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 通用附件处理函数
 */
async function processFileAttachment(
  name: string,
  localPath: string,
  fileType: string,
  fileSize: number,
  fileMimeType: string | undefined,
  addFile: (file: AttachedFile) => void,
): Promise<void> {
  const id = generateFileId()

  // 保存到临时目录
  const saveResult = await window.electronAPI.fileAttachment.attachFile(localPath)
  if (saveResult.error || !saveResult.savedPath) return

  const file: AttachedFile = {
    id,
    name,
    path: saveResult.savedPath,
    type: fileType as 'image' | 'text' | 'other',
    size: fileSize,
    mimeType: fileMimeType,
  }

  // 文本文件读取内容
  if (fileType === 'text') {
    const readResult = await window.electronAPI.fileAttachment.readAsText(localPath)
    if (!readResult.error) {
      file.content = readResult.content
    }
  }

  // 图片读取 base64
  if (fileType === 'image') {
    const base64Result = await window.electronAPI.fileAttachment.readAsBase64(localPath)
    if (!base64Result.error) {
      file.base64 = base64Result.base64
    }
  }

  addFile(file)
}

export function useFileAttachments(
  inputText: string,
  setAgentUI: React.Dispatch<React.SetStateAction<AgentUIState>>,
  _enableVision: boolean = true,
): FileAttachmentHandlers {
  const [isDragOver, setIsDragOver] = useState(false)
  const addAttachedFile = useAppStore(s => s.addAttachedFile)

  // 附件操作锁，防止重复打开文件选择框
  const isFilePickerOpenRef = useRef(false)
  // 防止粘贴图片后立即触发路径检测的竞态
  const skipNextPathDetectionRef = useRef(false)

  /**
   * 处理文件选择（通过对话框）
   */
  const handleFilePicker = useCallback(async () => {
    if (isFilePickerOpenRef.current) return
    isFilePickerOpenRef.current = true

    try {
      const result = await window.electronAPI.fileAttachment.openFileDialog()
      if (!result.files || result.error) return

      for (const fileInfo of result.files) {
        // 只处理图片文件
        if (fileInfo.type !== 'image') continue

        await processFileAttachment(
          fileInfo.name,
          fileInfo.path,
          fileInfo.type,
          fileInfo.size,
          fileInfo.mimeType,
          addAttachedFile,
        )
      }
    } finally {
      isFilePickerOpenRef.current = false
    }
  }, [addAttachedFile])

  /**
   * 处理粘贴事件 — 在粘贴前判断剪贴板内容
   */
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    // 先检测是否有图片
    let hasImage = false
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        hasImage = true
        break
      }
    }

    // 如果有图片，阻止默认粘贴行为，将图片作为附件
    if (hasImage) {
      e.preventDefault()
      e.stopPropagation()

      // 标记跳过下一次路径检测，防止粘贴后的文本触发路径识别
      skipNextPathDetectionRef.current = true

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (!item.type.startsWith('image/')) continue

        const blob = item.getAsFile()
        if (!blob) continue

        // 将 blob 转为 base64
        const reader = new FileReader()
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1]
          const id = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          const fileName = `pasted_image_${Date.now()}.png`

          const attachedFile: AttachedFile = {
            id,
            name: fileName,
            path: fileName,
            type: 'image',
            size: blob.size,
            mimeType: item.type || 'image/png',
            base64,
          }
          addAttachedFile(attachedFile)
        }
        reader.readAsDataURL(blob)
      }
      return
    }

    // 没有图片时，允许默认粘贴行为
  }, [addAttachedFile])

  /**
   * 处理拖拽本地文件
   */
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    for (const file of files) {
      const localPath = file.path
      if (!localPath) continue

      // 只处理图片文件
      if (!file.type.startsWith('image/')) continue

      const typeResult = await window.electronAPI.fileAttachment.detectType(localPath)
      if (!typeResult.exists || typeResult.type !== 'image') continue

      await processFileAttachment(
        file.name,
        localPath,
        typeResult.type,
        file.size,
        file.type || undefined,
        addAttachedFile,
      )
    }
  }, [addAttachedFile])

  /**
   * 处理拖拽图片（从网页/BrowserView 等无 path 的来源）
   */
  const handleDropImage = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const items = Array.from(e.dataTransfer.items)
    if (items.length === 0) return

    for (const item of items) {
      if (!item.type.startsWith('image/')) continue

      const blob = item.getAsFile()
      if (!blob) continue

      const reader = new FileReader()
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1]
        const id = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const fileName = `dropped_image_${Date.now()}.png`

        const attachedFile: AttachedFile = {
          id,
          name: fileName,
          path: fileName,
          type: 'image',
          size: blob.size,
          mimeType: item.type || 'image/png',
          base64,
        }
        addAttachedFile(attachedFile)
      }
      reader.readAsDataURL(blob)
    }
  }, [addAttachedFile])

  /**
   * 处理从文件面板等来源拖来的文件路径
   */
  const handleDropPath = useCallback(async (e: React.DragEvent, filePath: string) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (!filePath) return

    const existsResult = await window.electronAPI.path.exists(filePath)
    if (!existsResult.exists) return

    const fullPath = existsResult.path
    const typeResult = await window.electronAPI.fileAttachment.detectType(fullPath)
    // 只接受图片文件
    if (!typeResult.exists || typeResult.type !== 'image' || !typeResult.isFile) return

    await processFileAttachment(
      fullPath.split('/').pop()!,
      fullPath,
      typeResult.type,
      typeResult.size || 0,
      undefined,
      addAttachedFile,
    )
  }, [addAttachedFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  // 监听输入框变化，自动检测文件路径
  useEffect(() => {
    if (!inputText) return
    if (!inputText.startsWith('/') && !inputText.startsWith('~') && !inputText.startsWith('./') && !inputText.startsWith('../')) return

    // 如果刚处理过粘贴，跳过本次路径检测
    if (skipNextPathDetectionRef.current) {
      skipNextPathDetectionRef.current = false
      return
    }

    // 延迟检测，避免用户正在输入时频繁触发
    const timer = setTimeout(() => {
      handlePathDetection(inputText, addAttachedFile, setAgentUI)
    }, 500)
    return () => clearTimeout(timer)
  }, [inputText, addAttachedFile, setAgentUI])

  return {
    handleFilePicker,
    handlePaste,
    handleDrop,
    handleDropImage,
    handleDropPath,
    isDragOver,
    handleDragOver,
    handleDragLeave,
    skipNextPathDetectionRef,
  }
}

/**
 * 检测输入框中的文件路径
 * 提取为独立函数供 useEffect 调用
 */
async function handlePathDetection(
  input: string,
  addAttachedFile: (file: AttachedFile) => void,
  setAgentUI: React.Dispatch<React.SetStateAction<AgentUIState>>,
): Promise<void> {
  const result = detectFilePath(input)
  if (!result) return

  const existsResult = await window.electronAPI.path.exists(result.path)
  if (!existsResult.exists) return

  const fullPath = existsResult.path
  const typeResult = await window.electronAPI.fileAttachment.detectType(fullPath)
  // 只接受图片文件
  if (!typeResult.isFile || typeResult.type !== 'image') return

  await processFileAttachment(
    fullPath.split('/').pop()!,
    fullPath,
    typeResult.type,
    typeResult.size || 0,
    undefined,
    addAttachedFile,
  )

  // 从输入框中移除路径部分
  setAgentUI(prev => ({
    ...prev,
    inputText: result.remainder || '',
  }))
}
