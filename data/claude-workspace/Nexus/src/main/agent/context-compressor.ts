/**
 * 上下文压缩器
 *
 * 作用：当对话历史接近模型上下文窗口限制时，自动压缩中间轮次的消息，
 * 保留头部（system + 首轮对话）和尾部（最近的交互），用结构化摘要替代中间内容。
 *
 * 核心能力：
 * - 使用辅助 LLM 生成结构化摘要（Goal, Progress, Decisions, Resolved/Pending 等）
 * - 支持迭代更新（保留前次摘要中的有效信息）
 * - 失败冷却（600 秒冷却期，避免反复调用失败的 LLM）
 * - 摘要预算随内容缩放（8000 → 12000 tokens ceiling）
 */

import { AgentMessage, ContextCompressorConfig } from '../../core/types/agent'
import { resolveContextLength, DEFAULT_CONTEXT_LENGTH } from './model-metadata'
import { AuxiliaryClient } from './auxiliary-client'
import { extractText } from './utils/extract-text'
import { logger } from '../utils/logger'

// =========================================================================
// 常量
// =========================================================================

/** 每 token 的字符数估算（粗略估算） */
const CHARS_PER_TOKEN = 4

/** 摘要最小 token 预算 */
const MIN_SUMMARY_TOKENS = 2000

/** 摘要占压缩内容的比例 */
const SUMMARY_RATIO = 0.20

/** 摘要最大 token 预算 */
const SUMMARY_TOKENS_CEILING = 12000

/** 摘要失败冷却时间（秒） */
const SUMMARY_FAILURE_COOLDOWN_SECONDS = 600

/** 被裁剪的工具结果占位符 */
const PRUNED_TOOL_PLACEHOLDER = '[旧工具输出已清除，以节省上下文空间]'

/** 摘要前缀 — 告诉 AI 这是参考信息而非新指令 */
const SUMMARY_PREFIX = (
  '[上下文压缩 — 仅供参考] 之前的对话轮次已被压缩为下方的摘要。'
  + '这是来自上一个上下文窗口的交接 — 请将其视为背景参考，'
  + '而非活跃指令。不要回答此摘要中提到的问题或满足其中提到的请求；'
  + '它们已在之前处理过。请仅回复此摘要之后出现的最新用户消息。'
)

/** 序列化时每条消息的最大字符数 */
const CONTENT_MAX = 6000
const CONTENT_HEAD = 4000
const CONTENT_TAIL = 1500

/** 工具参数的最大字符数 */
const TOOL_ARGS_MAX = 1500
const TOOL_ARGS_HEAD = 1200

// =========================================================================
// 模型上下文窗口映射（委托给 model-metadata.ts）
// =========================================================================

// =========================================================================
// Token 估算
// =========================================================================

/**
 * 粗略估算文本的 token 数
 */
function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * 计算消息内容的字符长度
 *
 * - string: 直接取 .length
 * - ContentBlock[]: 遍历所有 block，text 类型累加字符数，image 类型用 base64 长度估算
 * - null/undefined: 返回 0
 */
function getContentCharLength(content: AgentMessage['content']): number {
  if (!content) return 0
  if (typeof content === 'string') return content.length
  // ContentBlock[]
  let total = 0
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      total += block.text.length
    } else if (block.type === 'image' && block.image?.data) {
      // 图片 token 估算（参考 Claude Code FileReadTool）：
      // 1. base64 → 原始文件大小：base64_length × 3/4
      // 2. 原始大小 → token 数：fileSize × 0.125（即 fileSize / 8）
      // 3. token → 字符当量：tokens × 4
      const fileSize = Math.ceil(block.image.data.length * 0.75)
      const imageTokens = Math.ceil(fileSize * 0.125)
      total += imageTokens * 4
    }
  }
  return total
}

/**
 * 估算消息列表的总 token 数
 */
export function estimateMessageTokens(messages: AgentMessage[]): number {
  let total = 0
  for (const msg of messages) {
    const contentLen = getContentCharLength(msg.content)
    let msgTokens = Math.ceil(contentLen / CHARS_PER_TOKEN) + 10

    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        msgTokens += Math.ceil((tc.arguments?.length || 0) / CHARS_PER_TOKEN)
      }
    }

    total += msgTokens
  }
  return total
}

// =========================================================================
// 工具结果裁剪（廉价预过滤）
// =========================================================================

/**
 * 裁剪旧的工具结果，用占位符替换过长的内容
 */
