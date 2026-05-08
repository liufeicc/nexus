/**
 * 智能体核心类型定义
 *
 * 作用：定义整个智能体系统的数据结构，确保所有模块对"一条消息"、
 * "一个工具"、"一次调用结果"有统一的理解。
 * 所有后续模块（LLM 客户端、工具注册、智能体核心等）都依赖这些类型。
 */

// ==================== 上下文压缩器配置 ====================

/**
 * 上下文压缩器配置
 *
 * 控制当对话历史接近模型上下文窗口限制时的压缩行为。
 * 模仿 Hermes 的 ContextCompressor 配置。
 */
export interface ContextCompressorConfig {
  /** 保护头部消息数（system prompt + 首轮对话），默认 3 */
  protectFirstN: number
  /** 保护尾部消息数（最近的对话），默认 6 */
  protectLastN: number
}

// ==================== 智能体配置 ====================

/**
 * 智能体配置
 *
 * 用于初始化智能体实例，包含模型连接信息和运行参数。
 */
export interface AgentConfig {
  /** LLM 提供商类型 */
  provider: 'openai' | 'anthropic'
  /** API 地址（OpenAI 兼容接口或 Anthropic 接口） */
  apiUrl: string
  /** API 密钥 */
  apiKey: string
  /** 模型名称（如 gpt-4, claude-sonnet-4-6 等） */
  model: string
  /** 最大迭代次数，防止智能体无限循环，默认 90 */
  maxIterations?: number
  /** 单次请求超时时间（毫秒），默认 60000 */
  timeout?: number
  /** 重试次数，默认 3 */
  maxRetries?: number
  /** 模型上下文窗口大小（token 数，可选，不传则自动解析） */
  contextLength?: number
  /**
   * 支持的访问方式列表（如 ['stream', 'invoke']）。
   * agent 运行时优先使用 invoke，不支持时降级到 stream。
   */
  accessModes?: string[]
  /**
   * 辅助模型名称（用于上下文压缩等侧边任务）。
   * 不传时复用主模型。
   */
  summaryModel?: string
  /** 是否启用图片识别（视觉），默认 true */
  enableVision?: boolean
}

// ==================== 消息相关类型 ====================

/**
 * 工具调用信息
 *
 * LLM 返回的工具调用指令，包含工具名和 JSON 参数。
 */
export interface ToolCall {
  /** 工具调用 ID（用于匹配调用结果） */
  id: string
  /** 工具名称 */
  name: string
  /** 工具参数（JSON 字符串） */
  arguments: string
}

/**
 * 消息角色
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

/**
 * 文件附件类型
 *
 * 用户发送给智能体的文件附件，支持图片、文本文件和其他文件。
 */
export interface AttachedFile {
  /** 唯一 ID */
  id: string
  /** 文件名 */
  name: string
  /** 本地路径（保存到临时目录后） */
  path: string
  /** 文件类型 */
  type: 'image' | 'text' | 'other'
  /** 文件大小（字节） */
  size: number
  /** 文本文件内容（type='text' 时填充） */
  content?: string
  /** 图片 base64 数据（type='image' 时填充，如果 API 支持多模态） */
  base64?: string
  /** MIME 类型 */
  mimeType?: string
}

/**
 * 多模态内容块
 *
 * 用于用户消息中混合文本、图片等内容类型。
 */
export interface ContentBlock {
  /** 内容块类型 */
  type: 'text' | 'image'
  /** 文本内容（type='text' 时） */
  text?: string
  /** 图片数据（type='image' 时） */
  image?: {
    /** base64 编码的图片数据（不含 data URI 前缀） */
    data: string
    /** MIME 类型，如 image/png, image/jpeg */
    mimeType: string
  }
}

/**
 * 智能体消息
 *
 * 表示对话中的一条消息。可以是用户输入、AI 回复、系统提示或工具结果。
 * 对应 OpenAI Chat Completions API 的 message 格式。
 */
export interface AgentMessage {
  /** 消息角色 */
  role: MessageRole
  /**
   * 消息内容。
   * - string: 纯文本内容
   * - null: 空内容
   * - ContentBlock[]: 多模态内容（文本、图片等混合）
   */
  content: string | ContentBlock[] | null
  /** 工具调用列表（仅 assistant 角色可能有） */
  tool_calls?: ToolCall[]
  /** 工具调用 ID（仅 tool 角色有，关联到具体的 tool_call） */
  tool_call_id?: string
  /** 消息名称（仅 tool 角色有，标识是哪个工具返回的结果） */
  name?: string
  /** 消息时间戳（毫秒） */
  timestamp?: number
  /** 附件列表（仅 user 角色可能有） */
  attachments?: AttachedFile[]
}

// ==================== 工具相关类型 ====================

/**
 * 工具参数属性定义
 *
 * 描述工具单个参数的类型、描述等信息。
 */
export interface ToolParameterProperty {
  /** 参数类型（string, number, boolean, array, object 等） */
  type: string
  /** 参数描述 */
  description: string
  /** 枚举值（可选） */
  enum?: string[]
  /** 子属性（当 type 为 object 时使用） */
  properties?: Record<string, ToolParameterProperty>
  /** 必填的子属性名列表（当 type 为 object 时使用） */
  required?: string[]
  /** 数组元素类型（当 type 为 array 时使用） */
  items?: ToolParameterProperty
}

/**
 * 工具参数 Schema
 *
 * JSON Schema 格式的参数定义，传给 LLM API 用于生成正确的工具调用。
 */
