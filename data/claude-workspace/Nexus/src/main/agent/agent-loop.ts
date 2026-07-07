/**
 * 智能体主运行循环
 *
 * 职责：管理 AIAgent 的 while 循环流程，包括上下文压缩检测、LLM 调用、
 * 工具执行、错误重试（context_too_long）、中断处理和结果组装。
 * 从 ai-agent.ts 拆分出来，减少主文件体积。
 */

import {
  AgentMessage,
  AgentState,
  AttachedFile,
  ContentBlock,
  IterationBudget,
  ToolCall,
} from '../../core/types/agent'
import { LLMClient, LLMResponse } from './llm-client'
import { compressMessages, estimateMessageTokens } from './context-compressor'
import { resolveContextLength } from './model-metadata'
import { AuxiliaryClient } from './auxiliary-client'
import { ToolRegistry } from './tool-registry'
import { executeToolCalls } from './agent-tool-execution'
import { AgentEventManager, createEvent } from './agent-events'
import { logger } from '../utils/logger'

// ==================== 多模态消息构建 ====================

/**
 * 构建用户消息内容（支持文本 + 图片混合）
 *
 * @param text 用户输入的文本
 * @param attachments 附件列表（图片等多模态内容）
 * @returns ContentBlock[] 或 string（无附件时保持简单字符串）
 */
function buildUserMessageContent(
  text: string,
  attachments: AttachedFile[] | undefined,
): string | ContentBlock[] {
  // 没有附件时，保持简单字符串
  if (!attachments || attachments.length === 0) {
    return text
  }

  const blocks: ContentBlock[] = []

  // 文本内容
  if (text) {
    blocks.push({ type: 'text', text })
  }

  // 图片附件
  for (const file of attachments) {
    if (file.type === 'image' && file.base64) {
      blocks.push({
        type: 'image',
        image: {
          data: file.base64,
          mimeType: file.mimeType || 'image/png',
        },
      })
    }
  }

  // 文本文件内容（type='text' 时直接注入）
  for (const file of attachments) {
    if (file.type === 'text' && file.content) {
      const content = file.content.length > 10000
        ? file.content.slice(0, 10000) + '\n...（内容已截断）'
        : file.content
      blocks.push({ type: 'text', text: `\n[${file.name}]\n${content}` })
    }
  }

  // 非图片附件：生成描述文本（LLM 无法直接读取，但可通过文件名/大小判断）
  const otherFiles: AttachedFile[] = attachments.filter(f => f.type === 'other')
  if (otherFiles.length > 0) {
    let desc = '\n[附件文件]\n'
    for (const file of otherFiles) {
      const sizeKB = (file.size / 1024).toFixed(1)
      desc += `- ${file.name} (${sizeKB} KB, ${file.mimeType || '未知类型'}, 路径: ${file.path})\n`
    }
    blocks.push({ type: 'text', text: desc })
  }

  // 如果只有附件没有文本，添加空文本块（某些 API 要求至少一个文本块）
  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: '' })
  }

  return blocks
}

// ==================== 智能体运行结果 ====================

/** 智能体运行结果 */
export interface AgentRunResult {
  /** 最终响应文本 */
  finalResponse: string | null
  /** 完整消息历史 */
  messages: AgentMessage[]
  /** API 调用次数 */
  apiCalls: number
  /** 是否完成（正常结束而非中断） */
  completed: boolean
  /** 是否部分完成（截断或中断） */
  partial: boolean
  /** 错误信息（如有） */
  error?: string
}

/**
 * 运行循环所需的依赖（避免直接耦合到 AIAgent 类）
 */