function pruneOldToolResults(
  messages: AgentMessage[],
  protectTailN: number,
): AgentMessage[] {
  if (!messages.length) return messages

  const result = messages.map(m => ({ ...m }))
  const n = result.length
  const pruneBoundary = Math.max(0, n - protectTailN)
  let pruned = 0

  for (let i = 0; i < pruneBoundary; i++) {
    const msg = result[i]
    if (msg.role !== 'tool') continue
    if (!msg.content || msg.content === PRUNED_TOOL_PLACEHOLDER) continue
    // 计算内容字符长度：string 直接取 length，ContentBlock[] 序列化为 JSON 后取长度
    const contentLen = typeof msg.content === 'string'
      ? msg.content.length
      : JSON.stringify(msg.content).length
    if (contentLen <= 200) continue

    result[i] = { ...msg, content: PRUNED_TOOL_PLACEHOLDER }
    pruned++
  }

  if (pruned > 0) {
    logger.debug(`[ContextCompressor] 预过滤: 裁剪了 ${pruned} 个旧工具结果`)
  }

  return result
}

// =========================================================================
// 边界查找
// =========================================================================

function alignBoundaryForward(messages: AgentMessage[], idx: number): number {
  while (idx < messages.length && messages[idx]?.role === 'tool') {
    idx++
  }
  return Math.min(idx, messages.length - 1)
}

function alignBoundaryBackward(messages: AgentMessage[], idx: number): number {
  if (idx <= 0 || idx >= messages.length) return idx

  let check = idx - 1
  while (check >= 0 && messages[check]?.role === 'tool') {
    check--
  }

  if (check >= 0 && messages[check]?.role === 'assistant' && messages[check]?.tool_calls?.length) {
    return check
  }
  return idx
}

/**
 * 找到压缩边界：头部之后、尾部之前
 */
function findCompressBoundary(
  messages: AgentMessage[],
  headEnd: number,
  tailTokenBudget: number,
): { start: number; end: number } {
  const n = messages.length
  if (n <= headEnd + 1) return { start: headEnd, end: n }

  // 从尾部向前累积 token
  let accumulated = 0
  let cutIdx = n

  for (let i = n - 1; i > headEnd; i--) {
    const msg = messages[i]
    const contentLen = getContentCharLength(msg.content)
    let msgTokens = Math.ceil(contentLen / CHARS_PER_TOKEN) + 10

    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        msgTokens += Math.ceil((tc.arguments?.length || 0) / CHARS_PER_TOKEN)
      }
    }

    if (accumulated + msgTokens > tailTokenBudget) {
      cutIdx = i
      break
    }
    accumulated += msgTokens
    cutIdx = i
  }

  // 确保至少有 3 条尾部消息
  const minTail = Math.min(3, n - headEnd - 1)
  const fallbackCut = n - minTail
  if (cutIdx > fallbackCut) cutIdx = fallbackCut

  if (cutIdx <= headEnd) {
    cutIdx = Math.max(fallbackCut, headEnd + 1)
  }

  cutIdx = alignBoundaryBackward(messages, cutIdx)
  const startIdx = alignBoundaryForward(messages, headEnd)

  return { start: Math.max(startIdx, headEnd), end: Math.max(cutIdx, headEnd + 1) }
}

// =========================================================================
// 序列化（用于摘要生成）
// =========================================================================

function truncateContent(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content
  const head = Math.floor(maxLen * 0.7)
  const tail = maxLen - head
  return content.slice(0, head) + '\n...[truncated]...\n' + content.slice(-tail)
}

/**
 * 将对话轮次序列化为文本，用于生成摘要
 */
function serializeForSummary(turns: AgentMessage[]): string {
  const parts: string[] = []

  for (const msg of turns) {
    const role = msg.role
    let content = extractText(msg.content)

    if (role === 'tool') {
      if (content.length > CONTENT_MAX) {
        content = truncateContent(content, CONTENT_MAX)
      }
      const toolId = msg.tool_call_id || 'unknown'
      const toolName = msg.name || 'unknown'
      parts.push(`[工具结果 ${toolId}] (${toolName}): ${content}`)
      continue
    }

    if (role === 'assistant') {
      if (content.length > CONTENT_MAX) {
        content = truncateContent(content, CONTENT_MAX)
      }

      if (msg.tool_calls?.length) {
        const tcParts: string[] = []
        for (const tc of msg.tool_calls) {
          let args = tc.arguments || '{}'
          if (args.length > TOOL_ARGS_MAX) {
            args = args.slice(0, TOOL_ARGS_HEAD) + '...'
          }
          tcParts.push(`  ${tc.name}(${args})`)
        }
        content += '\n[Tool calls:\n' + tcParts.join('\n') + '\n]'
      }

      parts.push(content ? `[助手]: ${content}` : '[助手]: (无文本，仅工具调用)')
      continue
    }

    if (role === 'user') {
      if (content.length > CONTENT_MAX) {
        content = truncateContent(content, CONTENT_MAX)
      }
      parts.push(`[用户]: ${content}`)
      continue
    }

    if (content.length > CONTENT_MAX) {
      content = truncateContent(content, CONTENT_MAX)
    }
    parts.push(`[${role.toUpperCase()}]: ${content}`)
  }

  return parts.join('\n\n')
}

