/**
 * 灵动岛组件（纯 React 浮层组件）
 *
 * 设计理念：
 * - 现代科幻 HUD 风格
 * - 智能体模式：Agent 交互、流式文字、思考、工具调用展示
 * - 无消息时自动收起，有消息时平滑展开
 * - 作为主窗口内的固定定位浮层，z-index 高于普通内容
 *
 * Hooks 拆分：
 * - useAgentEvents — 智能体事件监听
 * - useFileAttachments — 文件附件管理
 * - useWindowDrag — 窗口拖动和点击切换
 * - useBackgroundAgentActivity — 后台智能体活动监听
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '../../store'
import { AttachedFileBadge } from '../agent/AttachedFileBadge'
import { buildAttachmentPrefix } from '../agent/file-attachment-utils'
import TaskPanel from './TaskPanel'
import { useAgentEvents } from '../../hooks/use-agent-events'
import { useFileAttachments } from '../../hooks/use-file-attachments'
import { useWindowDrag } from '../../hooks/use-window-drag'
import { useBackgroundAgentActivity } from '../../hooks/use-background-agent-activity'
import type { AgentState, AgentUIState, IslandState, SentMessage } from '../../hooks/use-dynamic-island-types'
import '../../styles/dynamic-island.css'
import '../../styles/task-panel.css'

// ==================== 工具函数 ====================

/**
 * 将 agentState 映射为灵动岛 data-type
 */
function agentStateToType(state: AgentState): string {
  switch (state) {
    case 'running': return 'agent'
    case 'stopping': return 'warning'
    case 'error': return 'error'
    case 'completed': return 'success'
    case 'stopped': return 'warning'
    default: return 'info'
  }
}

/**
 * 截断文本，避免在紧凑区域显示过长内容
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '...'
}

/**
 * 将 Unix 时间戳格式化为相对时间描述
 */
function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN')
}

// ==================== 主组件 ====================

