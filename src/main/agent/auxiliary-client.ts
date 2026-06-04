/**
 * 辅助 LLM 客户端
 *
 * 用于非核心任务的轻量级 LLM 调用（上下文压缩摘要、总结等）。
 * 复用主 Agent 的 API Key 和 Provider，支持运行时模型覆盖。
 *
 * 使用场景：
 * - context_compressor: 生成对话摘要
 * - 未来可扩展：代码总结、错误分析等
 */

import { AgentConfig, ToolResult, AgentMessage, ToolCall } from '../../core/types/agent'
import { LLMClient, LLMResponse } from './llm-client'
import { logger } from '../utils/logger'

// ==================== 配置 ====================

export interface AuxiliaryClientConfig {
  /** 主 Agent 配置（复用 API Key、Provider） */
  parentConfig: AgentConfig
  /** 辅助模型名称（可选，覆盖父模型） */
  summaryModel?: string
  /**
   * 独立辅助配置（可选，优先级高于 parentConfig）。
   * 当辅助模型使用完全不同的 provider/apiUrl/apiKey 时传入。
   */
  standaloneConfig?: AgentConfig
  /** 请求超时（毫秒），默认 30000 */
  timeout?: number
  /**
   * 模型支持的访问方式（模型测试时探测并保存）。
   * - 'invoke': 支持非流式调用（chat）
   * - 'stream': 支持流式调用（streamChat）
   */
  accessModes?: string[]
}

// ==================== 辅助客户端 ====================

/**
 * 辅助 LLM 客户端
 *
 * 复用主 LLMClient，但使用不同的模型和更简单的参数。
 * 专用于不需要工具调用、不需要流式响应的文本生成任务。
 */
export class AuxiliaryClient {
  private llm: LLMClient
  private summaryModel: string
  private timeout: number
  private accessModes: string[]

  constructor(config: AuxiliaryClientConfig) {
    const parent = config.parentConfig
    this.accessModes = config.accessModes ?? []

    if (config.standaloneConfig) {
      // 独立配置模式：完全不复用父配置
      const resolvedTimeout = config.timeout ?? 30000
      const auxConfig: AgentConfig = {
        provider: config.standaloneConfig.provider,
        apiUrl: config.standaloneConfig.apiUrl,
        apiKey: config.standaloneConfig.apiKey,
        model: config.standaloneConfig.model,
        maxIterations: 1,
        timeout: resolvedTimeout,
        maxRetries: config.standaloneConfig.maxRetries ?? 2,
        contextLength: config.standaloneConfig.contextLength,
      }

      this.summaryModel = auxConfig.model
      this.timeout = resolvedTimeout
      this.llm = new LLMClient(auxConfig)

      logger.info(
        `[AuxiliaryClient] 独立模式: model=${this.summaryModel} `
        + `provider=${config.standaloneConfig.provider} timeout=${this.timeout}ms`
      )
    } else {
      // 复用父配置，仅覆盖模型和超时
      const resolvedTimeout = config.timeout ?? 30000
      const auxConfig: AgentConfig = {
        provider: parent.provider,
        apiUrl: parent.apiUrl,
        apiKey: parent.apiKey,
        model: config.summaryModel || parent.model,
        maxIterations: 1,
        timeout: resolvedTimeout,
        maxRetries: parent.maxRetries ?? 2,
        contextLength: parent.contextLength,
      }

      this.summaryModel = auxConfig.model
      this.timeout = resolvedTimeout
      this.llm = new LLMClient(auxConfig)

      logger.info(
        `[AuxiliaryClient] 复用模式: model=${this.summaryModel} `
        + `provider=${parent.provider} timeout=${this.timeout}ms`
      )
    }
  }

  /**
   * 生成文本摘要
   *
   * 根据模型测试时记录的 accessModes 选择调用策略：
   * - 有 invoke（含同时支持）→ 先用 chat()，失败切 streamChat()
   * - 仅支持 stream → 先用 streamChat()，失败切 chat()
   * - 未探测 → 先用 chat()，失败切 streamChat()
   *
   * @param prompt 结构化摘要 prompt
   * @param maxTokens 最大输出 token 数
   * @returns 摘要文本，失败时返回 null
   */
  async generateSummary(
    prompt: string,
    maxTokens: number,
  ): Promise<string | null> {
    const messages = [
      {
        role: 'user' as const,
        content: prompt,
        timestamp: Date.now(),
      },
    ]

    const hasInvoke = this.accessModes.includes('invoke')
    const hasStream = this.accessModes.includes('stream')

    // 有 invoke（含同时支持）或都未探测 → 先 chat()
    if (hasInvoke || (!hasInvoke && !hasStream)) {
      try {
        const response = await this.llm.chat(messages)
        return response.content || null
      } catch (err) {
        logger.warn(
          `[AuxiliaryClient] generateSummary chat() 失败，尝试 streamChat():`,
          err,
        )
        return this._generateViaStream(messages)
      }
    }

    // 仅支持 stream → 先 streamChat()，失败切 chat()
    if (hasStream && !hasInvoke) {
      return this._generateViaStreamWithInvokeFallback(messages)
    }

    // 兜底（理论上不会到）
    return null
  }

  /**
   * 通过流式调用生成摘要（内部辅助方法）
   */
  private _generateViaStream(
    messages: Array<{
      role: 'user' | 'assistant' | 'system' | 'tool'
      content: string
      timestamp: number
    }>,
  ): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      let fullContent = ''

