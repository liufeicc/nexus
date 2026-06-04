/**
 * LLM 客户端
 *
 * 作用：统一与各种 LLM API 的通信，屏蔽 OpenAI、Anthropic 等不同 API 的差异。
 *
 * 核心能力：
 * - 流式响应支持（SSE，逐字输出）
 * - 自动重试（超时、限流时指数退避）
 * - 错误分类（是限流还是认证失败还是上下文超长）
 * - Thinking 支持（Claude 4.6+ 的 extended thinking）
 *
 * 模块拆分：
 * - llm-client/types.ts       — 类型定义 + 错误分类函数
 * - llm-client/openai-caller.ts    — OpenAI SDK 调用 + 消息格式转换
 * - llm-client/anthropic-caller.ts — Anthropic SDK 调用
 */

import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { AgentConfig, AgentMessage } from '../../core/types/agent'
import { logger } from '../utils/logger'
import { logModelRequest, logModelResponse } from '../utils/model-logger'
import { createAnthropicClient, ThinkingConfig } from './anthropic-adapter'
import { classifyError, LLMError, LLMResponse, StreamCallbacks } from './llm-client/types'
import { callOpenAI } from './llm-client/openai-caller'
import { callAnthropic } from './llm-client/anthropic-caller'

// Re-export 所有公共类型，保持向后兼容
export type {
  LLMErrorType,
  StreamCallbacks,
  LLMUsage,
  LLMResponse,
  ToolCallInfo,
} from './llm-client/types'
export { LLMError } from './llm-client/types'

// ==================== LLM 客户端类 ====================

/**
 * LLM 客户端
 *
 * 核心能力：
 * - OpenAI provider: 使用 openai SDK 的 chat.completions
 * - Anthropic provider: 使用 anthropic SDK + adapter 转换
 */
export class LLMClient {
  private config: AgentConfig
  private _openai: OpenAI | null = null
  private _anthropic: Anthropic | null = null
  private abortController: AbortController | null = null
  /** 标记当前请求是否由用户主动中断（区分用户中断 vs 超时中断） */
  private _userAborted: boolean = false

  constructor(config: AgentConfig) {
    this.config = config
    this._initClients()
  }