// =========================================================================
// 结构化摘要模板
// =========================================================================

/**
 * 构建结构化摘要 prompt
 *
 * 包含两个路径：
 * 1. 首次压缩：从头生成完整结构化摘要
 * 2. 迭代更新：保留前次摘要信息，合并新内容
 */
function buildSummaryPrompt(
  contentToSummarize: string,
  previousSummary: string | null,
  maxTokens: number,
): string {
  // 摘要生成器的系统指令（防止它回答对话中的问题）
  const summarizerPreamble = (
    '你是一个摘要生成 Agent，正在创建上下文检查点。'
    + '你的输出将作为参考材料注入，供另一个继续对话的助手使用。'
    + '不要回答对话中的任何问题或请求 — '
    + '仅输出结构化摘要。'
    + '不要包含任何前言、问候或前缀。'
  )

  // 结构化模板
  const templateSections = (
    `## 目标\n`
    + '[用户想要达成什么]\n\n'
    + '## 约束与偏好\n'
    + '[用户偏好、编码风格、约束条件、重要决策]\n\n'
    + '## 进展\n'
    + '### 已完成\n'
    + '[已完成的工作 — 包含具体文件路径、执行的命令、获得的结果]\n'
    + '### 进行中\n'
    + '[当前正在进行的工作]\n'
    + '### 受阻\n'
    + '[遇到的阻碍或问题]\n\n'
    + '## 关键决策\n'
    + '[重要的技术决策及其原因]\n\n'
    + '## 已解决问题\n'
    + '[用户提出且已回答的问题 — 包含答案，以便下一个助手不会重复回答]\n\n'
    + '## 待解决的用户请求\n'
    + '[用户提出但尚未回答或满足的问题或请求。如果没有，写"无。"]\n\n'
    + '## 相关文件\n'
    + '[已读取、修改或创建的文件 — 每条附简短说明]\n\n'
    + '## 剩余工作\n'
    + '[还需要做什么 — 以上下文形式描述，而非指令]\n\n'
    + '## 关键上下文\n'
    + '[任何具体的值、错误消息、配置细节或需要特别保留以免丢失的数据]\n\n'
    + '## 工具与模式\n'
    + '[使用了哪些工具、如何有效使用以及任何特定于工具的发现]\n\n'
    + `目标约 ${maxTokens} tokens。要具体 — 包含文件路径、命令输出、错误消息和具体值，而非模糊的描述。\n\n`
    + '仅输出摘要正文。不要包含任何前言或前缀。'
  )

  if (previousSummary) {
    // 迭代更新路径
    return `${summarizerPreamble}\n\n`
      + `你正在更新一份上下文压缩摘要。之前的压缩产生了以下摘要。此后又产生了新的对话轮次，需要将其合并。\n\n`
      + `之前的摘要：\n${previousSummary}\n\n`
      + `需要合并的新轮次：\n${contentToSummarize}\n\n`
      + `使用以下精确结构更新摘要。保留所有仍然相关的现有信息。添加新进展。将已完成的项目从"进行中"移到"已完成"。将已回答的问题移到"已解决问题"。仅在信息明显过时时才删除。\n\n`
      + templateSections
  } else {
    // 首次压缩路径
    return `${summarizerPreamble}\n\n`
      + `创建一份结构化交接摘要，供另一个在早期轮次被压缩后继续此对话的助手使用。下一个助手应该在不重新阅读原始轮次的情况下就能理解发生了什么。\n\n`
      + `需要摘要的轮次：\n${contentToSummarize}\n\n`
      + `使用以下精确结构：\n\n`
      + templateSections
  }
}

