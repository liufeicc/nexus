/**
 * Anthropic API 适配器
 *
 * 职责：将 OpenAI 格式的消息/工具定义转换为 Anthropic 格式，
 * 并处理 Anthropic 特有的功能（thinking、tool streaming、OAuth 等）。
 */

import Anthropic from '@anthropic-ai/sdk'
import { AgentMessage, ContentBlock } from '../../core/types/agent'
import { ToolCallInfo } from './llm-client/types'
import { extractText } from './utils/extract-text'
import { logger } from '../utils/logger'

// ==================== Anthropic 模型输出限制 ====================

/**
 * 各 Anthropic 模型的最大输出 token 数
 * 来源：Anthropic 官方文档 + Cline model catalog
 */
const ANTHROPIC_OUTPUT_LIMITS: Record<string, number> = {
  'claude-opus-4-6':   128_000,
  'claude-sonnet-4-6':  64_000,
  'claude-opus-4-5':    64_000,
  'claude-sonnet-4-5':  64_000,
  'claude-haiku-4-5':   64_000,
  'claude-opus-4':      32_000,
  'claude-sonnet-4':    64_000,
  'claude-3-7-sonnet': 128_000,
  'claude-3-5-sonnet':   8_192,
  'claude-3-5-haiku':    8_192,
  'claude-3-opus':       4_096,
  'claude-3-sonnet':     4_096,
  'claude-3-haiku':      4_096,
  // 阿里云通义千问系列（通过 Anthropic 兼容接口）
  // max_tokens 是单次响应输出上限，131K 上下文窗口需要为 prompt 预留空间
  'qwen3-6-plus':       65_536,
  'qwen3-6':            32_768,
  'qwen3':              32_768,
}

const ANTHROPIC_DEFAULT_OUTPUT_LIMIT = 65_536

/**
 * 获取模型的最大输出 token 限制
 *
 * 使用子串匹配（最长前缀优先），支持带日期后缀的模型 ID
 * （如 claude-sonnet-4-6-20250929）
 */
function getAnthropicMaxOutput(model: string): number {
  const m = model.toLowerCase().replace(/\./g, '-')
  let bestKey = ''
  let bestVal = ANTHROPIC_DEFAULT_OUTPUT_LIMIT
  for (const [key, val] of Object.entries(ANTHROPIC_OUTPUT_LIMITS)) {
    if (m.includes(key) && key.length > bestKey.length) {
      bestKey = key
      bestVal = val
    }
  }
  return bestVal
}

/**
 * 判断模型是否支持 adaptive thinking（Claude 4.6+）
 */
function supportsAdaptiveThinking(model: string): boolean {
  return model.toLowerCase().includes('4-6') || model.toLowerCase().includes('4.6')
}

/**
 * 判断模型是否支持 thinking（排除 haiku）
 */
function supportsThinking(model: string): boolean {
  return !model.toLowerCase().includes('haiku')
}

// ==================== Thinking 配置 ====================

/**
 * Thinking 预算等级映射
 */
const THINKING_BUDGET: Record<string, number> = {
  xhigh:  32_000,
  high:   16_000,
  medium:  8_000,
  low:     4_000,
}

/**
 * Thinking 配置
 */
export interface ThinkingConfig {
  /** 是否启用 thinking */
  enabled: boolean
  /** 思考深度等级 */
  effort: 'xhigh' | 'high' | 'medium' | 'low'
}

/**
 * 转换用户消息内容为 Anthropic 格式
 *
 * 支持纯文本字符串和多模态 ContentBlock 数组。
 */
function convertUserContentToAnthropic(
  content: string | import('../../core/types/agent').ContentBlock[] | null,
): string | AnthropicContentBlock[] {
  if (content == null) return ''
  if (typeof content === 'string') return content

  // 多模态内容数组
  const blocks: AnthropicContentBlock[] = []
  for (const block of content) {
    if (block.type === 'text') {
      blocks.push({ type: 'text', text: block.text || '' })
    } else if (block.type === 'image' && block.image) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: block.image.mimeType,
          data: block.image.data,
        },
      })
    }
  }
  return blocks
}

// ==================== 消息格式转换 ====================

/**
 * Anthropic 消息块类型
 */
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[] }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/**
 * Anthropic 消息角色（只有 user 和 assistant）
 */
type AnthropicRole = 'user' | 'assistant'

/**
 * Anthropic 消息格式
 */