export interface ToolParameters {
  /** Schema 类型，固定为 object */
  type: string
  /** 参数属性定义 */
  properties: Record<string, ToolParameterProperty>
  /** 必填参数列表 */
  required?: string[]
}

/**
 * 工具定义
 *
 * 注册一个工具到智能体中，包含名字、描述、参数 schema 和处理函数。
 * 类似 Hermes 的 ToolEntry，是工具的"元数据 + 行为"的完整描述。
 */
export interface ToolDefinition {
  /** 工具名称（如 "read_file", "terminal"） */
  name: string
  /** 工具描述（会传给 LLM，帮助它理解何时使用该工具） */
  description: string
  /** 工具参数的 JSON Schema */
  parameters: ToolParameters
  /**
   * 可选的工具可用性检查函数。
   * 在每次构建 LLM 工具列表时调用，返回 false 时该工具对 LLM 不可见。
   * 例如：检查 TAVILY_API_KEY 是否配置、MCP Server 是否在线。
   */
  checkFn?: () => boolean | Promise<boolean>
  /**
   * 工具执行函数
   * @param args 解析后的参数对象
   * @param onUpdate 可选的进度回调函数，用于长时间运行的工具（如终端命令）
   * @param signal 可选的中止信号，用于中断长时间运行的工具执行
   * @returns 工具执行结果
   */
  handler: (
    args: Record<string, unknown>,
    onUpdate?: (chunk: string) => void,
    signal?: AbortSignal
  ) => Promise<ToolResult>
}

/**
 * 工具执行结果
 *
 * 工具执行完成后返回的结果。
 */
export interface ToolResult {
  /** 是否成功 */
  success: boolean
  /** 输出内容（成功时为工具输出，失败时为错误信息） */
  output: string
  /** 附加数据（可选，如文件内容解析后的结构化数据） */
  data?: unknown
  /** 图片数据（可选，当工具读取图片文件时返回 base64 编码） */
  imageData?: { base64: string; mimeType: string }
}

// ==================== 智能体状态 ====================

/**
 * 智能体运行状态
 *
 * - idle: 空闲，等待用户输入
 * - running: 运行中，正在执行 LLM 调用或工具调用
 * - stopping: 停止中，用户已触发停止，等待当前步骤完成
 * - stopped: 已停止，响应用户的停止请求
 * - error: 出错，发生了不可恢复的错误
 * - completed: 已完成，智能体返回了最终回复
 */
export type AgentState = 'idle' | 'running' | 'stopping' | 'stopped' | 'error' | 'completed'

// ==================== 迭代预算 ====================

/**
 * 迭代预算
 *
 * 限制智能体单次对话中工具调用循环的次数，防止无限循环消耗过多 API 配额。
 * 默认最大值 90，每次工具调用（含并行调用算一次）递减 1。
 */
export class IterationBudget {
  /** 最大迭代次数 */
  readonly max: number
  /** 已使用次数 */
  private used: number

  constructor(max: number = 90) {
    this.max = max
    this.used = 0
  }

  /** 剩余可用次数 */
  get remaining(): number {
    return this.max - this.used
  }

  /** 已使用次数 */
  get consumed(): number {
    return this.used
  }

  /** 消耗一次预算 */
  consume(count: number = 1): void {
    this.used += count
  }

  /** 是否还有剩余 */
  get hasRemaining(): boolean {
    return this.remaining > 0
  }

  /** 重置预算 */
  reset(): void {
    this.used = 0
  }
}

// ==================== 事件回调类型 ====================

/**
 * 智能体事件类型
 */
export type AgentEventType =
  | 'state_change'     // 状态变化
  | 'message'          // 新消息（LLM 文本输出）
  | 'message_delta'    // 流式消息增量
  | 'tool_start'       // 工具开始执行
  | 'tool_result'      // 工具执行完成
  | 'tool_progress'    // 工具执行进度（如终端输出）
  | 'error'            // 错误发生
  | 'budget_warning'   // 预算不足警告
  | 'thinking'         // 思考/推理增量（Claude extended thinking）
  | 'new_iteration'    // 新一轮 LLM 调用开始（前端据此清空流式文字）
  | 'tool_calling_started'  // LLM 正在输出工具调用参数（前端显示"准备工具调用..."过渡提示）

/**
 * 智能体事件
 *
 * 智能体运行过程中发出的事件，用于通知 UI（灵动岛）显示实时状态。
 */
export interface AgentEvent {
  /** 事件类型 */
  type: AgentEventType
  /** 事件数据 */
  data: Record<string, unknown>
  /** 时间戳（毫秒） */
  timestamp: number
}

/**
 * 智能体事件回调函数类型
 */
export type AgentEventCallback = (event: AgentEvent) => void

// ==================== MCP 配置类型 ====================

/**
 * MCP Server 配置
 *
 * 用于连接外部 MCP（Model Context Protocol）Server，自动发现其工具并注册到 ToolRegistry。
 * 当前仅支持 stdio 传输。
 */
export interface McpServerConfig {
  /** 服务器标识（用于工具名前缀），如 "filesystem" */
  name: string
  /** 传输协议，当前仅支持 "stdio" */
  transport: 'stdio'
  /** 启动 MCP Server 的命令，如 "npx" */
  command: string
  /** 命令参数，如 ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] */
  args: string[]
  /** 额外环境变量（会合并到子进程的环境中） */
  env?: Record<string, string>
  /** 启动超时（毫秒），默认 10000 */
  timeout?: number
}