// =========================================================================
// 摘要生成（V2: 使用辅助 LLM）
// =========================================================================

/**
 * 使用辅助 LLM 生成结构化摘要
 *
 * - 使用结构化模板（Goal, Progress, Decisions, Resolved/Pending 等）
 * - 支持迭代更新（previousSummary 非空时）
 * - 失败时返回 null（调用方使用静态 fallback）
 *
 * @param turnsToSummarize 需要摘要的消息列表
 * @param maxTokens 摘要预算上限
 * @param previousSummary 前次摘要（迭代更新时使用）
 * @param summaryFailureCooldownUntil 上次摘要失败的时间戳（用于冷却检测）
 * @param auxClient 辅助 LLM 客户端
 * @returns 摘要文本，失败时返回 null
 */
async function generateSummaryAsync(
  turnsToSummarize: AgentMessage[],
  maxTokens: number,
  previousSummary: string | null,
  summaryFailureCooldownUntil: number,
  auxClient: AuxiliaryClient,
): Promise<{ summary: string | null; newPreviousSummary: string | null; newCooldownUntil: number }> {
  const now = Date.now()

  // 冷却检测：上次摘要生成失败后，600 秒内不再尝试
  if (now < summaryFailureCooldownUntil) {
    const remainingSecs = Math.ceil((summaryFailureCooldownUntil - now) / 1000)
    logger.debug(`[ContextCompressor] 摘要生成冷却中，还剩 ${remainingSecs} 秒`)
    return { summary: null, newPreviousSummary: previousSummary, newCooldownUntil: summaryFailureCooldownUntil }
  }

  // 序列化对话内容为纯文本
  const contentToSummarize = serializeForSummary(turnsToSummarize)

  // 构建结构化 prompt
  const prompt = buildSummaryPrompt(contentToSummarize, previousSummary, maxTokens)

  try {
    const result = await auxClient.generateSummary(prompt, maxTokens)

    if (!result || !result.trim()) {
      // 返回空内容，视为失败
      logger.warn('[ContextCompressor] 辅助模型返回空摘要')
      const newCooldown = Date.now() + SUMMARY_FAILURE_COOLDOWN_SECONDS * 1000
      return { summary: null, newPreviousSummary: previousSummary, newCooldownUntil: newCooldown }
    }

    const cleaned = result.trim()
    // 移除模型可能自行添加的 SUMMARY_PREFIX
    const normalized = cleaned.startsWith(SUMMARY_PREFIX)
      ? cleaned.slice(SUMMARY_PREFIX.length).trim()
      : cleaned

    logger.info(`[ContextCompressor] 辅助模型摘要生成成功 (${normalized.length} chars)`)

    return {
      summary: `${SUMMARY_PREFIX}\n${normalized}`,
      newPreviousSummary: normalized, // 保存原始摘要用于下次迭代更新
      newCooldownUntil: 0, // 清除冷却状态
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`[ContextCompressor] 摘要生成异常: ${message}`)
    const newCooldown = Date.now() + SUMMARY_FAILURE_COOLDOWN_SECONDS * 1000
    return { summary: null, newPreviousSummary: previousSummary, newCooldownUntil: newCooldown }
  }
}

// =========================================================================
// 工具配对修复
// =========================================================================

/**
 * 修复压缩后孤立的 tool_call / tool_result 配对
 */
function sanitizeToolPairs(messages: AgentMessage[]): AgentMessage[] {
  const survivingCallIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        if (tc.id) survivingCallIds.add(tc.id)
      }
    }
  }

  const resultCallIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.tool_call_id) {
      resultCallIds.add(msg.tool_call_id)
    }
  }

  // 1. 删除没有对应 tool_call 的孤立结果
  const orphanedResults = new Set<string>()
  for (const id of resultCallIds) {
    if (!survivingCallIds.has(id)) orphanedResults.add(id)
  }

  if (orphanedResults.size > 0) {
    messages = messages.filter(m =>
      !(m.role === 'tool' && m.tool_call_id && orphanedResults.has(m.tool_call_id))
    )
    logger.debug(`[ContextCompressor] 清理了 ${orphanedResults.size} 个孤立工具结果`)
  }

  // 2. 为没有结果的 tool_call 插入占位结果
  const missingResults = new Set<string>()
  for (const id of survivingCallIds) {
    if (!resultCallIds.has(id)) missingResults.add(id)
  }

  if (missingResults.size > 0) {
    const patched: AgentMessage[] = []
    for (const msg of messages) {
      patched.push(msg)
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          if (tc.id && missingResults.has(tc.id)) {
            patched.push({
              role: 'tool',
              content: '[来自之前对话的结果 — 请参阅上方上下文摘要]',
              tool_call_id: tc.id,
              name: tc.name,
              timestamp: Date.now(),
            })
          }
        }
      }
    }
    messages = patched
    logger.debug(`[ContextCompressor] 插入了 ${missingResults.size} 个占位工具结果`)
  }

  return messages
}

