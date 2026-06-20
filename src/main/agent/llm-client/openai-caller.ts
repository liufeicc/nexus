/**
 * OpenAI 调用器
 *
 * 负责通过 OpenAI SDK 发送 Chat Completions 请求，
 * 并处理 AgentMessage ↔ OpenAI API 格式的双向转换。
 *
 * 支持能力：
 * - 流式 / 非流式响应
 * - 工具调用（function calling）
 * - 多模态内容（文本 + 图片）
 * - reasoning/thinking 参数（兼容 SiliconFlow、智谱等提供商）
 */

import OpenAI from 'openai'
import { AgentMessage, ContentBlock } from '../../../core/types/agent'
import { LLMError, LLMResponse, LLMUsage, StreamCallbacks, ToolCallInfo } from './types'
import { ThinkingConfig } from '../anthropic-adapter'

/**
 * 调用 OpenAI Chat Completions API
 *
 * SDK 文档：https://platform.openai.com/docs/api-reference/chat
 */
export async function callOpenAI(
  client: OpenAI,
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
  // 转换为 OpenAI API 格式的消息
  const apiMessages = toOpenAIMessages(messages)

  const body: Record<string, unknown> = {
    model,
    messages: apiMessages,
    max_tokens: 3200000,
    stream,
  }

  // 工具
  if (options?.tools?.length) {
    body.tools = options.tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
  }

  // reasoning/thinking 参数（兼容提供商，如 SiliconFlow、智谱等）
  if (options?.thinking) {
    ;(body as any).extra_body = {
      reasoning: {
        enabled: true,
        effort: options.thinking.effort,
      },
    }
  }

  try {
    if (stream && callbacks) {
      return await handleStream(client, body, callbacks, signal)
    } else {
      return await handleNonStream(client, body, signal)
    }
  } catch (error) {
    if (signal.aborted) throw new LLMError('请求被中断', 'api_error')
    throw error
  }
}

// ==================== 流式 / 非流式处理 ====================

/**
 * 处理流式响应
 */
async function handleStream(
  client: OpenAI,
  body: Record<string, unknown>,
  callbacks: StreamCallbacks,
  signal: AbortSignal,
): Promise<LLMResponse> {
  const streamResult = await client.chat.completions.create({
    ...body,
    stream: true,
  } as OpenAI.ChatCompletionCreateParamsStreaming, {
    signal: signal as any,
  })

  let fullContent = ''
  const toolCalls: ToolCallInfo[] = []
  const toolCallEmitted = new Set<number>()  // 已发出 onToolCallStart 的 index
  let usage: LLMUsage | undefined

  for await (const chunk of streamResult) {
    const delta = chunk.choices[0]?.delta

    if (delta?.content) {
      fullContent += delta.content
      callbacks.onChunk(delta.content)
    }

    // reasoning/thinking 内容（兼容提供商）
    const reasoningText = (delta as any)?.reasoning_content || (delta as any)?.reasoning
    if (reasoningText) {
      callbacks.onThinking?.(reasoningText)
    }

    // 收集流式工具调用
    if ((delta as any)?.tool_calls) {
      for (const tc of (delta as any).tool_calls) {
        const idx = tc.index ?? 0
        if (!toolCalls[idx]) {
          toolCalls[idx] = { id: tc.id ?? '', name: '', arguments: '' }
        }
        if (tc.id) toolCalls[idx].id = tc.id
        const fn = (tc as any).function
        if (fn?.name) toolCalls[idx].name = fn.name
        if (fn?.arguments) toolCalls[idx].arguments += fn.arguments

        // 当 id 和 name 都已知道，且尚未发出过回调时，立即通知上层
        // 注意：空字符串 '' 是 falsy，需要用 .length 判断
        if (!toolCallEmitted.has(idx) && toolCalls[idx].id && toolCalls[idx].name.length > 0 && callbacks.onToolCallStart) {
          toolCallEmitted.add(idx)
          callbacks.onToolCallStart(toolCalls[idx].id, toolCalls[idx].name)
        }
      }
    }

    // OpenAI 流式响应的 usage 在最后一个 chunk 上
    if ((chunk as any).usage) {
      const u = (chunk as any).usage
      usage = {
        promptTokens: u.prompt_tokens ?? 0,
        completionTokens: u.completion_tokens ?? 0,
        totalTokens: u.total_tokens ?? 0,
      }
    }
  }

  // 如果最后一个 chunk 没有 usage，尝试从 streamResult.finalUsage 获取
  if (!usage) {
    const fu = (streamResult as any).finalUsage
    if (fu) {
      usage = {
        promptTokens: fu.prompt_tokens ?? 0,
        completionTokens: fu.completion_tokens ?? 0,
        totalTokens: fu.total_tokens ?? 0,
      }
    }
  }

  return {
    content: fullContent,
    toolCalls,
    thinking: null,
    stopped: true,
    usage,
  }
}

