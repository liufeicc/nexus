/**
 * 核心智能体类
 *
 * 作用：管理对话流程、工具执行和响应处理。
 * 这是整个 Nexus 智能体系统的"大脑"。
 *
 * 职责：实例配置、组件管理、运行编排。
 * 主循环逻辑已拆分为 agent-loop.ts，LLM 调用已拆分为 agent-llm-bridge.ts。
 */

import crypto from 'crypto'
import {
  AgentConfig,
  AgentMessage,
  AgentState,
  AgentEvent,
  IterationBudget,
  McpServerConfig,
  AttachedFile,
} from '../../core/types/agent'
import { MemoryManagerConfig } from '../../core/types/memory'
import { LLMClient } from './llm-client'
import { ToolRegistry } from './tool-registry'
import { BuildSystemPromptOptions } from './prompt-builder/index'
import { McpClient } from './mcp/mcp-client'
import { AuxiliaryClient } from './auxiliary-client'
import { AgentEventManager, createEvent } from './agent-events'
import { runAgentLoop, RunLoopDeps, MutableAgentState, AgentRunResult } from './agent-loop'
import { createLlmBridge } from './agent-llm-bridge'
import { AgentSessionState } from './session-state'
import { bindFileToolSession, bindSearchState } from './tools/file-tools'
import { bindTerminalSession } from './tools/terminal-tool'
import { MemoryManager } from './memory/memory-manager'
import { DatabaseService } from '../services/database.service'
import { AgentMessageDAO } from '../db/agent-message.dao'
import { logger } from '../utils/logger'
import { SkillManager } from './skills/skill-manager'
import { SkillPromptInjector } from './skills/skill-prompt-injector'
import { createSkillTools } from './skills/skills-tool'
import { createSkillManageTool } from './skills/skill-manage-tool'
import { TaskManager } from './tasks/task-manager'
import { createTaskTools } from './tasks/tasks-tool'
import { createTaskManageTool } from './tasks/task-manage-tool'
import { BackgroundCompressor } from './background-compressor'
import { resolveContextLength } from './model-metadata'
import { estimateMessageTokens } from './context-compressor'

/**
 * 从数据库读取记忆配置
 */
function loadMemoryManagerConfig(): MemoryManagerConfig {
  try {
    const db = DatabaseService.getInstance()
    if (!db) {
      return { memoryMaxChars: 2200, userMaxChars: 1375 }
    }
    const configDAO = db.getConfigDAO()
    const memConfig = configDAO.get('memoryConfig') as {
      memoryMaxChars?: number
      userMaxChars?: number
    } | null

    return {
      memoryMaxChars: memConfig?.memoryMaxChars ?? 2200,
      userMaxChars: memConfig?.userMaxChars ?? 1375,
    }
  } catch {
    return { memoryMaxChars: 2200, userMaxChars: 1375 }
  }
}

// ==================== 配置选项 ====================

export interface AIAgentOptions extends AgentConfig {
  /** 自定义系统提示构建选项（model 除外） */
  promptBuilderOptions?: Omit<BuildSystemPromptOptions, 'model'>
  /** MCP Server 配置列表 */
  mcpServers?: McpServerConfig[]
  /** 辅助模型完整配置 */
  summaryModelConfig?: AgentConfig
  /** Nexus 会话 ID（用于记忆系统隔离） */
  nexusSessionId?: string
}

/**
 * AI 智能体
 *
 * 管理完整的对话循环。
 */
export class AIAgent {
  // ── 配置 ──
  private config: AgentConfig
  private promptBuilderOptions?: Omit<BuildSystemPromptOptions, 'model'>
  private mcpServers?: McpServerConfig[]
  private summaryModelConfig?: AgentConfig

  // ── 核心组件 ──
  private llmClient: LLMClient
  private toolRegistry: ToolRegistry
  private mcpClient: McpClient | null = null
  private auxClient: AuxiliaryClient | null = null

  // ── 状态 ──
  private messages: AgentMessage[] = []
  private iterationBudget: IterationBudget

  // ── Token 跟踪 ──
  private lastPromptTokens: number = 0

  // ── 中断 ──
  private interruptRequested: boolean = false

  /** 工具执行中止控制器，interrupt() 时触发，用于终止正在运行的长时间工具 */
  private toolAbortController: AbortController | null = null

