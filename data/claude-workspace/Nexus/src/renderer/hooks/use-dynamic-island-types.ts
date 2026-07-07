/**
 * 灵动岛相关类型定义
 * 供 DynamicIsland 组件及其 hooks 共享
 */

export type AgentState = 'idle' | 'running' | 'stopping' | 'stopped' | 'error' | 'completed'

/**
 * 单个任务计划项（对应 TodoStore.TodoItem）
 */
export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

export interface ToolCallInfo {
  toolCallId: string
  toolName: string
  toolArgs?: Record<string, unknown>
  /** 事件序号，用于按时间顺序混合渲染 */
  order: number
}

export interface ToolResultInfo {
  toolCallId: string
  toolName: string
  success: boolean
  output: string
  order: number
  /** 工具附加数据（如 write_plan 的计划文档内容） */
  data?: Record<string, unknown>
}

/**
 * write_plan 生成的计划文档
 * 独立于 toolResults，跨迭代保留，终端状态清空
 */
export interface PlanDocument {
  toolCallId: string
  filename: string
  content: string
  filePath: string
}

/**
 * 用户发送的消息记录
 */
export interface SentMessage {
  text: string
  timestamp: number
}

/**
 * 一轮完整的对话（用户问题 + LLM 回答）
 */
export interface ConversationTurn {
  question: string      // 用户问题
  answer: string        // LLM 最终回答
  timestamp: number     // 完成时间
}

/**
 * 智能体 UI 状态
 */
export interface AgentUIState {
  agentState: AgentState
  streamingText: string
  thinkingText: string
  /** 当前迭代已调用的工具 ID 列表 */
  toolCallIds: Set<string>
  toolCalls: ToolCallInfo[]
  toolResults: ToolResultInfo[]
  /** 全局事件序号，用于给工具 call/result 分配顺序 */
  eventOrder: number
  inputText: string
  sessionId: string | null
  sentMessages: SentMessage[]
  /** LLM 正在处理响应，等待中显示过渡提示 */
  isAnalyzing: boolean
  /** LLM 正在输出工具调用参数，显示"准备工具调用..."过渡提示 */
  isPreparingToolCall: boolean
  /** LLM 任务计划列表 */
  planItems: TodoItem[]
  /** write_plan 生成的计划文档（跨迭代保留，终端状态清空） */
  planDocuments: PlanDocument[]
  /** 已归档的历史对话列表 */
  conversationHistory: ConversationTurn[]
  /** 计时器：用户发送消息时记录开始时间 */
  timerStart: number | null
  /** 计时器：模型回答完成时记录结束时间 */
  timerEnd: number | null
}

/**
 * 灵动岛面板状态
 */
export type IslandState = 'idle' | 'showing' | 'hiding'