  /**
   * 更新配置（支持运行时切换模型或 API Key）
   */
  updateConfig(partial: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...partial }
    this._initClients()
  }

  /**
   * 初始化 SDK 客户端实例
   */
  private _initClients(): void {
    if (this.config.provider === 'openai') {
      this._openai = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.apiUrl || undefined,
        maxRetries: 0, // 我们自己处理重试
      })
      this._anthropic = null
    } else {
      this._anthropic = createAnthropicClient(
        this.config.apiKey,
        this.config.apiUrl || undefined,
      )
      this._openai = null
    }
  }

  // ==================== 公共 API ====================

  /**
   * 发送非流式请求
   *
   * @param messages 对话消息列表（AgentMessage 格式）
   * @param options.tools 可用工具列表（可选）
   * @param options.thinking Thinking 配置（仅 Anthropic，可选）
   * @returns LLM 响应（文本内容 + 可能的工具调用 + thinking）
   */
  async chat(
    messages: AgentMessage[],
    options?: {
      tools?: Array<{ name: string; description: string; parameters: object }>
      thinking?: ThinkingConfig
    },
  ): Promise<LLMResponse> {
    const abortController = new AbortController()
    this.abortController = abortController
    this._userAborted = false

    const timeout = this.config.timeout || 600000
    const timeoutId = setTimeout(() => abortController.abort(), timeout)

    // 记录请求日志
    logModelRequest(messages, options)

    try {
      const response = await this._callWithRetry(
        () => this._doChat(messages, options, abortController.signal),
        abortController.signal,
      )
      clearTimeout(timeoutId)

      // 记录响应日志（不包含 thinking）
      logModelResponse({ ...response, thinking: undefined })

      return response
    } catch (error) {
      clearTimeout(timeoutId)
      throw classifyError(error, this._userAborted)
    } finally {
      this.abortController = null
    }
  }

  /**
   * 发送流式请求
   *
   * @param messages 对话消息列表
   * @param callbacks 流式回调（onChunk 接收增量文本，onDone 完成，onError 错误）
   * @param options.tools 可用工具列表（可选）
   * @param options.thinking Thinking 配置（仅 Anthropic，可选）
   * @returns LLM 响应结果（包含 toolCalls 和 thinking）
   */
  async streamChat(
    messages: AgentMessage[],
    callbacks: StreamCallbacks,
    options?: {
      tools?: Array<{ name: string; description: string; parameters: object }>
      thinking?: ThinkingConfig
    },
  ): Promise<LLMResponse> {
    const abortController = new AbortController()
    this.abortController = abortController
    this._userAborted = false

    const timeout = this.config.timeout || 600000
    const timeoutId = setTimeout(() => abortController.abort(), timeout)

    // 记录请求日志
    logModelRequest(messages, options)

    try {
      // 流式请求也走重试逻辑（超时等可重试错误会自动重试）
      const result = await this._callWithRetry(
        () => this._doStreamChat(messages, callbacks, options, abortController.signal),
        abortController.signal,
      )
      clearTimeout(timeoutId)
      callbacks.onDone()

      // 记录响应日志（不包含 thinking）
      logModelResponse({ ...result, thinking: undefined })

      return result
    } catch (error) {
      clearTimeout(timeoutId)
      if (!abortController.signal.aborted) {
        callbacks.onError(classifyError(error, this._userAborted))
      }
      throw classifyError(error, this._userAborted)
    } finally {
      this.abortController = null
    }
  }

  /**
   * 中断当前请求
   */
  abort(): void {
    logger.info(`[LLMClient] abort() 被调用, abortController 存在=${!!this.abortController}`)
    this._userAborted = true
    if (this.abortController) {
      this.abortController.abort()
      logger.info('[LLMClient] abortController.abort() 已调用')
    }
    this.abortController = null
  }

  /**
   * 分类错误类型（委托给 types.ts 中的独立函数）
   *
   * 外部调用者通过此方法分类错误，内部自动传入 _userAborted 标记以区分
   * 用户主动中断和超时中断。
   */
  classifyError(error: unknown): LLMError {
    return classifyError(error, this._userAborted)
  }

  // ==================== 内部实现 ====================

  /**
   * 执行一次 API 调用（不含重试）
   *
   * 根据 provider 分派到对应的 caller 模块。
   */
  private async _doChat(
    messages: AgentMessage[],
    options: {
      tools?: Array<{ name: string; description: string; parameters: object }>
      thinking?: ThinkingConfig
    } | undefined,
    signal: AbortSignal,
  ): Promise<LLMResponse> {
    if (this.config.provider === 'anthropic' && this._anthropic) {
      return callAnthropic(this._anthropic, this.config.model, messages, options, false, undefined, signal)
    } else if (this._openai) {
      return callOpenAI(this._openai, this.config.model, messages, options, false, undefined, signal)
    }
    throw new LLMError('LLM 客户端未初始化', 'api_error')
  }

  /**
   * 执行一次流式 API 调用
   *
   * 根据 provider 分派到对应的 caller 模块。
   */
  private async _doStreamChat(
    messages: AgentMessage[],
    callbacks: StreamCallbacks,
    options: {
      tools?: Array<{ name: string; description: string; parameters: object }>
      thinking?: ThinkingConfig
    } | undefined,
    signal: AbortSignal,
  ): Promise<LLMResponse> {
    if (this.config.provider === 'anthropic' && this._anthropic) {
      return callAnthropic(this._anthropic, this.config.model, messages, options, true, callbacks, signal)
    } else if (this._openai) {
      return callOpenAI(this._openai, this.config.model, messages, options, true, callbacks, signal)
    }
    throw new LLMError('LLM 客户端未初始化', 'api_error')
  }

  // ==================== 重试逻辑 ====================

  /**
   * 带重试的调用循环
   *
   * 指数退避：1s → 2s → 4s → 8s（最大 30s）
   * 只有 rate_limit / server_error / network_error 才重试
   */
  private async _callWithRetry<T>(
    fn: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    const maxRetries = this.config.maxRetries ?? 3
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        if (signal.aborted) throw new LLMError('请求被中断', 'api_error')

        // 指数退避：1s, 2s, 4s, 8s...
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000)
        logger.debug(`[LLM] 第 ${attempt} 次重试，等待 ${delay}ms`)
        await this._sleep(delay)
      }

      try {
        return await fn()
      } catch (error) {
        lastError = error as Error
        const classified = classifyError(error, this._userAborted)

        // 这些错误不应该重试
        if (classified.type === 'auth_error' ||
            classified.type === 'api_error' ||
            classified.type === 'context_too_long') {
          throw classified
        }
        // rate_limit / server_error / network_error → 继续重试
        logger.warn(`[LLM] 请求失败 (${classified.type})，准备重试...`)
      }
    }

    throw lastError || new LLMError('LLM 请求失败（重试次数已耗尽）', 'api_error')
  }

  /**
   * 延迟工具方法
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