/**
 * 修复连续相同角色的消息
 *
 * 压缩后可能出现连续相同角色（如连续 tool、连续 user），
 * 在中间插入占位符维持交替，避免 Anthropic API 报错。
 */
function fixRoleAlternation(messages: AgentMessage[]): AgentMessage[] {
  const NO_CONTENT = '—'
  const result: AgentMessage[] = []

  for (const msg of messages) {
    const last = result[result.length - 1]
    if (last && last.role === msg.role) {
      // 相同角色 → 中间插入占位符
      const placeholderRole = msg.role === 'assistant' ? 'user' : 'assistant'
      result.push({
        role: placeholderRole as AgentMessage['role'],
        content: NO_CONTENT,
      })
    }
    result.push({ ...msg })
  }

  if (result.length !== messages.length) {
    logger.info(
      `[ContextCompressor] 角色交替修复: ${messages.length} -> ${result.length} 条`
    )
  }

  return result
}

// =========================================================================
// 默认配置
// =========================================================================

const DEFAULT_COMPRESSOR_CONFIG: Omit<ContextCompressorConfig, 'thresholdPercent'> = {
  protectFirstN: 3,
  protectLastN: 6,
}

// =========================================================================
// 主入口
// =========================================================================

/**
 * 压缩消息列表
 *
 * 算法流程：
 * 1. 估算总 token 数
 * 2. 如果低于阈值，原样返回
 * 3. 裁剪旧工具结果（廉价预过滤）
 * 4. 确定压缩边界
 * 5. 调用辅助 LLM 生成结构化摘要（V2）
 * 6. 如果摘要生成失败，使用静态 fallback
 * 7. 组装：[head] + [summary] + [tail]
 * 8. 修复工具配对
 *
 * @param messages 原始消息列表
 * - 压缩器配置（可选，使用默认配置，压缩阈值固定 0.70）
 * - 模型上下文窗口大小
 * - 辅助 LLM 客户端（可选，不传时使用主模型的简化调用）
 * - 前次压缩摘要（可选，用于迭代更新）
 * - 摘要失败冷却截止时间（毫秒）
 * @returns 压缩后的消息列表 + token 变化 + 新的前次摘要
 */