interface AnthropicMessage {
  role: AnthropicRole
  content: string | AnthropicContentBlock[]
}

/**
 * 将 OpenAI 格式的消息转换为 Anthropic 格式
 *
 * 主要差异：
 * - Anthropic 的 system prompt 是独立参数，不在 messages 里
 * - Anthropic 没有 tool 角色，工具结果用 user 消息的 tool_result block 表示
 * - Anthropic 的 assistant 工具调用用 tool_use block 表示
 */
export function convertToAnthropicMessages(
  messages: AgentMessage[],
): { system: string | null; messages: AnthropicMessage[] } {
  let system: string | null = null
  const result: AnthropicMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = extractText(msg.content)
      continue
    }

    if (msg.role === 'user') {
      result.push({
        role: 'user',
        content: convertUserContentToAnthropic(msg.content),
      })
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls?.length) {
        // assistant 返回了工具调用 → 转为 tool_use blocks
        const blocks: AnthropicContentBlock[] = []
        const textContent = extractText(msg.content)
        if (textContent) {
          blocks.push({ type: 'text', text: textContent })
        }
        for (const tc of msg.tool_calls) {
          blocks.push({
            type: 'tool_use',
            id: sanitizeToolId(tc.id),
            name: tc.name,
            input: safeJsonParse(tc.arguments),
          })
        }
        result.push({ role: 'assistant', content: blocks })
      } else {
        result.push({ role: 'assistant', content: extractText(msg.content) || '(empty)' })
      }
    } else if (msg.role === 'tool') {
      // 工具结果 → user 消息的 tool_result block
      // 如果 content 是 ContentBlock 数组（可能包含图片），转换为 Anthropic 格式
      let toolContent: string | AnthropicContentBlock[]
      if (Array.isArray(msg.content)) {
        const blocks: AnthropicContentBlock[] = []
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            blocks.push({ type: 'text', text: block.text })
          } else if (block.type === 'image' && block.image) {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: block.image.mimeType,
                data: block.image.data,
              },
            })
          }
        }
        toolContent = blocks.length > 0 ? blocks : [{ type: 'text', text: '(no output)' }]
      } else {
        toolContent = extractText(msg.content) || '(no output)'
      }

      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id ?? 'unknown',
        content: toolContent,
      }

      // 合并连续的 tool_result 到同一个 user 消息
      const lastMsg = result[result.length - 1]
      if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content) &&
          lastMsg.content[0]?.type === 'tool_result') {
        lastMsg.content.push(block)
      } else {
        result.push({ role: 'user', content: [block] })
      }
    }
  }

  // Anthropic API 严格要求消息角色交替（user → assistant → user → ...）
  // 合并连续相同角色的消息
  const enforceAlternation: AnthropicMessage[] = []
  for (const msg of result) {
    if (enforceAlternation.length > 0 && enforceAlternation[enforceAlternation.length - 1].role === msg.role) {
      // 合并到上一条消息
      const prev = enforceAlternation[enforceAlternation.length - 1]
      if (Array.isArray(prev.content) && Array.isArray(msg.content)) {
        prev.content = [...prev.content, ...msg.content]
      } else if (typeof prev.content === 'string' && typeof msg.content === 'string') {
        prev.content = prev.content + '\n\n' + msg.content
      } else {
        // 类型不一致，取后一条的内容
        prev.content = msg.content
      }
      continue
    }
    enforceAlternation.push({ ...msg })
  }

  // 确保没有空的 assistant 消息（Anthropic 会拒绝）
  for (const msg of enforceAlternation) {
    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string' && !msg.content.trim()) {
        msg.content = '(empty)'
      } else if (Array.isArray(msg.content) && msg.content.length === 0) {
        msg.content = [{ type: 'text', text: '(empty)' }]
      }
    }
  }

  return { system, messages: enforceAlternation }
}

/**
 * 将 OpenAI 格式的工具定义转换为 Anthropic 格式
 *
 * 差异：
 * - OpenAI: { function: { name, description, parameters } }
 * - Anthropic: { name, description, input_schema }
 */
export function convertToAnthropicTools(
  tools: Array<{ name: string; description: string; parameters: object }>,
): Array<{ name: string; description: string; input_schema: object }> {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))
}

// ==================== 响应解析 ====================

/**
 * 解析 Anthropic 响应为统一格式
 *
 * 处理：
 * - 提取 text 内容和 thinking 内容
 * - 转换 tool_use blocks 为 ToolCallInfo
 * - 映射 stop_reason 到 finish_reason
 */