  // ── 事件管理 ──
  private eventManager: AgentEventManager

  // ── LLM 桥接（系统提示构建、流式/非流式调用） ──
  private llmBridge: ReturnType<typeof createLlmBridge>

  // ── 会话状态（Todo、文件读取/搜索跟踪等） ──
  readonly sessionState: AgentSessionState

  // ── 压缩状态 ──
  private previousSummary: string | null = null
  private summaryFailureCooldownUntil: number = 0

  // ── 会话 ──
  readonly sessionId: string

  // ── 对话主题 ──
  private topicId: string = ''

  // ── 当前 turn 索引 ──
  private currentTurnIndex: number = 0

  // ── 记忆系统 ──
  private memoryManager: MemoryManager | null = null
  private nexusSessionId: string

  // ── Skill 系统 ──
  private skillManager: SkillManager | null = null
  private skillPromptInjector: SkillPromptInjector | null = null

  // ── Task 系统 ──
  private taskManager: TaskManager | null = null

  // ── 后台压缩器 ──
  private _backgroundCompressor: BackgroundCompressor | null = null

  // ── 后台压缩标记：下次 run() 时重新从 DB 加载历史 ──
  private needsReload: boolean = false

  // ── 计划模式：开启后仅暴露只读工具 + write_plan ──
  private _planMode: boolean = false

  constructor(options: AIAgentOptions) {
    this.config = {
      provider: options.provider,
      apiUrl: options.apiUrl,
      apiKey: options.apiKey,
      model: options.model,
      maxIterations: options.maxIterations ?? 200,
      timeout: options.timeout ?? 600000,
      maxRetries: options.maxRetries ?? 3,
    }
    this.promptBuilderOptions = options.promptBuilderOptions
    this.mcpServers = options.mcpServers
    this.summaryModelConfig = options.summaryModelConfig
    this.sessionId = crypto.randomUUID()
    this.nexusSessionId = options.nexusSessionId ?? ''

    // 初始化记忆系统（基于 Nexus 会话 ID 隔离）
    if (this.nexusSessionId) {
      const memConfig = loadMemoryManagerConfig()
      this.memoryManager = new MemoryManager(memConfig, this.nexusSessionId)
    }

    this.llmClient = new LLMClient(this.config)
    this.toolRegistry = new ToolRegistry()
    this.iterationBudget = new IterationBudget(this.config.maxIterations)
    this.eventManager = new AgentEventManager()
    this.sessionState = new AgentSessionState()
    this.sessionState.setCurrentModel(this.config.model)

    // 创建 LLM 桥接
    this.llmBridge = createLlmBridge(
      {
        model: this.config.model,
        promptBuilderOptions: this.promptBuilderOptions,
      },
      this.llmClient,
      this.toolRegistry,
      this.eventManager,
      () => this.getSkillBlock(),
      () => this._planMode,
    )

    // 绑定会话状态到文件工具（避免全局变量导致跨会话污染）
    bindFileToolSession(this.sessionState)
    bindSearchState(
      () => this.sessionState.getSearchTrackerState(),
      (k, c) => this.sessionState.setSearchTrackerState(k, c),
    )

    // 绑定会话 ID 到终端工具（确保危险命令审批按会话隔离）
    bindTerminalSession(this.sessionId)
  }

  // ==================== 属性 ====================

  get currentState(): AgentState {
    return this.eventManager.getState()
  }

  get messageHistory(): ReadonlyArray<AgentMessage> {
    return this.messages
  }

  get tools(): ToolRegistry {
    return this.toolRegistry
  }

  get model(): string {
    return this.config.model
  }

  get provider(): string {
    return this.config.provider
  }

  /**
   * 设置计划模式开关
   *
   * 开启后 LLM 仅能使用只读工具和 write_plan 工具，
   * 用于"探索→讨论→生成计划"的工作流程。
   */
  setPlanMode(enabled: boolean): void {
    this._planMode = enabled
    logger.info(`[AIAgent] 计划模式已${enabled ? '开启' : '关闭'}`)
  }

  /**
   * 查询当前计划模式状态
   */
  getPlanMode(): boolean {
    return this._planMode
  }

  // ==================== 工具注册 ====================

