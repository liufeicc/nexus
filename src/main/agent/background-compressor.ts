/**
 * 后台异步对话历史压缩 Agent
 *
 * 作用：独立于主 Agent 循环运行，使用副模型对全部对话历史进行智能压缩。
 *
 * 触发机制：主 Agent 检测到上下文超过 70% 窗口时，自动请求后台压缩。
 * 后台压缩器轮询检查请求，从 DB 读取全部消息 → 调用 LLM 压缩 → 清空表 + 插入压缩数据 → 通知主 Agent。
 *
 * 设计理念：
 * - 不使用 context-compressor.ts 的算法方案
 * - 完全由 LLM 自主判断哪些内容保留、哪些丢弃
 * - 压缩范围是整个 agent_messages 表（所有 topic）
 */

import { AgentMessage, ContentBlock } from '../../core/types/agent'
import { AuxiliaryClient } from './auxiliary-client'
import { resolveContextLength } from './model-metadata'
import { DatabaseService } from '../services/database.service'
import { logger } from '../utils/logger'

/**
 * 后台压缩器配置
 */
export interface BackgroundCompressorConfig {
  /** 轮询间隔（毫秒），默认 5000 */
  pollIntervalMs?: number
  /** 主模型名称，用于解析上下文窗口 */
  mainModel: string
  /** 上下文窗口大小（不传时通过 resolveContextLength 自动解析） */
  contextLength?: number
  /** 副模型完整配置（可选，不传时复用主模型） */
  summaryModelConfig?: import('../../core/types/agent').AgentConfig
  /** 压缩目标字符数，默认 8000 */
  targetMaxChars?: number
  /** Nexus 会话 ID（用于按 session 隔离读写） */
  nexusSessionId?: string
}

/**
 * 压缩后的消息结构（LLM 返回格式）
 */
interface CompressedMessage {
  role: string
  content: string | null
  tool_calls?: Array<{ id: string; name: string; arguments: string }>
  tool_call_id?: string
  tool_name?: string
}

/**
 * 后台异步对话历史压缩 Agent
 */
export class BackgroundCompressor {
  // ── 配置 ──
  private mainModel: string
  private contextLength: number
  private summaryModelConfig?: import('../../core/types/agent').AgentConfig
  private pollIntervalMs: number
  private targetMaxChars: number
  private nexusSessionId: string

  // ── 状态 ──
  private running: boolean = false
  private compressing: boolean = false
  private timer: ReturnType<typeof setInterval> | null = null

  // ── 待处理请求 ──
  private pendingTopicId: string | null = null

  // ── 辅助模型客户端（延迟创建） ──
  private auxClient: AuxiliaryClient | null = null

  // ── 回调 ──
  private onReloadRequested: (() => void) | null = null
  private onActivityChanged: ((data: { type: string; status: string; message: string; progress?: number }) => void) | null = null

  constructor(config: BackgroundCompressorConfig) {
    this.mainModel = config.mainModel
    this.contextLength = config.contextLength ?? 0
    this.summaryModelConfig = config.summaryModelConfig
    this.pollIntervalMs = config.pollIntervalMs ?? 5000
    this.targetMaxChars = config.targetMaxChars ?? 8000
    this.nexusSessionId = config.nexusSessionId ?? '__default__'
  }

  // ==================== 公开接口 ====================

  /**
   * 请求压缩
   * 由主 Agent 调用，标记需要后台压缩
   */
  requestCompression(topicId: string, nexusSessionId?: string): void {
    if (nexusSessionId) {
      this.nexusSessionId = nexusSessionId
    }
    logger.info(`[BackgroundCompressor] requestCompression 被调用: topicId=${topicId}, sessionId=${this.nexusSessionId}, compressing=${this.compressing}, pendingTopicId=${this.pendingTopicId}`)
    if (this.compressing) {
      logger.debug('[BackgroundCompressor] 压缩进行中，跳过重复请求')
      return
    }
    this.pendingTopicId = topicId
    // 立即发出活动状态，让 UI 无需等待轮询就能显示"压缩中..."
    this._emitActivity('started', '正压缩对话历史...')
    logger.info(`[BackgroundCompressor] 已请求压缩 topic: ${topicId}`)
  }