      this.llm.streamChat(
        messages,
        {
          onChunk: (text: string) => {
            fullContent += text
          },
          onDone: () => {
            resolve(fullContent || null)
          },
          onError: (err) => {
            logger.warn(
              '[AuxiliaryClient] generateSummary streamChat 也失败:',
              err,
            )
            resolve(null)
          },
        },
      ).catch((err) => {
        logger.warn('[AuxiliaryClient] generateSummary streamChat catch:', err)
        resolve(null)
      })
    })
  }

  /**
   * 先用 streamChat()，失败后降级到 chat()（内部辅助方法）
   */
  private _generateViaStreamWithInvokeFallback(
    messages: Array<{
      role: 'user' | 'assistant' | 'system' | 'tool'
      content: string
      timestamp: number
    }>,
  ): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      let fullContent = ''

      this.llm.streamChat(
        messages,
        {
          onChunk: (text: string) => {
            fullContent += text
          },
          onDone: () => {
            if (fullContent) {
              resolve(fullContent)
            } else {
              // streamChat 返回空内容，尝试 chat()
              this._generateViaChat(messages).then(resolve)
            }
          },
          onError: (err) => {
            logger.warn(
              '[AuxiliaryClient] generateSummary streamChat 失败，尝试 chat():',
              err,
            )
            this._generateViaChat(messages).then(resolve)
          },
        },
      ).catch((err) => {
        logger.warn(
          '[AuxiliaryClient] generateSummary streamChat catch，尝试 chat():',
          err,
        )
        this._generateViaChat(messages).then(resolve)
      })
    })
  }

  /**
   * 非流式调用（内部辅助方法）
   */
  private async _generateViaChat(
    messages: Array<{
      role: 'user' | 'assistant' | 'system' | 'tool'
      content: string
      timestamp: number
    }>,
  ): Promise<string | null> {
    try {
      const response = await this.llm.chat(messages)
      return response.content || null
    } catch (err) {
      logger.error(
        `[AuxiliaryClient] generateSummary chat 也失败:`,
        err,
      )
      return null
    }
  }

  /**
   * 通用 LLM 调用（支持自定义 messages）
   *
   * 用于后台压缩 Agent 等需要自定义对话结构的场景。
   * 使用流式调用避免 "Streaming is required" 错误。
   *
   * @param params.messages 自定义消息列表
   * @param params.maxTokens 最大输出 token 数
   * @returns 响应文本，失败时返回 null
   */
  async call(params: {
    messages: Array<{ role: string; content: string }>
    maxTokens?: number
  }): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      let fullContent = ''

      this.llm.streamChat(
        params.messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system' | 'tool',
          content: m.content,
          timestamp: Date.now(),
        })),
        {
          onChunk: (text: string) => {
            fullContent += text
          },
          onDone: () => {
            resolve(fullContent || null)
          },
          onError: (err) => {
            logger.warn('[AuxiliaryClient] streamChat onError:', err)
            resolve(null)
          },
        },
      ).catch((err) => {
        logger.warn('[AuxiliaryClient] streamChat catch:', err)
        resolve(null)
      })
    })
  }

  /**
   * 获取当前使用的模型名称
   */
  getModel(): string {
    return this.summaryModel
  }

  // ==================== 工具调用支持 ====================

  /** 工具分派回调，由调用方注入 */
  private toolDispatch: (name: string, args: Record<string, unknown>) => Promise<ToolResult> = async () => ({
    success: false,
    output: '未设置 toolDispatch 回调',
  })

  /**
   * 设置工具分派回调
   *
   * @param fn 工具分派函数，接收工具名和参数，返回 ToolResult
   */
  setToolDispatch(fn: (name: string, args: Record<string, unknown>) => Promise<ToolResult>): void {
    this.toolDispatch = fn
  }

  /**
   * 带工具调用的 LLM 调用
   *
   * 实现受控的工具调用循环：LLM → tool_use → dispatch → tool_result → 再次 LLM
   *
   * @param params.systemPrompt 系统提示
   * @param params.userPrompt 用户提示
   * @param params.tools 工具 schema 列表
   * @param params.maxIterations 最大迭代次数，默认 5
   * @returns 调用结果
   */
  async callWithTools(params: {
    systemPrompt: string
    userPrompt: string
    tools: Array<{ name: string; description: string; parameters: object }>
    maxIterations?: number
  }): Promise<{ success: boolean; iterationCount: number }> {
    const { systemPrompt, userPrompt, tools, maxIterations = 5 } = params

    const messages: AgentMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      try {
        const response = await this.llm.chat(messages, {
          tools: tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        })

        // 无工具调用 = 最终回复，成功退出
        if (!response.toolCalls || response.toolCalls.length === 0) {
          return { success: true, iterationCount: iteration + 1 }
        }

        // 将 assistant 回复加入消息历史
        messages.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })) as ToolCall[],
        })

        // 分派工具调用，收集结果
        for (const tc of response.toolCalls) {
          let toolResult: string
          try {
            const args = JSON.parse(tc.arguments)
            const result = await this.toolDispatch(tc.name, args)
            toolResult = result.output || (result.success ? '操作成功' : '操作失败')
          } catch (err) {
            toolResult = `工具执行异常: ${err instanceof Error ? err.message : String(err)}`
          }

          messages.push({
            role: 'tool',
            content: toolResult,
            tool_call_id: tc.id,
            name: tc.name,
          })
        }
      } catch (err) {
        logger.warn(`[AuxiliaryClient] callWithTools LLM 调用失败 (iteration ${iteration + 1}):`, err)
        return { success: false, iterationCount: iteration + 1 }
      }
    }

    return { success: false, iterationCount: maxIterations }
  }
}