export interface RunLoopDeps {
  config: {
    model: string
    provider: string
    apiUrl: string
    apiKey: string
    maxIterations: number
    timeout: number
    maxRetries: number
    contextLength?: number
    summaryModel?: string
  }
  llmClient: LLMClient
  toolRegistry: ToolRegistry
  eventManager: AgentEventManager
  auxClient: AuxiliaryClient
  /** 可变状态对象，直接修改属性代替 getter/setter 回调 */
  agentState: MutableAgentState
  iterationBudget: IterationBudget
  interruptRequested: () => boolean
  /** 工具执行中止信号 */
  toolAbortSignal: AbortSignal
  getSystemPrompt: () => string
  callLLMStream: (systemPrompt: string, messages: AgentMessage[]) => Promise<LLMResponse>
  callLLMNonStream: (systemPrompt: string, messages: AgentMessage[]) => Promise<LLMResponse>
  /** 消息持久化回调 */
  saveMessage: (msg: AgentMessage, turnIndex: number) => void
  markTurnComplete: (turnIndex: number) => void
  /** 获取下一个 turn 索引 */
  getNextTurnIndex: () => number
  /** 记忆上下文检索回调 */
  getMemoryContext: (query: string) => string
  /** 计划模式查询回调 */
  getPlanMode?: () => boolean
}

/**
 * 智能体可变状态（供运行循环读写，避免在 RunLoopDeps 中使用 getter/setter 对）
 */
export interface MutableAgentState {
  /** 消息历史（可变数组） */
  messages: AgentMessage[]
  /** 上一次 LLM 调用的 prompt token 数 */
  lastPromptTokens: number
  /** 上一轮压缩摘要 */
  previousSummary: string | null
  /** 摘要失败冷却截止时间（ms 时间戳） */
  summaryFailureCooldownUntil: number
}

/**
 * 运行循环内部状态（在循环中维护）
 */
interface RunLoopState {
  apiCallCount: number
  finalResponse: string | null
  interrupted: boolean
  errorMessage: string | undefined
  compressRetryCount: number
}

/**
 * 执行主运行循环
 *
 * @param userMessage 用户输入消息
 * @param attachments 用户附件（图片等多模态内容）
 * @param conversationHistory 历史对话（可选）
 * @param useStream 是否使用流式响应
 * @param deps 运行依赖
 * @returns AgentRunResult 智能体运行结果
 */
