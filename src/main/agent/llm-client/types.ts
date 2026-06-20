/**
 * LLM 客户端类型定义
 *
 * 定义 LLM API 通信所需的所有类型：
 * - 错误类型与错误类
 * - 流式回调接口
 * - 响应结构与用量信息
 * - 工具调用信息
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'

// ==================== 错误分类 ====================

/**
 * LLM API 错误类型
 *
 * - rate_limit: 限流，应该等待后重试
 * - auth_error: 认证失败，需要检查 API Key
 * - context_too_long: 上下文超长，需要压缩或截断
 * - server_error: 服务端错误，可以重试
 * - network_error: 网络错误，可以重试
 * - api_error: 其他 API 错误，通常不应该重试
 */
export type LLMErrorType =
  | 'rate_limit'
  | 'auth_error'
  | 'context_too_long'
  | 'server_error'
  | 'network_error'
  | 'api_error'

/**
 * LLM API 错误
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public type: LLMErrorType,
    public statusCode?: number,
    public originalError?: Error,
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

// ==================== 响应类型 ====================

/**
 * 流式响应的事件回调
 */
export interface StreamCallbacks {
  onChunk: (text: string) => void
  onDone: () => void
  onError: (error: Error) => void
  onThinking?: (text: string) => void
  /** LLM 开始输出工具调用时触发（id 和 name 已知，参数尚未收完） */
  onToolCallStart?: (toolCallId: string, toolName: string) => void
}

/**
 * LLM API 调用用量信息
 *
 * 来自 API 响应的 usage 字段，提供精确的 token 计数。
 */
export interface LLMUsage {
  /** 输入 token 数（prompt） */
  promptTokens: number
  /** 输出 token 数（completion） */
  completionTokens: number
  /** 总计 token 数 */
  totalTokens: number
}

/**
 * LLM 响应结果
 */
export interface LLMResponse {
  /** AI 返回的文本内容 */
  content: string
  /** 工具调用列表（如果有） */
  toolCalls: ToolCallInfo[]
  /** Thinking 内容（Claude 的"思考"过程，仅 Anthropic） */
  thinking: string | null
  /** 是否已停止（完整返回而非截断） */
  stopped: boolean
  /** API 用量信息（真实 token 计数，来自 response.usage） */
  usage?: LLMUsage
}

/**
 * 工具调用信息
 */
export interface ToolCallInfo {
  id: string
  name: string
  arguments: string
}

// ==================== 错误分类函数 ====================

/**
 * 分类错误类型
 *
 * 根据 HTTP 状态码和错误消息判断失败原因：
 * - 401/403 → 认证错误
 * - 429 → 限流
 * - 400 + 上下文超长关键词 → 上下文超长
 * - 5xx → 服务端错误
 * - 网络失败 → 网络错误
 *
 * @param error 原始错误
 * @param isUserAbort 是否为用户主动中断（true=用户中断，false=超时或其他原因中断）
 */
export function classifyError(
  error: unknown,
  isUserAbort: boolean,
): LLMError {
  if (error instanceof LLMError) return error

  // OpenAI SDK 错误
  if (error instanceof OpenAI.APIError) {
    const status = error.status
    if (status === 401 || status === 403) {
      return new LLMError('API 认证失败，请检查 API Key', 'auth_error', status, error)
    }
    if (status === 429) {
      return new LLMError('API 限流，请稍后重试', 'rate_limit', status, error)
    }
    if (status === 400 && error.message && (
      error.message.includes('context_length') ||
      error.message.includes('maximum context length') ||
      error.message.includes('token limit') ||
      error.message.includes('too long')
    )) {
      return new LLMError('上下文长度超过模型限制', 'context_too_long', status, error)
    }
    if (status && status >= 500) {
      return new LLMError(`服务器错误 (${status})`, 'server_error', status, error)
    }
    return new LLMError(error.message || 'OpenAI API 错误', 'api_error', status, error)
  }

  // Anthropic SDK 错误
  if (error instanceof Anthropic.APIError) {
    const status = error.status
    if (status === 401 || status === 403) {
      return new LLMError('API 认证失败，请检查 API Key', 'auth_error', status, error)
    }
    if (status === 429) {
      return new LLMError('API 限流，请稍后重试', 'rate_limit', status, error)
    }
    if (status === 400 && error.message && (
      error.message.includes('prompt is too long') ||
      error.message.includes('context_length')
    )) {
      return new LLMError('提示词过长', 'context_too_long', status, error)
    }
    if (status && status >= 500) {
      return new LLMError(`服务器错误 (${status})`, 'server_error', status, error)
    }
    return new LLMError(error.message || 'Anthropic API 错误', 'api_error', status, error)
  }

  // 网络错误
  if (error instanceof TypeError) {
    if (error.message.includes('fetch') ||
        error.message.includes('network') ||
        error.message.includes('connection')) {
      return new LLMError('网络连接失败', 'network_error', undefined, error)
    }
  }

  // 中断
  if (error instanceof DOMException && error.name === 'AbortError') {
    // 使用明确的 isUserAbort 标记区分中断类型，不依赖 abortController 状态（避免时序竞争）
    const message = isUserAbort
      ? '请求被用户中断'
      : '请求超时被中止（可能是 API 提供商限制了响应时间，如 60s），请稍后重试或尝试降低 thinking budget'
    return new LLMError(message, isUserAbort ? 'api_error' : 'network_error', undefined, error)
  }

  // 其他
  if (error instanceof Error) {
    return new LLMError(error.message, 'api_error', undefined, error)
  }

  return new LLMError(String(error), 'api_error')
}