  registerTool(tool: Parameters<ToolRegistry['register']>[0]): void {
    this.toolRegistry.register(tool)
  }

  registerTools(tools: Parameters<ToolRegistry['registerMany']>[0]): void {
    this.toolRegistry.registerMany(tools)
  }

  // ==================== Skill 系统 ====================

  /**
   * 初始化 Skill 系统
   *
   * 实例化 SkillManager 和 SkillPromptInjector，注册 skill 工具。
   * 可选传入 skillsDir 覆盖默认目录。
   */
  initSkills(skillsDir?: string): void {
    this.skillManager = new SkillManager(skillsDir)
    this.skillPromptInjector = new SkillPromptInjector(this.skillManager)

    // 注册 skill 查询工具
    const skillTools = createSkillTools(this.skillManager)
    this.registerTools(skillTools)

    // 注册 skill 管理工具
    this.registerTool(createSkillManageTool(this.skillManager))
  }

  /**
   * 获取 Skill 索引 block（供 llmBridge 调用）
   */
  private getSkillBlock(): string {
    if (!this.skillPromptInjector) return ''
    return this.skillPromptInjector.buildBlock()
  }

  /**
   * 初始化 Task 系统
   *
   * 实例化 TaskManager，注册 task 查询和管理工具。
   * 可选传入 tasksDir 覆盖默认目录。
   */
  initTasks(tasksDir?: string): void {
    this.taskManager = new TaskManager(tasksDir)

    // 注册 task 查询工具
    const taskTools = createTaskTools(this.taskManager)
    this.registerTools(taskTools)

    // 注册 task 管理工具
    this.registerTool(createTaskManageTool(this.taskManager))
  }

  // ==================== 记忆系统 ====================

  /**
   * 异步初始化记忆系统。
   *
   * 需在构造函数后调用，加载记忆文件、冻结快照、注册记忆工具。
   */
  async initializeMemory(): Promise<void> {
    if (!this.memoryManager) return

    await this.memoryManager.initializeAll()
    const snapshot = await this.memoryManager.loadAndFreezeSnapshot()

    // 重建 LLM Bridge，将记忆快照注入 system prompt
    this.llmBridge = createLlmBridge(
      {
        model: this.config.model,
        promptBuilderOptions: {
          ...this.promptBuilderOptions,
          memoryBlock: snapshot,
        },
      },
      this.llmClient,
      this.toolRegistry,
      this.eventManager,
      () => this.getSkillBlock(),
      () => this._planMode,
    )

    // 注册记忆工具
    const memoryTools = this.memoryManager.getAllToolSchemas()
    logger.info('[AIAgent] 准备注册', memoryTools.length, '个记忆工具:', memoryTools.map(t => t.name).join(', '))
    this.registerTools(memoryTools)
    logger.info('[AIAgent] ToolRegistry 当前工具:', this.toolRegistry.size, '个')

    // 后台预取（空查询，仅预热）
    // 已移除 — 空查询预取无意义

    logger.info('[AIAgent] 记忆系统已初始化')
  }

  /**
   * 获取记忆工具 schema（供外部注册使用）
   */
  getMemoryToolSchemas(): Parameters<ToolRegistry['registerMany']>[0] {
    return this.memoryManager?.getAllToolSchemas() ?? []
  }

  // ==================== MCP 管理 ====================

  async initializeMcp(): Promise<void> {
    if (!this.mcpServers || this.mcpServers.length === 0) {
      return
    }

    this.mcpClient = new McpClient()
    await this.mcpClient.startAll(this.mcpServers)
    this.mcpClient.registerToolsTo(this.toolRegistry)

    logger.info(
      `[AIAgent] MCP 初始化完成: ${this.mcpServers.length} 个 Server, `
      + `总工具数: ${this.toolRegistry.size}`
    )
  }