export async function runAgentLoop(
  userMessage: string,
  attachments: AttachedFile[] | undefined,
  conversationHistory: AgentMessage[] | undefined,
  useStream: boolean,
  deps: RunLoopDeps,
): Promise<AgentRunResult> {
  // 重置运行状态
  const state: RunLoopState = {
    apiCallCount: 0,
    finalResponse: null,
    interrupted: false,
    errorMessage: undefined,
    compressRetryCount: 0,
  }

  // 初始化消息
  const initMessages = conversationHistory ? [...conversationHistory] : []

  // 每轮对话前检索相关记忆，注入到 user message
  const memoryContext = deps.getMemoryContext(userMessage)
  const effectiveMessage = memoryContext ? `${userMessage}\n\n${memoryContext}` : userMessage

  // 构建用户消息（支持多模态：文本 + 图片）
  const userContent = buildUserMessageContent(effectiveMessage, attachments)

  const userMsg: AgentMessage = { role: 'user', content: userContent, timestamp: Date.now() }
  initMessages.push(userMsg)
  deps.agentState.messages = initMessages

  // 持久化用户消息
  const turnIndex = deps.getNextTurnIndex()
  deps.saveMessage(userMsg, turnIndex)

  // 当前 turn 索引
  let currentTurn = turnIndex

  logger.info(
    `[AIAgent] 开始对话: model=${deps.config.model} ` +
    `provider=${deps.config.provider} history=${deps.agentState.messages.length - 1} ` +
    `msg="${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}"`
  )

  const systemPrompt = deps.getSystemPrompt()

  // DEBUG: 打印发送给模型的完整提示词到日志
  logger.debug(`[AIAgent] === 系统提示词 ===\n${systemPrompt}\n=== 系统提示词结束 ===`)
  logger.debug(`[AIAgent] === 完整消息列表 ===\n${JSON.stringify(deps.agentState.messages, null, 2)}\n=== 完整消息列表结束 ===`)

  deps.eventManager.setState('running')

  // 主循环
  while (deps.iterationBudget.remaining > 0 && !deps.interruptRequested()) {
    if (!deps.iterationBudget.hasRemaining) {
      logger.warn(`[AIAgent] 迭代预算耗尽 (${deps.iterationBudget.consumed}/${deps.iterationBudget.max})`)
      break
    }

    deps.iterationBudget.consume()
    state.apiCallCount++

    logger.info(`[AIAgent] API 调用 #${state.apiCallCount}/${deps.config.maxIterations}`)

    // 计算上下文使用百分比
    const contextLength = resolveContextLength(deps.config.model, deps.config.contextLength)
    const tokenCount = deps.agentState.lastPromptTokens || estimateMessageTokens(deps.agentState.messages)
    const contextUsagePercent = contextLength > 0 ? (tokenCount / contextLength) * 100 : 0

    deps.eventManager.emit(createEvent('state_change', {
      state: 'running',
      apiCall: state.apiCallCount,
      budgetRemaining: deps.iterationBudget.remaining,
      contextUsagePercent: Math.round(contextUsagePercent * 10) / 10, // 保留一位小数
    }))

    // 上下文压缩检测
    const compressed = await checkAndCompress(deps)
    if (compressed) {
      deps.agentState.previousSummary = compressed.newSummary
    }

    // 通知前端新一轮 LLM 调用开始，清空流式文字并显示分析中提示
    deps.eventManager.emit(createEvent('new_iteration', {}))

    try {
      // 调用 LLM
      const response = useStream
        ? await deps.callLLMStream(systemPrompt, deps.agentState.messages)
        : await deps.callLLMNonStream(systemPrompt, deps.agentState.messages)

      // invoke 模式不会 incremental 输出，需要一次性 emit 完整内容以隐藏"正在分析..."
      if (!useStream && response.content) {
        deps.eventManager.emit(createEvent('message_delta', { text: response.content }))
      }

      if (response.usage) {
        deps.agentState.lastPromptTokens = response.usage.promptTokens
      }

      if (response.toolCalls.length > 0) {
        // 记录 assistant 的最终响应文本（用于循环退出时返回）
        if (response.content) {
          state.finalResponse = response.content
        }

        // 追加 assistant 响应
        const assistantMsg: AgentMessage = {
          role: 'assistant',
          content: response.content || null,
          tool_calls: response.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
          timestamp: Date.now(),
        }
        deps.agentState.messages.push(assistantMsg)

        // 持久化 assistant 消息
        deps.saveMessage(assistantMsg, currentTurn)

        // 记录工具执行前的消息长度，用于追踪新增的 tool 消息
        const msgCountBeforeTools = deps.agentState.messages.length

        // 执行工具
        await executeToolCalls(response.toolCalls, {
          toolRegistry: deps.toolRegistry,
          messages: deps.agentState.messages,
          interruptRequested: deps.interruptRequested,
          toolAbortSignal: deps.toolAbortSignal,
          emit: (event) => deps.eventManager.emit(event),
          planMode: deps.getPlanMode?.() ?? false,
        })

        // 持久化工具执行产生的 tool 消息
        const msgs = deps.agentState.messages
        for (let i = msgCountBeforeTools; i < msgs.length; i++) {
          deps.saveMessage(msgs[i], currentTurn)
        }

        if (deps.interruptRequested()) {
          state.interrupted = true
          break
        }
      } else {
        // 无工具调用，追加 assistant 消息到历史
        const assistantMsg: AgentMessage = {
          role: 'assistant',
          content: response.content,
          timestamp: Date.now(),
        }
        deps.agentState.messages.push(assistantMsg)

        // 持久化 assistant 消息
        deps.saveMessage(assistantMsg, currentTurn)

        // 标记该 turn 为完整
        deps.markTurnComplete(currentTurn)

        // 当前 turn 完成，递增
        currentTurn++

        state.finalResponse = response.content
        break
      }
    } catch (error) {
      const catchInterrupted = deps.interruptRequested()
      logger.info(`[AgentLoop] catch 块, interruptRequested=${catchInterrupted}, error=${(error as Error).message?.slice(0, 80)}`)
      if (catchInterrupted) {
        state.interrupted = true
        break
      }

      const llmError = deps.llmClient.classifyError(error)
      logger.error(`[AIAgent] LLM 调用失败: ${llmError.message} (${llmError.type})`)

      const handled = await handleError(state, deps, llmError)
      if (handled === 'break') {
        break
      } else if (handled === 'continue') {
        continue
      }
      // handled === 'abort' 时 errorMessage 已设置，break
      break
    }
  }

  return buildRunResult(state, deps)
}