  /**
   * 注册回调：压缩完成后触发，通知主 Agent 下次 run() 时重新加载历史
   */
  setReloadCallback(callback: () => void): void {
    this.onReloadRequested = callback
  }

  /**
   * 注册回调：后台活动状态变化时触发
   */
  setActivityCallback(callback: (data: { type: string; status: string; message: string; progress?: number }) => void): void {
    this.onActivityChanged = callback
  }

  /**
   * 发送活动状态更新
   */
  private _emitActivity(status: string, message: string, progress?: number): void {
    if (this.onActivityChanged) {
      this.onActivityChanged({ type: 'compression', status, message, progress })
    }
  }

  /**
   * 启动后台轮询循环
   */
  start(): void {
    if (this.running) return
    this.running = true
    this.timer = setInterval(() => this._monitorTick(), this.pollIntervalMs)
    logger.info(`[BackgroundCompressor] 已启动（轮询间隔: ${this.pollIntervalMs}ms）`)
  }

  /**
   * 停止后台轮询循环
   */
  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    logger.info('[BackgroundCompressor] 已停止')
  }

  /**
   * 是否正在压缩中
   */
  get isCompressing(): boolean {
    return this.compressing
  }

  // ==================== 内部方法 ====================

  /**
   * 轮询 tick：检查是否有待处理的压缩请求
   */
  private async _monitorTick(): Promise<void> {
    if (!this.pendingTopicId || this.compressing) {
      return
    }

    const topicId = this.pendingTopicId
    this.pendingTopicId = null
    await this._runCompression(topicId)
  }

  /**
   * 执行压缩流程（带重试机制，最多尝试 3 次）
   *
   * 1. 从 DB 读取全部 agent_messages
   * 2. 估算字符数，低于阈值则跳过
   * 3. 获取/创建辅助模型客户端
   * 4. 构建压缩 prompt + 调用 LLM
   * 5. 解析返回的 JSON
   * 6. 清空 agent_messages 表，插入压缩后的数据
   * 7. 通知主 Agent 设置 needsReload 标记
   */
  private async _runCompression(topicId: string): Promise<void> {
    this.compressing = true

    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this._runCompressionOnce(topicId, attempt, maxAttempts)
      if (result === 'success') {
        return
      }
      if (result === 'skip') {
        return
      }
      // result === 'retry' → 继续下一次循环
      if (attempt < maxAttempts) {
        logger.info(`[BackgroundCompressor] 准备重试压缩 (${attempt + 1}/${maxAttempts})`)
        this._emitActivity('retrying', `压缩失败，正在重试 (${attempt + 1}/${maxAttempts})`)
      }
    }

    // 所有重试均失败
    logger.error('[BackgroundCompressor] 压缩失败，已重试所有次数')
    this._emitActivity('error', '压缩失败，已重试多次')
    this.compressing = false
  }

  /**
   * 执行单次压缩尝试
   *
   * @returns 'success' 压缩成功，'skip' 无需压缩，'retry' 失败需重试
   */
  private async _runCompressionOnce(topicId: string, attempt: number, maxAttempts: number): Promise<'success' | 'skip' | 'retry'> {
    try {
      const dao = this._getDAO()
      if (!dao) {
        logger.warn('[BackgroundCompressor] 无法获取 AgentMessageDAO，跳过压缩')
        this._emitActivity('error', '无法获取数据库连接')
        return 'skip'
      }

      // Step 1: 从 DB 按 session 读取消息
      const messages = dao.loadAllBySessionId(this.nexusSessionId)
      if (messages.length === 0) {
        logger.debug('[BackgroundCompressor] 无消息，跳过压缩')
        this._emitActivity('completed', '无对话历史，无需压缩')
        return 'skip'
      }

      // Step 2: 估算总字符数，低于阈值则跳过
      const totalChars = this._estimateTotalChars(messages)
      if (totalChars <= this.targetMaxChars) {
        logger.info(
          `[BackgroundCompressor] 总字符数 ${totalChars} <= 目标 ${this.targetMaxChars}，跳过压缩`
        )
        this._emitActivity('completed', '对话历史较短，无需压缩')
        return 'skip'
      }

      logger.info(
        `[BackgroundCompressor] 开始压缩 (attempt ${attempt}/${maxAttempts}): ${totalChars} 字符, ` +
        `${messages.length} 条消息 (session: ${this.nexusSessionId})`
      )

      // Step 3: 获取辅助模型客户端
      const aux = this._getOrCreateAuxClient()

      // Step 4: 构建 prompt + 调用 LLM 压缩
      const prompt = this._buildCompressPrompt(messages)
      const result = await aux.call({
        messages: [
          { role: 'system', content: this._buildSystemPrompt() },
          { role: 'user', content: prompt },
        ],
      })

      if (!result) {
        logger.warn(`[BackgroundCompressor] LLM 返回空结果 (attempt ${attempt}/${maxAttempts})，压缩失败`)
        return 'retry'
      }

      // Step 5: 解析返回的 JSON
      const compressed = this._parseCompressedMessages(result)
      if (!compressed || compressed.length === 0) {
        logger.warn(`[BackgroundCompressor] 无法解析 LLM 返回 (attempt ${attempt}/${maxAttempts})`)
        return 'retry'
      }

      // Step 5.5: 规范化消息（角色交替修复）
      const merged = this._normalizeMessages(compressed)

      logger.info(
        `[BackgroundCompressor] 压缩完成: ${messages.length} -> ${merged.length} 条消息, ` +
        `${totalChars} -> ${this._estimateTotalChars(merged)} 字符`
      )

      // Step 6: 按 session 清空 + 插入压缩后的数据
      dao.replaceAllMessages(this.nexusSessionId, merged)

      logger.info('[BackgroundCompressor] DB 写入完成')

      // Step 7: 通知主 Agent 重新加载
      this._notifyReload()
      this._emitActivity('completed', '对话历史压缩完成')
      return 'success'

    } catch (err) {
      logger.error(`[BackgroundCompressor] 压缩异常 (attempt ${attempt}/${maxAttempts}):`, err)
      return 'retry'
    }
  }

  /**
   * 解析上下文窗口大小
   */
  private _resolveContextLength(): number {
    if (this.contextLength > 0) {
      return this.contextLength
    }
    return resolveContextLength(this.mainModel)
  }

  /**
   * 获取或创建辅助模型客户端
   */
  private _getOrCreateAuxClient(): AuxiliaryClient {
    if (this.auxClient) {
      return this.auxClient
    }

    // 从数据库读取主配置
    const db = DatabaseService.getInstance()
    if (!db) throw new Error('DatabaseService 不可用')
    const configDAO = db.getConfigDAO()
    const agentConfig = configDAO.get('agentConfig') as {
      provider: string
      apiUrl: string
      apiKey: string
      model: string
    } | null
    if (!agentConfig || !agentConfig.apiUrl || !agentConfig.apiKey) {
      throw new Error('Agent 配置未找到')
    }

    const parentConfig = {
      provider: agentConfig.provider as 'openai' | 'anthropic',
      apiUrl: agentConfig.apiUrl,
      apiKey: agentConfig.apiKey,
      model: agentConfig.model,
      maxIterations: 1,
      timeout: 600000,  // 压缩任务给 10 分钟超时
      maxRetries: 2,
    }

    this.auxClient = new AuxiliaryClient({
      parentConfig,
      standaloneConfig: this.summaryModelConfig,
      timeout: 600000,  // 压缩任务给 10 分钟超时
    })

    return this.auxClient
  }

  /**
   * 获取 DAO 实例
   */
  private _getDAO() {
    try {
      return DatabaseService.getInstance()?.getAgentMessageDAO() ?? null
    } catch {
      return null
    }
  }

  /**
   * 通知主 Agent 重新加载历史
   */
  private _notifyReload(): void {
    if (this.onReloadRequested) {
      this.onReloadRequested()
      logger.info('[BackgroundCompressor] 已通知主 Agent 重新加载历史')
    }
  }

  // ==================== 后处理 ====================

  /**
   * 角色交替占位符（用于插入连续同类消息之间，防止 LLM API 报错）
   */
  private static readonly NO_CONTENT_MESSAGE = '—'

  /**
   * 单条消息内容最大字符数（构建压缩 prompt 时截断用）
   */
  private static readonly CONTENT_MAX = 8000
  private static readonly CONTENT_HEAD = 5000
  private static readonly CONTENT_TAIL = 3000

  /**
   * 规范化消息：确保角色交替正确
   *
   * 当 LLM 压缩输出违反角色交替（如连续 user/assistant/tool）时，
   * 在中间插入占位符修复，避免 API 报错。
   */
  private _normalizeMessages(messages: AgentMessage[]): AgentMessage[] {
    const result: AgentMessage[] = []

    for (const msg of messages) {
      const last = result[result.length - 1]

      // 相同角色 → 插入占位符维持交替
      if (last && last.role === msg.role) {
        // assistant → assistant：中间插入 user 占位
        // tool → tool / user → user：中间插入 assistant 占位
        const placeholderRole = msg.role === 'assistant' ? 'user' : 'assistant'
        result.push({
          role: placeholderRole as AgentMessage['role'],
          content: BackgroundCompressor.NO_CONTENT_MESSAGE,
        })
      }

      result.push({ ...msg })
    }

    if (result.length !== messages.length) {
      logger.info(
        `[BackgroundCompressor] 角色交替修复: ${messages.length} -> ${result.length} 条`
      )
    }

    return result
  }

  // ==================== Prompt 构建 ====================

  /**
   * 截断过长文本：保留头部和尾部，中间用省略号替代
   */
  private truncateContent(content: string): string {
    if (content.length <= BackgroundCompressor.CONTENT_MAX) return content
    const head = content.slice(0, BackgroundCompressor.CONTENT_HEAD)
    const tail = content.slice(-BackgroundCompressor.CONTENT_TAIL)
    return `${head}\n\n...[内容已截断，原文 ${content.length} 字符]...\n\n${tail}`
  }

  /**
   * 序列化消息内容为纯文本（用于构建压缩 prompt）
   *
   * 处理 ContentBlock 数组：
   * - text 块：截断过长内容
   * - image 块：替换为占位描述（不包含 base64 数据）
   */
  private serializeContent(content: string | ContentBlock[]): string {
    if (typeof content === 'string') {
      return this.truncateContent(content)
    }
    if (Array.isArray(content)) {
      const parts: string[] = []
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          parts.push(this.truncateContent(block.text))
        } else if (block.type === 'image' && block.image) {
          parts.push(`[图片: ${block.image.mimeType}, 已省略]`)
        }
      }
      return parts.join('\n')
    }
    return JSON.stringify(content)
  }

  /**
   * 构建系统提示
   */
  private _buildSystemPrompt(): string {
    return (
      '# Role\n' +
      'You are a conversation history compression agent. Your job is to compress verbose dialogue into a concise version.\n\n' +
      `# Goal\nCompress the total character count to within ${this.targetMaxChars}, while preserving the integrity and continuity of the conversation.\n\n` +
      '# Compression Principles\n' +
      '- Keep: user goals, key decisions, file paths, error messages, current progress\n' +
      '- Discard: repeated questions, redundant tool calls, outdated intermediate steps, resolved errors\n' +
      '- If still over limit after summarizing, discard older history until the target is met\n\n' +
      '# Merging Rules\n' +
      '- Consecutive user messages are merged into one\n' +
      '- Consecutive assistant replies are merged into one, removing redundant filler text\n' +
      '- Tool results with the same tool_call_id are merged into one\n' +
      '- No two consecutive messages with the same role in the output\n\n' +
      '# Output Format\n' +
      '- The output MUST be a JSON array (starting with [ and ending with ]), with NO extra text or markdown code fences\n' +
      '- Each message object MUST have a "role" field (one of: "user", "assistant", "tool") and a "content" field\n' +
      '- "role" is REQUIRED — do NOT output null, undefined, or omit it\n' +
      '- Assistant tool calls must include a tool_calls array, each item with id, name, arguments\n' +
      '- Tool results (role=tool) must include tool_call_id and tool_name\n\n' +
      '# Example Output (JSON array format)\n' +
      '[\n' +
      '{"role":"assistant","content":"Reading the file","tool_calls":[{"id":"call_1","name":"read_file","arguments":"{\\"path\\":\\"test.txt\\"}"}]},\n' +
      '{"role":"tool","content":"File contents...","tool_call_id":"call_1","tool_name":"read_file"},\n' +
      '{"role":"user","content":"Please modify line 3 of this file"}\n' +
      ']'
    )
  }

  /**
   * 构建压缩 prompt
   */
  private _buildCompressPrompt(messages: AgentMessage[]): string {
    // 序列化对话历史为 JSON-like 格式，保留 tool 结构
    const historyLines: string[] = []

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const role = msg.role

      // 构建时间戳字符串
      const timeStr = msg.timestamp
        ? new Date(msg.timestamp).toISOString().replace('T', ' ').substring(0, 19)
        : 'unknown'

      if (role === 'assistant' && msg.tool_calls?.length) {
        // assistant 有 tool_calls：输出 JSON 对象
        const toolCallsJson = JSON.stringify(msg.tool_calls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })))
        const textContent = this.serializeContent(msg.content as string | ContentBlock[])
        historyLines.push(
          `{"time":"${timeStr}","role":"assistant","content":${textContent ? JSON.stringify(textContent) : '""'},"tool_calls":${toolCallsJson}}`
        )
      } else if (role === 'tool') {
        // tool 结果：输出 JSON 对象
        const textContent = this.serializeContent(msg.content as string | ContentBlock[])
        historyLines.push(
          `{"time":"${timeStr}","role":"tool","content":${JSON.stringify(textContent || '(no output)')},"tool_call_id":"${msg.tool_call_id || ''}","tool_name":"${msg.name || 'unknown'}"}`
        )
      } else {
        // user / system 普通文本
        const textContent = this.serializeContent(msg.content as string | ContentBlock[])
        historyLines.push(`{"time":"${timeStr}","role":"${role}","content":${JSON.stringify(textContent)}}`)
      }
    }

    return `以下是需要压缩的对话历史（每条为一行 JSON 对象，time=时间）：\n\n${historyLines.join('\n\n')}`
  }

  /**
   * 解析 LLM 返回的压缩后消息
   */
  private _parseCompressedMessages(text: string): AgentMessage[] | null {
    let jsonText = text.trim()

    // 策略 1: 如果包含 markdown 代码块，提取内容
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim()
    }

    let parsed: CompressedMessage[] | null = null

    // 策略 2: 尝试直接解析
    try {
      parsed = JSON.parse(jsonText) as CompressedMessage[]
    } catch {
      // 策略 3: 在文本中搜索 JSON 数组（可能被额外文本包裹）
      const arrayMatch = jsonText.match(/\[[\s\S]*\]/)
      if (arrayMatch) {
        try {
          parsed = JSON.parse(arrayMatch[0]) as CompressedMessage[]
        } catch { /* 继续尝试下一策略 */ }
      }
    }

    // 策略 4: 逐行尝试（LLM 可能逐行输出）
    if (!parsed) {
      const lines = jsonText.split('\n').filter(l => l.trim())
      let buffer = ''
      for (const line of lines) {
        buffer += line
        try {
          const candidate = JSON.parse(buffer)
          if (Array.isArray(candidate)) {
            parsed = candidate
            break
          }
        } catch {
          continue
        }
      }
    }

    if (!parsed || !Array.isArray(parsed)) {
      logger.warn('[BackgroundCompressor] LLM 原始输出 (前500字符):', text.substring(0, 500))
      return null
    }

    // 转换为 AgentMessage 格式，过滤掉 role 无效的条目
    return parsed
      .filter((msg) => msg.role && ['user', 'assistant', 'tool', 'system'].includes(msg.role))
      .map((msg, index) => {
      const agentMsg: AgentMessage = {
        role: msg.role as 'user' | 'assistant' | 'tool' | 'system',
        content: msg.content ?? '',
        timestamp: Date.now(),
      }

      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        agentMsg.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id || `call_${index}`,
          name: tc.name || 'unknown',
          arguments: tc.arguments || '{}',
        }))
      }
      if (msg.tool_call_id) {
        agentMsg.tool_call_id = msg.tool_call_id
      }
      if (msg.tool_name) {
        agentMsg.name = msg.tool_name
      }

      return agentMsg
    })
  }

  /**
   * 估算消息总字符数
   */
  private _estimateTotalChars(messages: AgentMessage[]): number {
    let total = 0
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        total += msg.content.length
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            total += block.text?.length ?? 0
          }
        }
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          total += (tc.arguments?.length ?? 0) + (tc.name?.length ?? 0)
        }
      }
    }
    return total
  }
}
