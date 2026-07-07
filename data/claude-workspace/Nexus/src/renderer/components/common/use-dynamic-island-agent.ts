/**
 * 灵动岛智能体操作 Hook
 * 从 DynamicIsland.tsx 提取
 * 职责：发送消息、停止、执行任务、清除/压缩历史、输入框自适应
 */

import { useState, useCallback } from 'react'
import { useAppStore } from '../../store'
import { buildAttachmentPrefix } from '../agent/file-attachment-utils'
import type { AgentUIState, SentMessage } from '../../hooks/use-dynamic-island-types'

export interface UseDynamicIslandAgentInput {
  agentUI: AgentUIState
  setAgentUI: React.Dispatch<React.SetStateAction<AgentUIState>>
  bgActivityActive: boolean
}

export interface UseDynamicIslandAgentOutput {
  clearConfirm: boolean
  compressConfirm: boolean
  handleAgentSend: () => Promise<void>
  handleAgentSendWhileRunning: () => Promise<void>
  handleAgentStop: () => void
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  handleInputKeyDown: (e: React.KeyboardEvent) => void
  executeTask: (taskContent: string) => Promise<void>
  handleClearHistory: () => void
  handleDoClearHistory: () => Promise<void>
  handleCompressHistory: () => void
  handleDoCompressHistory: () => Promise<void>
  handleCancelClear: () => void
  adjustTextareaHeight: () => void
}

/**
 * 获取当前有效的会话 ID
 * 优先从 store 中实时读取，如果为空则从后端查询
 */
export async function getEffectiveSessionId(): Promise<string> {
  const sid = useAppStore.getState().activeSessionId
  if (sid) return sid
  // store 中尚未设置，从后端查询当前活动会话
  try {
    const active = await window.electronAPI?.session?.getActive?.()
    if (active?.id) {
      // 同步到 store，避免后续重复查询
      useAppStore.getState().setActiveSessionId(active.id)
      return active.id
    }
  } catch {
    // 查询失败，使用默认值
  }
  return '__default__'
}

