/**
 * Anthropic 调用器
 *
 * 负责通过 Anthropic SDK 发送 Messages API 请求，
 * 消息格式转换由 anthropic-adapter.ts 处理。
 *
 * 支持能力：
 * - 流式 / 非流式响应
 * - 工具调用（tool_use）
 * - Thinking 支持（Claude 4.6+ 的 extended thinking）
 */

import Anthropic from '@anthropic-ai/sdk'
import { AgentMessage } from '../../../core/types/agent'
import { LLMError, LLMResponse, StreamCallbacks, ToolCallInfo } from './types'
import {
  convertToAnthropicMessages,
  convertToAnthropicTools,
  parseAnthropicResponse,
  buildAnthropicParams,
  ThinkingConfig,
} from '../anthropic-adapter'

/**
 * 调用 Anthropic Messages API
 *
 * 通过 anthropic-adapter.ts 转换消息格式和构建参数
 *
 * SDK 文档：https://docs.anthropic.com/en/api/messages
 */
export async function callAnthropic(
  client: Anthropic,
  model: string,
  messages: AgentMessage[],
  options: {
    tools?: Array<{ name: string; description: string; parameters: object }>
    thinking?: ThinkingConfig
  } | undefined,
  stream: boolean,
  callbacks: StreamCallbacks | undefined,
  signal: AbortSignal,
): Promise<LLMResponse> {
  // 转换消息格式（OpenAI → Anthropic）
  const { system, messages: anthropicMessages } = convertToAnthropicMessages(messages)

  // 转换工具定义
  const anthropicTools = options?.tools?.length
    ? convertToAnthropicTools(options.tools)
    : null

  // 构建请求参数
  const params = buildAnthropicParams(
    anthropicMessages,
    system,
    anthropicTools,
    model,
    undefined, // maxTokens（让 adapter 根据模型自动设置）
    options?.thinking,
  )

  try {
    if (stream && callbacks) {
      return await streamAnthropic(client, anthropicMessages, params, anthropicTools, callbacks, signal)
    } else {
      return await chatAnthropic(client, params, signal)
    }
  } catch (error) {
    if (signal.aborted) throw new LLMError('请求被中断', 'api_error')
    throw error
  }
}

// ==================== 非流式调用 ====================

/**
 * 非流式 Anthropic 调用
 */
async function chatAnthropic(
  client: Anthropic,
  params: Record<string, unknown>,
  signal: AbortSignal,
): Promise<LLMResponse> {
  const response = await client.messages.create(params as any, {
    signal: signal as any,
  })

  const parsed = parseAnthropicResponse(response)
  const u = response.usage

  return {
    ...parsed,
    usage: u ? {
      promptTokens: u.input_tokens ?? 0,
      completionTokens: u.output_tokens ?? 0,
      totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
    } : undefined,
  }
}

// ==================== 流式调用 ====================

/**
 * 流式 Anthropic 调用
 *
 * Anthropic SDK 的流式响应事件：
 * - content_block_start: 内容块开始（text / tool_use / thinking）
 * - content_block_delta: 内容块增量（文本、thinking、工具参数）
 * - content_block_stop: 内容块结束
 * - message_delta: 消息级别的更新（finish_reason）
 */
async function streamAnthropic(
  client: Anthropic,
  messages: any[],
  params: Record<string, unknown>,
  tools: any[] | null,
  callbacks: StreamCallbacks,
  signal: AbortSignal,
): Promise<LLMResponse> {
  let fullContent = ''
  let fullThinking = ''

  const streamParams = { ...params } as any
  if (tools?.length) {
    streamParams.tools = tools
  }

  const stream = await client.messages.stream(streamParams, {
    signal: signal as any,
  })

  // Anthropic SDK v4 的事件监听：
  // - text: 文本增量（delta.text）
  // - thinking: thinking 增量（Claude 4.6+）
  // - inputJson: 工具参数增量（fine-grained tool streaming，部分模型不支持）
  stream.on('text', (textDelta: string) => {
    fullContent += textDelta
    callbacks.onChunk(textDelta)
  })

  stream.on('thinking', (thinkingDelta: string) => {
    fullThinking += thinkingDelta
    callbacks.onThinking?.(thinkingDelta)
  })

  // 通过 streamEvent 监听原始 SSE 事件，检测 tool_use 块开始
  stream.on('streamEvent', (event: any) => {
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      const toolId = event.content_block.id ?? ''
      const toolName = event.content_block.name ?? ''
      if (toolId && toolName) {
        callbacks.onToolCallStart?.(toolId, toolName)
      }
    }
  })

  // 等待流结束
  const finalMessage = await stream.finalMessage()

  // 从 finalMessage 中提取工具调用和文本内容
  // 某些模型（如 qwen）可能不触发 text/inputJson 事件，需要从 finalMessage.content 提取
  const toolCalls: ToolCallInfo[] = []
  for (const block of finalMessage.content) {
    if (block.type === 'text') {
      // 如果流式事件没有捕获到文本，从 block 中提取并通知
      if (!fullContent) {
        fullContent = (block as any).text || ''
        callbacks.onChunk(fullContent)
      }
    } else if (block.type === 'thinking') {
      if (!fullThinking) {
        fullThinking = (block as any).thinking || fullThinking
      }
    } else if (block.type === 'tool_use') {
      const tb = block as any
      toolCalls.push({
        id: tb.id ?? '',
        name: tb.name ?? '',
        arguments: JSON.stringify(tb.input ?? {}),
      })
    }
  }

  const u = (finalMessage as any).usage

  return {
    content: fullContent,
    toolCalls,
    thinking: fullThinking || null,
    stopped: finalMessage.stop_reason !== 'max_tokens',
    usage: u ? {
      promptTokens: u.input_tokens ?? 0,
      completionTokens: u.output_tokens ?? 0,
      totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
    } : undefined,
  }
}