export async function compressMessages(
  messages: AgentMessage[],
  config: Partial<ContextCompressorConfig> & {
    contextLength?: number
    auxClient?: AuxiliaryClient
    previousSummary?: string | null
    summaryFailureCooldownUntil?: number
  } = {},
): Promise<{ compressed: AgentMessage[]; tokensBefore: number; tokensAfter: number; newPreviousSummary: string | null; newSummaryFailureCooldownUntil: number }> {
  const ctxLen = config.contextLength || DEFAULT_CONTEXT_LENGTH
  const threshold = Math.floor(ctxLen * 0.70)
  const cfg = { ...DEFAULT_COMPRESSOR_CONFIG, protectFirstN: config.protectFirstN ?? 3, protectLastN: config.protectLastN ?? 6 }
  const auxClient = config.auxClient
  const previousSummary = config.previousSummary ?? null
  let summaryCooldownUntil = config.summaryFailureCooldownUntil ?? 0

  const tokensBefore = estimateMessageTokens(messages)

  // 检查是否需要压缩
  if (tokensBefore < threshold) {
    return { compressed: messages, tokensBefore, tokensAfter: tokensBefore, newPreviousSummary: previousSummary, newSummaryFailureCooldownUntil: summaryCooldownUntil }
  }

  // 最小消息数检查
  const minForCompress = cfg.protectFirstN + 3 + 1
  if (messages.length <= minForCompress) {
    logger.warn(`[ContextCompressor] 消息数不足 (${messages.length})，跳过压缩`)
    return { compressed: messages, tokensBefore, tokensAfter: tokensBefore, newPreviousSummary: previousSummary, newSummaryFailureCooldownUntil: summaryCooldownUntil }
  }

  logger.info(
    `[ContextCompressor] 触发压缩: ${tokensBefore} tokens >= ${threshold} threshold `
    + `(${(tokensBefore / ctxLen * 100).toFixed(1)}% of ${ctxLen})`
  )

  // Phase 1: 裁剪旧工具结果
  let msgs = pruneOldToolResults(messages, cfg.protectLastN)

  // Phase 2: 确定边界
  const tailTokenBudget = Math.floor(threshold * SUMMARY_RATIO)
  const { start: compressStart, end: compressEnd } = findCompressBoundary(
    msgs, cfg.protectFirstN, tailTokenBudget,
  )

  if (compressStart >= compressEnd) {
    logger.warn('[ContextCompressor] 压缩边界无效，跳过压缩')
    return { compressed: messages, tokensBefore, tokensAfter: tokensBefore, newPreviousSummary: previousSummary, newSummaryFailureCooldownUntil: summaryCooldownUntil }
  }

  const turnsToSummarize = msgs.slice(compressStart, compressEnd)
  const tailMsgs = msgs.length - compressEnd

  logger.info(
    `[ContextCompressor] 压缩轮次 ${compressStart + 1}-${compressEnd} `
    + `(${turnsToSummarize.length} turns), 保护头部 ${compressStart} + 尾部 ${tailMsgs} 条消息`
  )

  // Phase 3: 生成摘要
  const maxSummaryTokens = Math.min(
    Math.floor(estimateMessageTokens(turnsToSummarize) * SUMMARY_RATIO),
    SUMMARY_TOKENS_CEILING,
  )
  const budgetTokens = Math.max(maxSummaryTokens, MIN_SUMMARY_TOKENS)

  let summary: string | null = null
  let newPreviousSummary = previousSummary

  // 尝试使用辅助 LLM 生成摘要
  if (auxClient) {
    const summaryResult = await generateSummaryAsync(
      turnsToSummarize,
      budgetTokens,
      previousSummary,
      summaryCooldownUntil,
      auxClient,
    )
    summary = summaryResult.summary
    newPreviousSummary = summaryResult.newPreviousSummary
    summaryCooldownUntil = summaryResult.newCooldownUntil
  } else {
    // 没有辅助客户端，使用静态 fallback
    logger.debug('[ContextCompressor] 无辅助客户端，使用静态 fallback 摘要')
    const nDropped = compressEnd - compressStart
    summary = `${SUMMARY_PREFIX}\n`
      + `摘要生成功能不可用。已移除 ${nDropped} 个对话轮次以释放上下文空间，`
      + `但未能生成摘要。被移除的轮次包含此会话中的早期工作。`
      + `请基于下方的最近消息以及任何文件或资源的当前状态继续。`
  }

  // Phase 4: 组装压缩后消息列表
  const compressed: AgentMessage[] = []

  // 添加头部（保护的消息）
  for (let i = 0; i < compressStart; i++) {
    compressed.push({ ...msgs[i] })
  }

  // 添加摘要（选择合适角色避免连续相同角色）
  if (summary) {
    const lastHeadRole = compressStart > 0 ? msgs[compressStart - 1]?.role : 'user'
    const firstTailRole = compressEnd < msgs.length ? msgs[compressEnd]?.role : 'user'

    let summaryRole: 'user' | 'assistant' = lastHeadRole === 'assistant' || lastHeadRole === 'tool' ? 'user' : 'assistant'
    if (summaryRole === firstTailRole && firstTailRole !== lastHeadRole) {
      summaryRole = summaryRole === 'user' ? 'assistant' : 'user'
    }

    compressed.push({
      role: summaryRole,
      content: summary,
      timestamp: Date.now(),
    })
  }

  // 添加尾部（最近的消息）
  for (let i = compressEnd; i < msgs.length; i++) {
    compressed.push({ ...msgs[i] })
  }

  // Phase 5: 修复工具配对
  const sanitized = sanitizeToolPairs(compressed)

  // Phase 6: 修复角色交替（插入占位符）
  const fixed = fixRoleAlternation(sanitized)

  const tokensAfter = estimateMessageTokens(fixed)
  const saved = tokensBefore - tokensAfter

  logger.info(
    `[ContextCompressor] 压缩完成: ${messages.length} -> ${fixed.length} 条消息, `
    + `~${saved} tokens 节省 (${tokensBefore} -> ${tokensAfter})`
  )

  return { compressed: fixed, tokensBefore, tokensAfter, newPreviousSummary, newSummaryFailureCooldownUntil: summaryCooldownUntil }
}