/**
 * 处理非流式响应
 */
async function handleNonStream(
  client: OpenAI,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<LLMResponse> {
  const completion = await client.chat.completions.create(
    body as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming, {
    signal: signal as any,
  })

  const choice = completion.choices[0]
  const message = choice?.message
  const u = completion.usage

  return {
    content: message?.content ?? '',
    toolCalls: (message?.tool_calls as any[] ?? []).map((tc: any) => {
      const fn = tc.function
      return {
        id: tc.id ?? '',
        name: fn?.name ?? '',
        arguments: fn?.arguments ?? '{}',
      }
    }),
    thinking: null,
    stopped: choice?.finish_reason !== 'length',
    usage: u ? {
      promptTokens: u.prompt_tokens ?? 0,
      completionTokens: u.completion_tokens ?? 0,
      totalTokens: u.total_tokens ?? 0,
    } : undefined,
  }
}

// ==================== 消息格式转换 ====================

/**
 * 将 AgentMessage 转换为 OpenAI API 格式
 *
 * 支持多模态 ContentBlock 数组（文本 + 图片）。
 */
function toOpenAIMessages(messages: AgentMessage[]): Array<{
  role: string
  content: string | null | Array<{ type: string; text?: string; image_url?: { url: string } }>
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  tool_call_id?: string
}> {
  return messages.map(msg => {
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      // OpenAI 要求 assistant 消息有 tool_calls 时，content 必须是 string 或 null
      // 将 ContentBlock 数组转换为纯字符串
      let assistantContent: string | null
      if (Array.isArray(msg.content)) {
        const parts: string[] = []
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            parts.push(block.text)
          } else if (block.type === 'image' && block.image) {
            parts.push(`[图片: ${block.image.mimeType}]`)
          }
        }
        assistantContent = parts.join('\n') || null
      } else {
        assistantContent = msg.content ?? null
      }
      return {
        role: 'assistant' as const,
        content: assistantContent,
        tool_calls: msg.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      }
    }

    if (msg.role === 'tool') {
      // 如果 content 是 ContentBlock 数组（可能包含图片），需要转换
      let toolContent: string
      if (Array.isArray(msg.content)) {
        // OpenAI tool 消息只接受字符串内容
        // 提取文本块，将图片转为描述文本
        const parts: string[] = []
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            parts.push(block.text)
          } else if (block.type === 'image' && block.image) {
            // 将图片转为内联描述（OpenAI tool 角色不支持 image_url）
            parts.push(`[图片内容: ${block.image.mimeType}]`)
          }
        }
        toolContent = parts.join('\n')
      } else {
        toolContent = msg.content ?? ''
      }
      return {
        role: 'tool' as const,
        content: toolContent,
        tool_call_id: msg.tool_call_id ?? 'unknown',
        name: msg.name ?? 'tool',
      }
    }

    if (msg.role === 'user') {
      return {
        role: msg.role,
        content: convertUserContentToOpenAI(msg.content),
      }
    }

    return {
      role: msg.role,
      content: msg.content,
    }
  })
}

/**
 * 转换用户消息内容为 OpenAI API 格式
 *
 * 支持字符串和 ContentBlock 多模态数组（文本 + 图片 base64 data URI）。
 */
function convertUserContentToOpenAI(
  content: string | ContentBlock[] | null,
): string | null | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (content == null) return null
  if (typeof content === 'string') return content

  // 多模态内容数组
  const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text || '' })
    } else if (block.type === 'image' && block.image) {
      // OpenAI 格式：base64 data URI
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${block.image.mimeType};base64,${block.image.data}`,
        },
      })
    }
  }
  return parts
}