export function DynamicIsland({ standalone = false }: { standalone?: boolean }) {
  // ==================== 面板 UI 状态 ====================

  const [islandState, setIslandState] = useState<IslandState>('idle')
  const [taskPanelOpen, setTaskPanelOpen] = useState(false)

  // 输入历史面板状态
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<Array<{ id: number; text: string; createdAt: number }>>([])

  // ==================== 智能体 UI 状态 ====================

  const [agentUI, setAgentUI] = useState<AgentUIState>({
    agentState: 'idle',
    streamingText: '',
    thinkingText: '',
    toolCallIds: new Set(),
    toolCalls: [],
    toolResults: [],
    eventOrder: 0,
    inputText: '',
    sessionId: null,
    sentMessages: [],
    isAnalyzing: false,
    isPreparingToolCall: false,
  })

  // 已发送消息的展开状态
  const [expandedMsgIndex, setExpandedMsgIndex] = useState<number | null>(null)

  // Store 中的附件
  const attachedFiles = useAppStore(s => s.attachedFiles)
  const removeAttachedFile = useAppStore(s => s.removeAttachedFile)
  const clearAttachedFiles = useAppStore(s => s.clearAttachedFiles)

  // 读取模型配置中的 enableVision
  const [enableVision, setEnableVision] = useState(true)

  useEffect(() => {
    window.electronAPI?.config.get('agentConfig').then((config: any) => {
      if (config?.enableVision !== undefined) {
        setEnableVision(config.enableVision)
      }
    })
  }, [])

  // 灵动岛展开时刷新配置（确保设置修改后生效）
  useEffect(() => {
    if (islandState === 'showing') {
      window.electronAPI?.config.get('agentConfig').then((config: any) => {
        if (config?.enableVision !== undefined) {
          setEnableVision(config.enableVision)
        }
      })
    }
  }, [islandState])

  // 监听配置变更事件（设置中点击「应用」后实时刷新 enableVision）
  useEffect(() => {
    return window.electronAPI?.onConfigChanged?.((data) => {
      if (data.key === 'agentConfig') {
        window.electronAPI?.config.get('agentConfig').then((config: any) => {
          if (config?.enableVision !== undefined) {
            setEnableVision(config.enableVision)
          }
        })
      }
    })
  }, [])

  // 滚动引用 + 输入框引用（自动聚焦 + 自适应高度）
  const contentRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const thinkingRef = useRef<HTMLDivElement | null>(null)

  // ==================== Hooks ====================

  // 智能体事件监听
  useAgentEvents(setAgentUI, contentRef, thinkingRef)

  // 文件附件管理
  const {
    handleFilePicker,
    handlePaste,
    handleDrop,
    handleDropImage,
    handleDropPath,
    isDragOver,
    handleDragOver,
    handleDragLeave,
  } = useFileAttachments(agentUI.inputText, setAgentUI, enableVision)

  // 窗口拖动 + 点击切换
  const {
    handleStandaloneMouseDown,
    handleMouseDown,
    handleClick,
    position,
    dragInProgressRef,
  } = useWindowDrag(standalone, islandState, setIslandState)

  // 后台智能体活动监听
  const { activity: bgActivity, isActive: bgActivityActive } = useBackgroundAgentActivity()

  // 上下文使用百分比（从 stateChange 事件中获取）
  const [contextUsagePercent, setContextUsagePercent] = useState<number>(0)

  // 监听上下文使用率变化
  useEffect(() => {
    const agent = window.electronAPI?.agent
    if (!agent) return

    // 挂载时主动请求初始值
    agent.getContextUsage?.().then((res) => {
      if (typeof res?.contextUsagePercent === 'number') {
        setContextUsagePercent(Math.min(100, Math.max(0, res.contextUsagePercent)))
      }
    })

    const cleanup = agent.onStateChange((data: {
      state: string
      apiCall?: number
      budgetRemaining?: number
      finalResponse?: string | null
      errorMessage?: string | null
      contextUsagePercent?: number
    }) => {
      if (typeof data.contextUsagePercent === 'number') {
        setContextUsagePercent(Math.min(100, Math.max(0, data.contextUsagePercent)))
      }
    })
    return () => cleanup()
  }, [])

  // 清除历史对话的内联确认状态
  const [clearConfirm, setClearConfirm] = useState(false)
  // 压缩历史对话的内联确认状态
  const [compressConfirm, setCompressConfirm] = useState(false)

  // 清除历史对话
  const handleClearHistory = useCallback(() => {
    if (bgActivityActive) return  // 压缩中不允许操作
    setClearConfirm(true)
    setCompressConfirm(false)
  }, [bgActivityActive])

  // 执行清除历史对话
  const handleDoClearHistory = useCallback(async () => {
    const agent = window.electronAPI?.agent
    if (!agent?.clearHistory) return
    const result = await agent.clearHistory()
    if (result.success) {
      // 重置 UI 状态
      setAgentUI(prev => ({
        ...prev,
        sentMessages: [],
        streamingText: '',
        thinkingText: '',
        toolCallIds: new Set(),
        toolCalls: [],
        toolResults: [],
      }))
      // 重置上下文使用百分比
      setContextUsagePercent(0)
    }
    setClearConfirm(false)
  }, [])

  // 取消清除历史对话
  const handleCancelClear = useCallback(() => {
    setClearConfirm(false)
    setCompressConfirm(false)
  }, [])

  // 压缩历史对话
  const handleCompressHistory = useCallback(() => {
    if (bgActivityActive) return  // 压缩中不允许操作
    setCompressConfirm(true)
    setClearConfirm(false)
  }, [bgActivityActive])

  // 执行压缩历史对话
  const handleDoCompressHistory = useCallback(async () => {
    const agent = window.electronAPI?.agent
    if (!agent?.compressHistory) return
    const result = await agent.compressHistory()
    setCompressConfirm(false)
  }, [])

  // 打开/关闭输入历史面板
  const handleToggleHistory = useCallback(async () => {
    if (showHistoryPanel) {
      setShowHistoryPanel(false)
      return
    }
    const entries = await window.electronAPI?.inputHistory?.list(50)
    setHistoryEntries(entries || [])
    setShowHistoryPanel(true)
  }, [showHistoryPanel])

  // 选择历史记录条目（填充到输入框，不自动发送）
  const handleSelectHistory = useCallback((entry: { id: number; text: string }) => {
    setAgentUI(prev => ({ ...prev, inputText: entry.text }))
    setShowHistoryPanel(false)
    // 聚焦输入框
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  // ==================== 独立窗口模式：窗口大小自适应 ====================

  // 合并所有 resize 逻辑为一个 ResizeObserver
  useEffect(() => {
    if (!standalone) return

    const container = document.querySelector('.island-container')
    if (!container) return

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        const rect = container.getBoundingClientRect()
        const taskPanelHeight = taskPanelOpen ? 500 : 0
        // 输入历史面板是全屏覆盖层，需要窗口足够大才能完整显示
        const historyPanelHeight = showHistoryPanel ? 560 : 0
        const panelExtra = Math.max(taskPanelHeight, historyPanelHeight)
        const width = Math.max(300, Math.ceil(rect.width))
        const height = Math.max(30, Math.ceil(rect.height)) + panelExtra
        window.electronAPI?.dynamicIsland?.setSize({ width, height })
      }, 50)
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      if (resizeTimer) clearTimeout(resizeTimer)
    }
  }, [standalone, taskPanelOpen, showHistoryPanel])

  // 展开/收起时延迟 resize，确保 CSS 过渡动画完成后尺寸稳定
  useEffect(() => {
    if (!standalone) return
    if (islandState === 'showing') {
      const timer = setTimeout(() => {
        const container = document.querySelector('.island-container')
        if (!container) return
        const rect = container.getBoundingClientRect()
        const taskPanelHeight = taskPanelOpen ? 500 : 0
        const historyPanelHeight = showHistoryPanel ? 560 : 0
        const panelExtra = Math.max(taskPanelHeight, historyPanelHeight)
        const width = Math.max(300, Math.ceil(rect.width))
        const height = Math.max(30, Math.ceil(rect.height)) + panelExtra
        window.electronAPI?.dynamicIsland?.setSize({ width, height })
      }, 450) // 略大于 CSS transition 的 0.45s
      return () => clearTimeout(timer)
    } else if (islandState === 'idle') {
      // 收起时立即 resize，但保留面板所需高度
      requestAnimationFrame(() => {
        const container = document.querySelector('.island-container')
        if (!container) return
        const rect = container.getBoundingClientRect()
        const historyPanelHeight = showHistoryPanel ? 560 : 0
        const width = Math.max(300, Math.ceil(rect.width))
        const height = Math.max(30, Math.ceil(rect.height)) + historyPanelHeight
        window.electronAPI?.dynamicIsland?.setSize({ width, height })
      })
    }
  }, [standalone, islandState, taskPanelOpen, showHistoryPanel])

  // ==================== 智能体操作 ====================

  // 执行任务：直接将任务内容作为用户消息发送给智能体
  const executeTask = useCallback(async (taskContent: string) => {
    if (!window.electronAPI?.agent?.sendMessage) return
    // 自动追加检查描述
    const fullText = taskContent + '\n\n完成后要检查任务正确性'

    // 发送新消息
    const sentMsg: SentMessage = { text: fullText, timestamp: Date.now() }
    setAgentUI(prev => ({
      ...prev,
      inputText: '',
      sentMessages: [sentMsg],
      streamingText: '',
      thinkingText: '',
      toolCallIds: new Set(),
      toolCalls: [],
      toolResults: [],
      eventOrder: 0,
    }))

    window.electronAPI.agent.sendMessage(fullText, [])
    setTaskPanelOpen(false)
  }, [])

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
    setAgentUI(prev => ({
      ...prev,
      inputText: '',
      sentMessages: [sentMsg],
      streamingText: '',
      thinkingText: '',
      toolCallIds: new Set(),
      toolCalls: [],
      toolResults: [],
      eventOrder: 0,
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
    setIslandState('showing')

    // 重置输入框高度为一行
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }

    // 不传 sessionId，让后端使用默认会话（__default__）
    window.electronAPI.agent.sendMessage(fullText, imageAttachments.length > 0 ? imageAttachments : undefined)

    // 保存输入到历史记录（仅保存纯文本，不包含附件前缀）
    if (text) {
      window.electronAPI?.inputHistory?.add(text)
    }
  }, [agentUI.inputText, attachedFiles, clearAttachedFiles])

  const handleAgentStop = useCallback(() => {
    if (window.electronAPI?.agent?.interrupt) {
      window.electronAPI.agent.interrupt()
    }
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setAgentUI(prev => ({ ...prev, inputText: e.target.value }))
    // 自适应高度
    const el = e.target
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [])

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleAgentSend()
    }
    // 单独 Enter 不阻止默认行为 → 自然换行
  }, [handleAgentSend])

  // ==================== 全局快捷键 + 自动聚焦 ====================

  // 当灵动岛展开时，自动聚焦输入框
  useEffect(() => {
    if (islandState === 'showing') {
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [islandState])

  // Ctrl+Enter 全局快捷键：idle 时展开并聚焦，showing 时发送
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (islandState === 'idle') {
          setIslandState('showing')
        } else if (islandState === 'showing') {
          handleAgentSend()
        }
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true)
  }, [islandState, handleAgentSend])

  // ==================== 收起逻辑 ====================

  useEffect(() => {
    if (islandState !== 'hiding') return
    const timer = setTimeout(() => {
      setIslandState('idle')
    }, 400)
    return () => clearTimeout(timer)
  }, [islandState])

  // ==================== 渲染 ====================

  const isAgentRunning = agentUI.agentState === 'running' || agentUI.agentState === 'stopping'

  const indicatorLabel = isAgentRunning ? 'AGENT' : 'NEXUS'
  const dataMode = agentStateToType(agentUI.agentState)

  // 独立窗口模式下不需要 CSS 定位（窗口由 Electron 管理位置）
  const containerStyle = standalone
    ? { position: 'fixed' as const, top: 0, left: 0, transform: 'none' as const, width: '100%' }
    : (position
        ? { left: position.left, top: position.top, transform: 'none' as const }
        : undefined)

  const containerClass = `dynamic-island${islandState !== 'idle' ? ' visible' : ''}${standalone ? ' island-standalone' : ''}`

  return (
    <div
      className={containerClass}
      onMouseDown={standalone ? handleStandaloneMouseDown : handleMouseDown}
      style={containerStyle}
    >
      <div
        className={`island-container ${islandState === 'idle' ? 'idle' : ''} ${
          islandState === 'showing' ? 'visible' : ''
        } ${islandState === 'hiding' ? 'collapsing' : ''} ${isDragOver ? 'drag-over' : ''}`}
        data-type={dataMode}
        onClick={handleClick}
        onDrop={(e) => {
          if (!enableVision) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          // 优先级：文件面板路径 > 本地文件 > 浏览器图片
          // 注意：files 和 items 可能不一致（如浏览器拖入图片时 items 有图片但 files 无 path）
          const files = Array.from(e.dataTransfer.files)
          const items = Array.from(e.dataTransfer.items)
          const hasLocalFiles = files.some(f => f.path)
          const hasImages = items.some(item => item.type.startsWith('image/'))
          // 从 FileGrid 等来源拖来的文件路径（text/plain）
          const textPath = e.dataTransfer.getData('text/plain')

          if (textPath && !hasLocalFiles && !hasImages) {
            handleDropPath(e, textPath)
          } else if (hasLocalFiles) {
            handleDrop(e)
          } else if (hasImages) {
            handleDropImage(e)
          } else {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* 左侧彩色竖条 */}
        <div className="island-accent-bar" />

        {/* 收起时的指示器行 */}
        <div className="island-indicator-row">
          <div className="island-pip" />
          <span className="island-label">{indicatorLabel}</span>
          <div className="island-pulse-ring" />
        </div>

        {/* 智能体模式内容 — 展开时显示 */}
        {islandState === 'showing' && (
          <div className="island-content island-agent-content" ref={contentRef} onClick={(e) => e.stopPropagation()}>
            {/* 固定输入栏 — 始终在顶部，不随内容移动 */}
            <div className="island-agent-fixed-bar">
              {/* 拖动手柄 — 放在最顶部 */}
              <div className="island-drag-handle" />

              {/* 输入行 — 输入框 + 发送/停止 + 关闭 */}
              <div className="island-agent-input-row">
                <textarea
                  ref={inputRef}
                  className="island-agent-input"
                  placeholder="让Nexus帮你做点什么吧..."
                  value={agentUI.inputText}
                  onChange={(e) => { e.stopPropagation(); handleInputChange(e) }}
                  onKeyDown={(e) => { e.stopPropagation(); handleInputKeyDown(e) }}
                  onPaste={(e) => { e.stopPropagation(); handlePaste(e) }}
                  onBlur={() => {
                    if (inputRef.current) {
                      inputRef.current.style.height = 'auto'
                    }
                  }}
                  rows={1}
                />
                {isAgentRunning ? (
                  <button
                    className="island-stop-btn-inline"
                    onClick={(e) => { e.stopPropagation(); handleAgentStop() }}
                    title="停止"
                  >
                    ■
                  </button>
                ) : (
                  <button
                    className="island-agent-send-btn"
                    onClick={(e) => { e.stopPropagation(); handleAgentSend() }}
                    disabled={!agentUI.inputText.trim()}
                    title="发送"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </button>
                )}
                {/* 输入历史按钮 */}
                <button
                  className="island-history-btn"
                  onClick={(e) => { e.stopPropagation(); handleToggleHistory() }}
                  title="输入历史"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </button>
                <button
                  className="island-close-btn-inline"
                  onClick={(e) => { e.stopPropagation(); setIslandState('hiding') }}
                  title="关闭"
                >
                  ✕
                </button>
              </div>

              {/* 底部工具栏：任务图标 + 附件按钮 + 附件列表 + 后台AGENT指示器 */}
              <div className="island-agent-bottom-bar">
                {/* 左侧：任务图标 + 附件按钮 + 附件列表 */}
                <div className="island-bottom-actions">
                  {/* 任务图标按钮 — 点击打开任务面板 */}
                  <button
                    className="island-task-btn"
                    onClick={(e) => { e.stopPropagation(); setTaskPanelOpen(true) }}
                    title="任务"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 11l3 3L22 4" />
                      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                    </svg>
                  </button>
                  {enableVision && (
                  <button
                    className="island-file-btn"
                    onClick={(e) => { e.stopPropagation(); handleFilePicker() }}
                    title="附加图片"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </button>
                  )}

                  {/* 已附加文件列表 */}
                  {attachedFiles.length > 0 && (
                    <div className="island-attached-files">
                      {attachedFiles.map(file => (
                        <AttachedFileBadge key={file.id} file={file} onRemove={removeAttachedFile} />
                      ))}
                    </div>
                  )}
                </div>

                {/* 右侧：上下文使用率 + 清除/压缩按钮 */}
                <div className="island-bg-agent-indicator">
                  {/* 上下文使用百分比进度条 */}
                  <div className="island-context-usage-bar">
                    {bgActivityActive ? (
                      <span className="island-context-usage-text">压缩中...</span>
                    ) : (
                      <>
                        <div
                          className="island-context-usage-fill"
                          style={{ width: `${contextUsagePercent}%` }}
                        />
                        <span className="island-context-usage-text">
                          {Math.round(contextUsagePercent)}%
                        </span>
                      </>
                    )}
                  </div>

                  {/* 清除对话历史图标 */}
                  <button
                    className={`island-action-icon-btn${bgActivityActive ? ' disabled' : ''}`}
                    onClick={(e) => { e.stopPropagation(); handleClearHistory() }}
                    title="清除对话历史"
                    disabled={bgActivityActive}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>

                  {/* 总结对话历史图标 */}
                  <button
                    className={`island-action-icon-btn${bgActivityActive ? ' disabled' : ''}`}
                    onClick={(e) => { e.stopPropagation(); handleCompressHistory() }}
                    title="总结对话历史"
                    disabled={bgActivityActive}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                  </button>
                </div>

                {/* 清除确认行 */}
                {clearConfirm && (
                  <div className="island-clear-confirm-row">
                    <span className="island-clear-confirm-text">确定要清除对话历史吗？</span>
                    <button
                      className="island-clear-confirm-btn"
                      onClick={(e) => { e.stopPropagation(); handleDoClearHistory() }}
                      title="确定"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button
                      className="island-clear-cancel-btn"
                      onClick={(e) => { e.stopPropagation(); handleCancelClear() }}
                      title="取消"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                )}

                {/* 压缩确认行 */}
                {compressConfirm && (
                  <div className="island-clear-confirm-row">
                    <span className="island-clear-confirm-text">确定要总结对话历史吗？</span>
                    <button
                      className="island-clear-confirm-btn"
                      onClick={(e) => { e.stopPropagation(); handleDoCompressHistory() }}
                      title="确定"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button
                      className="island-clear-cancel-btn"
                      onClick={(e) => { e.stopPropagation(); handleCancelClear() }}
                      title="取消"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 可滚动内容区域 — 有内容时才渲染 */}
            {(agentUI.sentMessages.length > 0 || agentUI.thinkingText || agentUI.isAnalyzing || agentUI.toolCalls.length > 0 || agentUI.toolResults.length > 0 || agentUI.streamingText || isDragOver) && (
              <div className="island-agent-scrollable">

                {/* 用户已发送的消息 */}
                {agentUI.sentMessages.length > 0 && (
                <div className="island-sent-messages">
                  {agentUI.sentMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`island-sent-msg${expandedMsgIndex === idx ? ' expanded' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setExpandedMsgIndex(prev => prev === idx ? null : idx) }}
                    >
                      <span className="island-sent-msg-label">你：</span>
                      <span className="island-sent-msg-text">{msg.text}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 思考状态 */}
              {agentUI.thinkingText && (
                <div className="island-thinking">
                  <div className="island-thinking-label"> 思考</div>
                  <div className="island-thinking-text" ref={thinkingRef}>{agentUI.thinkingText}</div>
                </div>
              )}

              {/* LLM 正在分析中的过渡提示 */}
              {agentUI.isAnalyzing && (
                <div className="island-analyzing">
                  <div className="island-analyzing-text">✻ 正在分析...</div>
                </div>
              )}

              {/* 工具执行 — 按 event order 时序混合渲染 */}
              {(() => {
                if (agentUI.toolCalls.length === 0 && agentUI.toolResults.length === 0) return null

                const resultMap = new Map<string, import('../../hooks/use-dynamic-island-types').ToolResultInfo>()
                for (const r of agentUI.toolResults) {
                  resultMap.set(r.toolCallId, r)
                }

                interface ToolEvent {
                  type: 'call' | 'result'
                  order: number
                  call?: import('../../hooks/use-dynamic-island-types').ToolCallInfo
                  result?: import('../../hooks/use-dynamic-island-types').ToolResultInfo
                }
                const events: ToolEvent[] = []
                const renderedCalls = new Set<string>()

                for (const call of agentUI.toolCalls) {
                  const result = resultMap.get(call.toolCallId)
                  if (result) {
                    events.push({ type: 'result', order: result.order, result })
                    renderedCalls.add(call.toolCallId)
                  } else {
                    events.push({ type: 'call', order: call.order, call })
                  }
                }

                for (const r of agentUI.toolResults) {
                  if (!renderedCalls.has(r.toolCallId)) {
                    events.push({ type: 'result', order: r.order, result: r })
                  }
                }

                events.sort((a, b) => a.order - b.order)

                return events.map((ev) => {
                  if (ev.type === 'call' && ev.call) {
                    return (
                      <div key={`call-${ev.call.toolCallId}`} className="island-tool-call">
                        <span className="island-tool-icon">🔧</span>
                        <span className="island-tool-name">{ev.call.toolName}</span>
                        {ev.call.toolArgs && Object.keys(ev.call.toolArgs).length > 0 && (
                          <span className="island-tool-args">{truncate(JSON.stringify(ev.call.toolArgs), 60)}</span>
                        )}
                      </div>
                    )
                  } else if (ev.type === 'result' && ev.result) {
                    return (
                      <div key={`result-${ev.result.toolCallId}`} className={`island-tool-result ${ev.result.success ? 'success' : 'error'}`}>
                        <span className="island-tool-icon">{ev.result.success ? '✓' : '✕'}</span>
                        <span className="island-tool-name">{ev.result.toolName}</span>
                        <span className="island-tool-output">{truncate(ev.result.output, 80)}</span>
                      </div>
                    )
                  }
                  return null
                })
              })()}

              {/* 流式文本输出 */}
              {agentUI.streamingText && (
                <div className="island-agent-text">
                  {agentUI.streamingText}
                  {isAgentRunning && <span className="typewriter-cursor" />}
                </div>
              )}

              {/* 准备工具调用的过渡提示（在流式文字之后显示） */}
              {agentUI.isPreparingToolCall && agentUI.toolCalls.length === 0 && (
                <div className="island-analyzing">
                  <div className="island-analyzing-text">✻ 准备工具调用...</div>
                </div>
              )}

              {/* 拖拽提示层（仅视觉开启时显示） */}
              {isDragOver && enableVision && (
                <div className="island-drop-overlay">
                  <div className="island-drop-text">释放图片以附加</div>
                </div>
              )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 输入历史面板（全屏覆盖层模式，与 TaskPanel 一致） */}
      {showHistoryPanel && (
        <div className="island-history-overlay" onClick={() => setShowHistoryPanel(false)}>
          <div className="island-history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="island-history-header">
              <h3>输入历史</h3>
              <button className="island-history-close" onClick={() => setShowHistoryPanel(false)}>✕</button>
            </div>
            <div className="island-history-list">
              {historyEntries.length === 0 ? (
                <div className="island-history-empty">暂无输入历史</div>
              ) : (
                historyEntries.map(entry => (
                  <div
                    key={entry.id}
                    className="island-history-item"
                    onClick={(e) => { e.stopPropagation(); handleSelectHistory(entry) }}
                  >
                    <span className="island-history-item-text">
                      {truncate(entry.text, 80)}
                    </span>
                    <span className="island-history-item-time">
                      {formatRelativeTime(entry.createdAt)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 任务面板 */}
      <TaskPanel
        visible={taskPanelOpen}
        onSelect={(taskContent) => {
          executeTask(taskContent)
        }}
        onClose={() => setTaskPanelOpen(false)}
      />
    </div>
  )
}

export default DynamicIsland