export function useDynamicIslandAgent({
  agentUI,
  setAgentUI,
  bgActivityActive,
}: UseDynamicIslandAgentInput): UseDynamicIslandAgentOutput {
  const { attachedFiles, clearAttachedFiles } = useAppStore()
  const removeAttachedFile = useAppStore(s => s.removeAttachedFile)

  const [clearConfirm, setClearConfirm] = useState(false)
  const [compressConfirm, setCompressConfirm] = useState(false)

  /** 调整输入框高度以适配内容 */
  const adjustTextareaHeight = useCallback(() => {
    const el = document.querySelector('textarea.island-agent-input') as HTMLTextAreaElement | null
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [])

  /** 执行任务：直接将任务内容作为用户消息发送给智能体 */
  const executeTask = useCallback(async (taskContent: string) => {
    if (!window.electronAPI?.agent?.sendMessage) return

    const sentMsg: SentMessage = { text: taskContent, timestamp: Date.now() }
    setAgentUI((prev: AgentUIState) => ({
      ...prev,
      inputText: '',
      sentMessages: [sentMsg],
      streamingText: '',
      thinkingText: '',
      toolCallIds: new Set(),
      toolCalls: [],
      toolResults: [],
      eventOrder: 0,
      planDocuments: [],
      timerStart: Date.now(),
      timerEnd: null,
    }))

    const sessionId = await getEffectiveSessionId()
    window.electronAPI.agent.sendMessage(taskContent, [], sessionId)
  }, [setAgentUI])

  /** 发送消息 */
  const handleAgentSend = useCallback(async () => {
    const text = agentUI.inputText.trim()
    if (!text && attachedFiles.length === 0) return
    if (!window.electronAPI?.agent?.sendMessage) return

    // 构建附件消息前缀
    let fullText = text
    if (attachedFiles.length > 0) {
      const attachmentInfos = attachedFiles.map(f => ({
        name: f.name,
        type: f.type,
        path: f.path,
        content: f.content,
      }))
      const prefix = buildAttachmentPrefix(attachmentInfos)
      fullText = prefix + (text ? `\n\n${text}` : '')
    }

    // 发送新消息时，只保留最近一次发送的内容
    const sentMsg: SentMessage = { text: fullText, timestamp: Date.now() }
    setAgentUI((prev: AgentUIState) => ({
      ...prev,
      inputText: '',
      sentMessages: [sentMsg],
      streamingText: '',
      thinkingText: '',
      toolCallIds: new Set(),
      toolCalls: [],
      toolResults: [],
      eventOrder: 0,
      planDocuments: [],
      timerStart: Date.now(),
      timerEnd: null,
    }))

    // 提取图片附件用于多模态消息发送
    const imageAttachments = attachedFiles
      .filter(f => f.type === 'image' && f.base64)
      .map(f => ({
        id: f.id,
        name: f.name,
        path: f.path,
        type: f.type as 'image',
        size: f.size,
        base64: f.base64!,
        mimeType: f.mimeType || 'image/png',
      }))

    clearAttachedFiles()

    // 重置输入框高度为一行
    const inputEl = document.querySelector('textarea.island-agent-input') as HTMLTextAreaElement | null
    if (inputEl) {
      inputEl.style.height = 'auto'
    }

    const sessionId = await getEffectiveSessionId()
    window.electronAPI.agent.sendMessage(fullText, imageAttachments.length > 0 ? imageAttachments : undefined, sessionId)

    // 保存输入到历史记录（仅保存纯文本，不包含附件前缀）
    if (text) {
      window.electronAPI?.inputHistory?.add(text)
    }
  }, [agentUI.inputText, attachedFiles, clearAttachedFiles, setAgentUI])

  /** 停止智能体 */
  const handleAgentStop = useCallback(async () => {
    if (window.electronAPI?.agent?.interrupt) {
      const sessionId = await getEffectiveSessionId()
      window.electronAPI.agent.interrupt(sessionId)
    }
  }, [])

  /** 运行中发送消息：先中断当前回答，再发送新消息 */
  const handleAgentSendWhileRunning = useCallback(async () => {
    const text = agentUI.inputText.trim()
    if (!text && attachedFiles.length === 0) return
    if (!window.electronAPI?.agent?.sendMessage) return

    // 构建附件消息前缀
    let fullText = text
    if (attachedFiles.length > 0) {
      const attachmentInfos = attachedFiles.map(f => ({
        name: f.name,
        type: f.type,
        path: f.path,
        content: f.content,
      }))
      const prefix = buildAttachmentPrefix(attachmentInfos)
      fullText = prefix + (text ? `\n\n${text}` : '')
    }

    // 提取图片附件
    const imageAttachments = attachedFiles
      .filter(f => f.type === 'image' && f.base64)
      .map(f => ({
        id: f.id,
        name: f.name,
        path: f.path,
        type: f.type as 'image',
        size: f.size,
        base64: f.base64!,
        mimeType: f.mimeType || 'image/png',
      }))

    // 优化 UI：清空输入、重置流式文字，保持 running 状态避免按钮闪烁
    const sentMsg: SentMessage = { text: fullText, timestamp: Date.now() }
    setAgentUI((prev: AgentUIState) => ({
      ...prev,
      agentState: 'running',
      inputText: '',
      sentMessages: [...prev.sentMessages, sentMsg],
      streamingText: '',
      thinkingText: '',
      toolCallIds: new Set(),
      toolCalls: [],
      toolResults: [],
      eventOrder: 0,
      planDocuments: [],
      timerStart: Date.now(),
      timerEnd: null,
    }))
    clearAttachedFiles()

    // 重置输入框高度
    const inputEl = document.querySelector('textarea.island-agent-input') as HTMLTextAreaElement | null
    if (inputEl) {
      inputEl.style.height = 'auto'
    }

    const sessionId = await getEffectiveSessionId()

    // 步骤 1: 等待 agent 状态沉降（事件驱动，超时 5 秒兜底）
    // 先查询当前状态，如果已经在运行才需要等待中断完成
    const currentStatus = await window.electronAPI.agent.getStatus(sessionId)
    if (currentStatus?.state === 'running' || currentStatus?.state === 'stopping') {
      await new Promise<void>(resolve => {
        // 先注册监听，再中断，避免错过状态变更事件
        const cleanup = window.electronAPI.agent.onStateChange((data) => {
          if (data.state !== 'running' && data.state !== 'stopping') {
            cleanup()
            clearTimeout(timer)
            resolve()
          }
        })
        const timer = setTimeout(() => {
          cleanup()
          resolve()
        }, 5000)
        window.electronAPI.agent.interrupt(sessionId)
      })
    }

    // 步骤 2: 发送新消息
    window.electronAPI.agent.sendMessage(fullText, imageAttachments.length > 0 ? imageAttachments : undefined, sessionId)

    // 保存输入到历史记录
    if (text) {
      window.electronAPI?.inputHistory?.add(text)
    }
  }, [agentUI.inputText, attachedFiles, clearAttachedFiles, setAgentUI])

  /** 输入变化 */
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setAgentUI((prev: AgentUIState) => ({ ...prev, inputText: e.target.value }))
    adjustTextareaHeight()
  }, [adjustTextareaHeight, setAgentUI])

  /** 输入键盘事件 */
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      const running = agentUI.agentState === 'running' || agentUI.agentState === 'stopping'
      if (running) {
        handleAgentSendWhileRunning()
      } else {
        handleAgentSend()
      }
    }
    // 单独 Enter 不阻止默认行为 → 自然换行
  }, [handleAgentSend, handleAgentSendWhileRunning, agentUI.agentState])

  /** 清除历史对话 */
  const handleClearHistory = useCallback(() => {
    const isRunning = agentUI.agentState === 'running' || agentUI.agentState === 'stopping'
    if (bgActivityActive || isRunning) return
    setClearConfirm(true)
    setCompressConfirm(false)
  }, [bgActivityActive, agentUI.agentState])

  /** 执行清除历史对话 */
  const handleDoClearHistory = useCallback(async () => {
    const agent = window.electronAPI?.agent
    if (!agent?.clearHistory) return
    const sid = await getEffectiveSessionId()
    const result = await agent.clearHistory(sid)
    if (result.success) {
      // 重置 UI 状态
      setAgentUI((prev: AgentUIState) => ({
        ...prev,
        sentMessages: [],
        streamingText: '',
        thinkingText: '',
        toolCallIds: new Set(),
        toolCalls: [],
        toolResults: [],
        conversationHistory: [],
        planDocuments: [],
        timerStart: null,
        timerEnd: null,
      }))
    }
    setClearConfirm(false)
  }, [setAgentUI])

  /** 取消清除 */
  const handleCancelClear = useCallback(() => {
    setClearConfirm(false)
    setCompressConfirm(false)
  }, [])

  /** 压缩历史对话 */
  const handleCompressHistory = useCallback(() => {
    const isRunning = agentUI.agentState === 'running' || agentUI.agentState === 'stopping'
    if (bgActivityActive || isRunning) return
    setCompressConfirm(true)
    setClearConfirm(false)
  }, [bgActivityActive, agentUI.agentState])

  /** 执行压缩历史对话 */
  const handleDoCompressHistory = useCallback(async () => {
    const agent = window.electronAPI?.agent
    if (!agent?.compressHistory) return
    const sid = await getEffectiveSessionId()
    await agent.compressHistory(sid)
    setCompressConfirm(false)
  }, [])

  return {
    clearConfirm,
    compressConfirm,
    handleAgentSend,
    handleAgentSendWhileRunning,
    handleAgentStop,
    handleInputChange,
    handleInputKeyDown,
    executeTask,
    handleClearHistory,
    handleDoClearHistory,
    handleCompressHistory,
    handleDoCompressHistory,
    handleCancelClear,
    adjustTextareaHeight,
  }
}