/**
 * 执行压缩并应用结果
 *
 * @param source - 压缩触发来源（用于日志）
 * @returns 如果压缩成功减少 token，返回 true
 */
async function applyCompression(
  deps: RunLoopDeps,
  source: string,
): Promise<boolean> {
  const contextLength = resolveContextLength(deps.config.model, deps.config.contextLength)
  const compressResult = await compressMessages(deps.agentState.messages, {
    contextLength,
    auxClient: deps.auxClient,
    previousSummary: deps.agentState.previousSummary,
    summaryFailureCooldownUntil: deps.agentState.summaryFailureCooldownUntil,
  })
  if (compressResult.tokensAfter < compressResult.tokensBefore) {
    deps.agentState.messages = compressResult.compressed
    deps.agentState.lastPromptTokens = compressResult.tokensAfter
    deps.agentState.previousSummary = compressResult.newPreviousSummary
    deps.agentState.summaryFailureCooldownUntil = compressResult.newSummaryFailureCooldownUntil
    logger.info(
      `[AIAgent] ${source}: ${compressResult.tokensBefore} -> ${compressResult.tokensAfter} tokens`
    )
    return true
  }
  return false
}

/**
 * 检查并执行上下文压缩
 *
 * @returns 如果执行了压缩且成功减少 token，返回压缩结果；否则返回 null
 */
async function checkAndCompress(
  deps: RunLoopDeps,
): Promise<{ newSummary: string | null } | null> {
  const contextLength = resolveContextLength(deps.config.model, deps.config.contextLength)
  const tokenCount = deps.agentState.lastPromptTokens || estimateMessageTokens(deps.agentState.messages)
  if (tokenCount >= contextLength * 0.70) {
    if (await applyCompression(deps, '上下文压缩')) {
      return { newSummary: deps.agentState.previousSummary }
    }
  }
  return null
}

/**
 * 处理 LLM 调用错误
 *
 * @returns 'break' = 终止循环, 'continue' = 继续循环, 'abort' = 设置错误后 break
 */
async function handleError(
  state: RunLoopState,
  deps: RunLoopDeps,
  llmError: { type: string; message: string },
): Promise<'break' | 'continue' | 'abort'> {
  // context_too_long: 尝试压缩上下文后重试（最多 2 次）
  if (llmError.type === 'context_too_long') {
    if (state.compressRetryCount >= 2) {
      logger.warn('[AIAgent] context_too_long 压缩重试已达上限 (2次)，放弃重试')
      state.errorMessage = llmError.message
      return 'break'
    }
    state.compressRetryCount++

    if (await applyCompression(deps, `context_too_long 触发紧急压缩 (${state.compressRetryCount}/2)`)) {
      return 'continue'
    } else {
      logger.warn('[AIAgent] context_too_long 但压缩未能减少 token，放弃重试')
      state.errorMessage = llmError.message
      return 'break'
    }
  }

  // 不可重试的错误
  if (llmError.type === 'auth_error') {
    state.errorMessage = llmError.message
    return 'break'
  }

  // rate_limit / server_error / network_error 已在客户端重试
  state.errorMessage = llmError.message
  return 'break'
}

/**
 * 组装最终运行结果
 */
function buildRunResult(
  state: RunLoopState,
  deps: RunLoopDeps,
): AgentRunResult {
  if (deps.interruptRequested()) {
    state.interrupted = true
    state.finalResponse = state.finalResponse || '(已中断)'
  } else if (deps.iterationBudget.remaining <= 0) {
    state.finalResponse = state.finalResponse || '(迭代次数已耗尽)'
  }

  deps.eventManager.setState(
    state.interrupted ? 'stopped' : (state.errorMessage ? 'error' : 'completed')
  )

  return {
    finalResponse: state.finalResponse,
    messages: [...deps.agentState.messages],
    apiCalls: state.apiCallCount,
    completed: !state.interrupted && !state.errorMessage,
    partial: state.interrupted || deps.iterationBudget.remaining <= 0,
    error: state.errorMessage,
  }
}