export function parseAnthropicResponse(
  response: Anthropic.Message,
): {
  content: string
  toolCalls: ToolCallInfo[]
  thinking: string | null
  stopped: boolean
} {
  const textParts: string[] = []
  const thinkingParts: string[] = []
  const toolCalls: ToolCallInfo[] = []

  for (const block of response.content) {
    if (block.type === 'text') {
      textParts.push(block.text)
    } else if (block.type === 'thinking') {
      thinkingParts.push(block.thinking)
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input),
      })
    }
  }

  const stopReasonMap: Record<string, string> = {
    'end_turn': 'stop',
    'tool_use': 'tool_calls',
    'max_tokens': 'length',
    'stop_sequence': 'stop',
  }

  return {
    content: textParts.join('\n'),
    toolCalls,
    thinking: thinkingParts.length > 0 ? thinkingParts.join('\n\n') : null,
    stopped: stopReasonMap[response.stop_reason ?? ''] !== 'length',
  }
}

// ==================== 工具方法 ====================

/**
 * 清理工具调用 ID，确保符合 Anthropic 的要求
 * Anthropic 要求 ID 匹配 [a-zA-Z0-9_-]
 */
function sanitizeToolId(toolId: string): string {
  if (!toolId) return 'tool_0'
  const sanitized = toolId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return sanitized || 'tool_0'
}

/**
 * 安全解析 JSON
 */
function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str)
  } catch {
    return {}
  }
}

// ==================== 构建 API 参数 ====================

/**
 * 构建 Anthropic messages.create() 的参数
 *
 * 关键差异：
 * - max_tokens = 单次响应输出上限（≠ 总上下文窗口）
 * - thinking 参数：adaptive 模式（4.6+）或 enabled 模式（旧模型）
 * - tool_choice 格式不同（auto/any/tool vs auto/required/none）
 */
export function buildAnthropicParams(
  messages: AnthropicMessage[],
  system: string | null,
  tools: Array<{ name: string; description: string; input_schema: object }> | null,
  model: string,
  maxTokens?: number,
  thinkingConfig?: ThinkingConfig,
): Record<string, unknown> {
  const effectiveMaxTokens = maxTokens ?? getAnthropicMaxOutput(model)

  const params: Record<string, unknown> = {
    model,
    messages,
    max_tokens: effectiveMaxTokens,
  }

  if (system) {
    params.system = system
  }

  if (tools?.length) {
    params.tools = tools
    params.tool_choice = { type: 'auto' }
  }

  // Thinking 配置
  if (thinkingConfig?.enabled && supportsThinking(model)) {
    const effort = thinkingConfig.effort ?? 'medium'

    if (supportsAdaptiveThinking(model)) {
      // Claude 4.6+ 支持 adaptive thinking
      params.thinking = { type: 'adaptive' }
      params.output_config = { effort: effort }
    } else {
      // 旧模型使用手动 thinking + budget_tokens
      const budget = THINKING_BUDGET[effort] ?? 8_000
      params.thinking = { type: 'enabled', budget_tokens: budget }
      // Anthropic 要求 thinking 启用时 temperature 必须为 1
      params.temperature = 1
      // max_tokens 必须大于 budget_tokens
      params.max_tokens = Math.max(effectiveMaxTokens, budget + 4_096)
    }
  }

  // DEBUG: 打印最终构建的请求参数
  logger.debug(`[AnthropicAdapter] 请求参数: model=${model}, max_tokens=${params['max_tokens']}, system=${!!system}, tools=${tools?.length ?? 0}, thinking=${JSON.stringify(params['thinking'])}, output_config=${JSON.stringify(params['output_config'])}, tool_choice=${JSON.stringify(params['tool_choice'])}`)

  return params
}

// ==================== 创建 Anthropic 客户端 ====================

/**
 * 创建 Anthropic 客户端
 *
 * 简化版：不支持 OAuth（Nexus 只需要 API Key 认证）
 */
export function createAnthropicClient(
  apiKey: string,
  baseUrl?: string,
): Anthropic {
  const config: ConstructorParameters<typeof Anthropic>[0] = {
    apiKey,
    maxRetries: 0, // 我们自己处理重试
  }

  if (baseUrl) {
    config.baseURL = baseUrl
  }

  return new Anthropic(config)
}