  async shutdownMcp(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.stopAll()
      this.mcpClient = null
      logger.info('[AIAgent] MCP 已关闭')
    }
  }

  // ==================== 辅助 LLM 客户端 ====================

  getAuxClient(): AuxiliaryClient {
    if (!this.auxClient) {
      this.auxClient = new AuxiliaryClient({
        parentConfig: this.config,
        standaloneConfig: this.summaryModelConfig,
        summaryModel: this.config.summaryModel,
      })
    }
    return this.auxClient
  }

  // ==================== 事件系统（委托给 eventManager） ====================

  onEvent(callback: (event: AgentEvent) => void): () => void {
    return this.eventManager.onEvent(callback)
  }

  // ==================== 中断 ====================

  interrupt(): void {
    logger.info(`[AIAgent] interrupt() 被调用, llmClient.abortController 存在=${!!this.llmClient['abortController']}, toolAbortController 存在=${!!this.toolAbortController}`)
    this.interruptRequested = true
    this.llmClient.abort()
    // 中止正在执行的长时间工具（如终端命令）
    if (this.toolAbortController) {
      this.toolAbortController.abort()
      logger.info('[AIAgent] toolAbortController 已 abort')
    }
  }

  clearInterrupt(): void {
    this.interruptRequested = false
  }

  // ==================== 主运行循环 ====================

  async run(
    userMessage: string,
    attachments?: AttachedFile[],
    conversationHistory?: AgentMessage[],
    useStream: boolean = true,
  ): Promise<AgentRunResult> {
    // 重置后自动重建记忆系统
    if (!this.memoryManager && this.nexusSessionId) {
      const memConfig = loadMemoryManagerConfig()
      this.memoryManager = new MemoryManager(memConfig, this.nexusSessionId)
      logger.info('[AIAgent] reset() 后自动重建记忆系统')
      // 必须调用初始化，否则 initialized === false，retrieveForTurn 静默返回空
      await this.initializeMemory().catch(err =>
        logger.warn('[AIAgent] 记忆系统重建初始化失败:', err)
      )
    }

    // 检查后台压缩器是否已替换 DB 数据，如果是则重新加载历史
    if (this.needsReload) {
      logger.info('[AIAgent] 检测到后台压缩完成，重新从 DB 加载历史')
      this.needsReload = false
      this.messages = []
      this.previousSummary = null
      this.topicId = ''

      // 压缩后立即广播更新后的上下文使用百分比
      const db = DatabaseService.getInstance()?.getAgentMessageDAO()
      if (db) {
        const compressedMessages = db.loadAllBySessionId(this.nexusSessionId)
        const tokenCount = estimateMessageTokens(compressedMessages)
        const contextLength = resolveContextLength(this.config.model, this.config.contextLength)
        const pct = contextLength > 0 ? (tokenCount / contextLength) * 100 : 0
        this.eventManager.emit(createEvent('state_change', {
          state: 'idle',
          contextUsagePercent: Math.round(pct * 10) / 10,
        }))
        logger.info(`[AIAgent] 压缩后上下文使用率: ${pct.toFixed(1)}% (${tokenCount}/${contextLength} tokens)`)
      }
    }

    // 初始化或复用对话主题 ID
    this.ensureTopicInitialized()

    // 从数据库加载当前 topic 的历史消息
    const dbHistory = this.loadConversationHistory()
    // 如果调用方未传入历史，使用数据库历史
    const effectiveHistory = conversationHistory && conversationHistory.length > 0
      ? conversationHistory
      : dbHistory

    // 重置状态
    this.interruptRequested = false
    this.iterationBudget = new IterationBudget(this.config.maxIterations)
    // 创建新的工具执行中止控制器（上一次的已被 abort 过，不能复用）
    this.toolAbortController = new AbortController()

    // 构建运行循环所需的依赖
    const agentState: MutableAgentState = {
      messages: this.messages,
      lastPromptTokens: this.lastPromptTokens,
      previousSummary: this.previousSummary,
      summaryFailureCooldownUntil: this.summaryFailureCooldownUntil,
    }

    const deps: RunLoopDeps = {
      config: {
        model: this.config.model,
        provider: this.config.provider,
        apiUrl: this.config.apiUrl,
        apiKey: this.config.apiKey,
        maxIterations: this.config.maxIterations ?? 200,
        timeout: this.config.timeout ?? 60000,
        maxRetries: this.config.maxRetries ?? 3,
        contextLength: this.config.contextLength,
        summaryModel: this.config.summaryModel,
      },
      llmClient: this.llmClient,
      toolRegistry: this.toolRegistry,
      eventManager: this.eventManager,
      auxClient: this.getAuxClient(),
      agentState,
      iterationBudget: this.iterationBudget,
      interruptRequested: () => this.interruptRequested,
      toolAbortSignal: this.toolAbortController.signal,
      getSystemPrompt: () => this.llmBridge.getSystemPrompt(),
      callLLMStream: (sp, msgs) => this.llmBridge.callLLMStream(sp, msgs),
      callLLMNonStream: (sp, msgs) => this.llmBridge.callLLMNonStream(sp, msgs),
      // 消息持久化回调
      saveMessage: (msg, turnIndex) => this.saveMessageToDb(msg, turnIndex),
      markTurnComplete: (turnIndex) => this.markTurnComplete(turnIndex),
      getNextTurnIndex: () => {
        const dao = this.getAgentMessageDAO()
        return dao ? dao.getNextTurnIndex(this.topicId, this.nexusSessionId) : 0
      },
      getMemoryContext: (q) => this.memoryManager?.retrieveForTurn(q) ?? '',
      getPlanMode: () => this._planMode,
    }

    // 委托给运行循环
    const result = await runAgentLoop(userMessage, attachments, effectiveHistory, useStream, deps)

    // 同步回写状态（深拷贝消息数组及嵌套对象，避免与运行循环内部共享引用导致数据污染）
    this.messages = result.messages.map(msg => ({
      ...msg,
      content: Array.isArray(msg.content) ? msg.content.map(b => ({ ...b })) : msg.content,
      tool_calls: msg.tool_calls ? msg.tool_calls.map(tc => ({ ...tc })) : undefined,
      attachments: msg.attachments ? msg.attachments.map(a => ({ ...a })) : undefined,
    }))
    this.lastPromptTokens = agentState.lastPromptTokens
    this.previousSummary = agentState.previousSummary
    this.summaryFailureCooldownUntil = agentState.summaryFailureCooldownUntil

    // 检查上下文是否需要请求后台压缩
    this._signalBackgroundCompressionIfNeeded()

    // 记忆同步（turn-end 非阻塞持久化）
    if (this.memoryManager) {
      this.memoryManager.syncAll().catch(err =>
        logger.warn('[AIAgent] 记忆同步失败:', err)
      )
      // 预取下一轮
      const lastUserMsg = [...this.messages].reverse().find(m => m.role === 'user')
      if (lastUserMsg) {
        const textContent = typeof lastUserMsg.content === 'string'
          ? lastUserMsg.content
          : Array.isArray(lastUserMsg.content)
            ? lastUserMsg.content.find(b => b.type === 'text')?.text || ''
            : ''
        if (textContent) {
          this.memoryManager.prefetch(textContent)
        }
      }
    }

    return result
  }

  // ==================== 会话管理 ====================

  getMessages(): AgentMessage[] {
    return [...this.messages]
  }

  /**
   * 获取当前对话主题 ID
   */
  getTopicId(): string {
    return this.topicId
  }

  /**
   * 获取 Nexus 会话 ID
   */
  getNexusSessionId(): string | undefined {
    return this.nexusSessionId || undefined
  }

  /**
   * 获取主 Agent 配置
   */
  getConfig(): AgentConfig {
    return { ...this.config }
  }

  /**
   * 获取副模型配置
   */
  getSummaryModelConfig(): AgentConfig | undefined {
    return this.summaryModelConfig ? { ...this.summaryModelConfig } : undefined
  }

  /**
   * 清除当前对话历史（数据库 + 内存）
   */
  clearHistory(): void {
    // 清除数据库中的全部对话历史（按 session 隔离）
    const dao = this.getAgentMessageDAO()
    if (dao) {
      dao.deleteAllBySessionId(this.nexusSessionId)
    }

    // 清除内存中的消息
    this.messages = []
    this.previousSummary = null
    this.summaryFailureCooldownUntil = 0
    this.currentTurnIndex = 0

    // 重置 topic，下次对话会重新生成
    this.topicId = ''

    logger.info('[AIAgent] 对话历史已全部清除')
  }

  /**
   * 确保 topicId 已初始化。
   * 如果当前有历史，复用最新 topic；否则生成新 topic。
   */
  private ensureTopicInitialized(): void {
    if (this.topicId) return  // 已有 topic，复用

    const dao = this.getAgentMessageDAO()
    if (!dao) {
      this.topicId = crypto.randomUUID()
      return
    }

    const history = dao.loadLatestTopic(this.nexusSessionId)
    if (history) {
      this.topicId = history.topicId
      logger.info(`[AIAgent] 复用历史 topic: ${this.topicId} (${history.messages.length} 条消息)`)
    } else {
      this.topicId = crypto.randomUUID()
      logger.info(`[AIAgent] 创建新 topic: ${this.topicId}`)
    }
  }

  /**
   * 从数据库加载当前 topic 的历史消息
   */
  private loadConversationHistory(): AgentMessage[] {
    const dao = this.getAgentMessageDAO()
    if (!dao || !this.nexusSessionId) return []

    const history = dao.loadLatestTopic(this.nexusSessionId)
    if (!history) return []

    // 设置 topicId 以便后续消息追加到同一 topic
    this.topicId = history.topicId

    logger.info(`[AIAgent] 从数据库加载历史: ${history.messages.length} 条消息`)
    return history.messages
  }

  /**
   * 保存单条消息到数据库
   */
  private saveMessageToDb(msg: AgentMessage, turnIndex: number): void {
    this.currentTurnIndex = turnIndex
    const dao = this.getAgentMessageDAO()
    if (!dao || !this.topicId) return

    try {
      dao.saveMessage(this.topicId, this.nexusSessionId, msg, turnIndex)
    } catch (err) {
      logger.warn('[AIAgent] 保存消息失败:', err)
    }
  }

  /**
   * 标记当前 turn 为完整
   */
  private markTurnComplete(turnIndex: number): void {
    const dao = this.getAgentMessageDAO()
    if (!dao || !this.topicId) return

    try {
      dao.markTurnComplete(this.topicId, turnIndex, this.nexusSessionId)
    } catch (err) {
      logger.warn('[AIAgent] 标记 turn 完整失败:', err)
    }
  }

  /**
   * 获取 AgentMessageDAO（安全访问）
   */
  private getAgentMessageDAO(): AgentMessageDAO | null {
    try {
      const db = DatabaseService.getInstance()
      if (!db) return null
      return db.getAgentMessageDAO()
    } catch {
      return null
    }
  }

  // ==================== 后台压缩 ====================

  /**
   * 注册后台压缩器实例
   */
  setBackgroundCompressor(compressor: BackgroundCompressor): void {
    this._backgroundCompressor = compressor
  }

  /**
   * 设置重新加载标记（由后台压缩器在压缩完成后调用）
   */
  setNeedsReload(value: boolean): void {
    this.needsReload = value
    logger.info(`[AIAgent] needsReload 已设为 ${value}`)
  }

  /**
   * 检查当前上下文是否超过 50% 窗口，如果是则请求后台压缩
   * 在每次 run() 结束时调用
   */
  private _signalBackgroundCompressionIfNeeded(): void {
    if (!this._backgroundCompressor) {
      return
    }

    const contextLength = resolveContextLength(this.config.model, this.config.contextLength)
    const threshold = Math.floor(contextLength * 0.50)

    const currentTokens = this.lastPromptTokens || estimateMessageTokens(this.messages)

    if (currentTokens >= threshold) {
      const topicId = this.getTopicId()
      if (topicId && !this._backgroundCompressor.isCompressing) {
        logger.info(
          `[AIAgent] 上下文 ${currentTokens} tokens >= 50% 阈值 ${threshold}，` +
          `请求后台压缩 topic=${topicId}`
        )
        this._backgroundCompressor.requestCompression(topicId, this.nexusSessionId)
      }
    }
  }

  reset(): void {
    this.messages = []
    this.lastPromptTokens = 0
    this.previousSummary = null
    this.summaryFailureCooldownUntil = 0
    this.iterationBudget = new IterationBudget(this.config.maxIterations)
    this.clearInterrupt()
    this.eventManager.resetState()
    this.sessionState.reset()
    this.eventManager.setState('idle')
    // 清理记忆系统
    this.memoryManager?.shutdownAll().catch(err =>
      logger.warn('[AIAgent] 记忆系统关闭失败:', err)
    )
    this.memoryManager = null
  }

  updateConfig(partial: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...partial }
    this.llmClient.updateConfig(partial)
    this.iterationBudget = new IterationBudget(this.config.maxIterations ?? 200)
    if (partial.model) {
      this.sessionState.setCurrentModel(partial.model)
    }
  }
}
