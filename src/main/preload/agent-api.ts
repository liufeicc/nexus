/**
 * 智能体管理 API
 * 提供 AI 对话、流式输出、工具调用、计划模式、审批/澄清交互等功能
 */

import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'

export const agent = {
  // --- AI 对话 ---

  /**
   * 发送消息给 AIAgent（异步，结果通过事件返回）
   */
  sendMessage: (content: string, attachments?: import('../../core/types/agent').AttachedFile[], sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.AGENT_SEND_MESSAGE, content, attachments, sessionId),

  /**
   * 中断 AIAgent 当前运行
   */
  interrupt: (sessionId?: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_INTERRUPT, sessionId),

  /**
   * 查询 AIAgent 状态
   */
  getStatus: (sessionId?: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_STATUS, sessionId),

  /**
   * 设置计划模式开关（true = 只读探索 + 生成计划，false = 正常模式）
   */
  setPlanMode: (enabled: boolean, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.AGENT_SET_PLAN_MODE, enabled, sessionId),

  /**
   * 查询当前计划模式状态
   */
  getPlanMode: (sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_PLAN_MODE, sessionId),

  // --- 事件监听器（返回 cleanup 函数）---

  /**
   * 监听流式文本增量
   */
  onStreaming: (callback: (data: { text: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { text: string }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.AGENT_STREAMING, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_STREAMING, listener)
  },

  /**
   * 监听思考/推理增量
   */
  onThinking: (callback: (data: { text: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { text: string }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.AGENT_THINKING, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_THINKING, listener)
  },

  /**
   * 监听工具调用
   */
  onToolCall: (callback: (data: {
    toolCallId: string
    toolName: string
    toolArgs?: Record<string, unknown>
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: {
      toolCallId: string
      toolName: string
      toolArgs?: Record<string, unknown>
    }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.AGENT_TOOL_CALL, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_TOOL_CALL, listener)
  },

  /**
   * 监听工具结果
   */
  onToolResult: (callback: (data: {
    toolCallId: string
    toolName: string
    success: boolean
    output: string
    data?: Record<string, unknown>
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: {
      toolCallId: string
      toolName: string
      success: boolean
      output: string
      data?: Record<string, unknown>
    }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.AGENT_TOOL_RESULT, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_TOOL_RESULT, listener)
  },

  /**
   * 监听新一轮 LLM 调用开始（清空流式文字）
   */
  onNewIteration: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on(IPC_CHANNELS.AGENT_NEW_ITERATION, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_NEW_ITERATION, listener)
  },

  /** 监听 LLM 开始输出工具调用参数（显示"准备工具调用..."过渡提示） */
  onToolCallingStarted: (callback: (data: {
    toolCallId: string
    toolName: string
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: {
      toolCallId: string
      toolName: string
    }) => {
      callback(data)
    }
    ipcRenderer.on(IPC_CHANNELS.AGENT_TOOL_CALLING_STARTED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_TOOL_CALLING_STARTED, listener)
  },

  /**
   * 监听状态变化
   */
  onStateChange: (callback: (data: {
    state: string
    apiCall?: number
    budgetRemaining?: number
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: {
      state: string
      apiCall?: number
      budgetRemaining?: number
    }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.AGENT_STATE_CHANGE, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_STATE_CHANGE, listener)
  },

  /**
   * 监听后台智能体活动（如对话历史压缩）
   */
  onBackgroundActivity: (callback: (data: {
    type: string       // 'compression' | 'indexing' 等
    status: string     // 'started' | 'progress' | 'completed' | 'error'
    message: string    // 描述信息，如 "正压缩对话历史..."
    progress?: number  // 进度 0-100（可选）
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: {
      type: string
      status: string
      message: string
      progress?: number
    }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.AGENT_BACKGROUND_ACTIVITY, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_BACKGROUND_ACTIVITY, listener)
  },

  /**
   * 监听计划更新 (todo 任务列表变更)
   */
  onPlanUpdate: (callback: (data: {
    todos: Array<{ id: string; content: string; status: string }>
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: {
      todos: Array<{ id: string; content: string; status: string }>
    }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.AGENT_PLAN_UPDATE, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_PLAN_UPDATE, listener)
  },

  /**
   * 监听 AI 自动切换计划模式事件
   */
  onPlanModeChanged: (callback: (data: { planMode: boolean }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { planMode: boolean }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.AGENT_PLAN_MODE_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_PLAN_MODE_CHANGED, listener)
  },

  // --- 交互式交互 ---

  /**
   * 监听危险命令审批请求
   */
  onApprovalRequest: (callback: (data: {
    command: string
    description: string
    sessionKey: string
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: {
      command: string
      description: string
      sessionKey: string
    }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.AGENT_REQUEST_APPROVAL, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_REQUEST_APPROVAL, listener)
  },

  /**
   * 发送审批结果回主进程
   */
  sendApprovalResult: (data: { action: string }) => {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_APPROVAL_RESULT, data)
  },

  /**
   * 监听 clarify 提问请求
   */
  onClarifyRequest: (callback: (data: {
    question: string
    choices: string[] | null
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: {
      question: string
      choices: string[] | null
    }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.AGENT_CLARIFY, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_CLARIFY, listener)
  },

  /**
   * 发送 clarify 回答回主进程
   */
  sendClarifyResult: (data: { response: string }) => {
    return ipcRenderer.invoke(IPC_CHANNELS.AGENT_CLARIFY_RESULT, data)
  },

  /**
   * 清除指定会话的对话历史
   */
  clearHistory: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_CLEAR_HISTORY, sessionId),

  /**
   * 手动触发指定会话的对话历史压缩
   */
  compressHistory: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_COMPRESS_HISTORY, sessionId),

  /**
   * 获取初始上下文使用率（组件挂载时主动请求）
   */
  getContextUsage: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_CONTEXT_USAGE),

  /**
   * 加载指定会话的对话历史（用于 UI 恢复）
   */
  loadHistory: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_LOAD_HISTORY, sessionId),
}
