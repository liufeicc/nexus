/**
 * 核心智能体类 — 模仿 Hermes 的 AIAgent
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
} from '../../core/types/agent'
import { MemoryManagerConfig } from '../../core/types/memory'
import { LLMClient } from './llm-client'
import { ToolRegistry } from './tool-registry'
import { BuildSystemPromptOptions } from './prompt-builder'
import { McpClient } from './mcp/mcp-client'
import { AuxiliaryClient } from './auxiliary-client'
import { AgentEventManager } from './agent-events'
import { runAgentLoop, RunLoopDeps } from './agent-loop'
import { createLlmBridge } from './agent-llm-bridge'
import { AgentSessionState } from './session-state'
import { bindFileToolSession, bindSearchState } from './tools/file-tools'
import { MemoryManager } from './memory/memory-manager'
import { DatabaseService } from '../services/database.service'
import { logger } from '../utils/logger'
import { SkillManager } from './skills/skill-manager'
import { SkillPromptInjector } from './skills/skill-prompt-injector'
import { createSkillTools } from './skills/skills-tool'
import { createSkillManageTool } from './skills/skill-manage-tool'

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

// ==================== 智能体运行结果 ====================

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
  private apiCallCount: number = 0

  // ── Token 跟踪 ──
  private lastPromptTokens: number = 0

  // ── 中断 ──
  private interruptRequested: boolean = false

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

  // ── 记忆系统 ──
  private memoryManager: MemoryManager | null = null
  private nexusSessionId: string

  // ── Skill 系统 ──
  private skillManager: SkillManager | null = null
  private skillPromptInjector: SkillPromptInjector | null = null

  constructor(options: AIAgentOptions) {
    this.config = {
      provider: options.provider,
      apiUrl: options.apiUrl,
      apiKey: options.apiKey,
      model: options.model,
      maxIterations: options.maxIterations ?? 90,
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
    )

    // 绑定会话状态到文件工具（避免全局变量导致跨会话污染）
    bindFileToolSession(this.sessionState)
    bindSearchState(
      () => this.sessionState.getSearchTrackerState(),
      (k, c) => this.sessionState.setSearchTrackerState(k, c),
    )
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
    )

    // 注册记忆工具
    const memoryTools = this.memoryManager.getAllToolSchemas()
    logger.info('[AIAgent] 准备注册', memoryTools.length, '个记忆工具:', memoryTools.map(t => t.name).join(', '))
    this.registerTools(memoryTools)
    logger.info('[AIAgent] ToolRegistry 当前工具:', this.toolRegistry.size, '个')

    // 后台预取（空查询，仅预热）
    this.memoryManager.prefetch('').catch(() => {})

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
    this.interruptRequested = true
    this.llmClient.abort()
  }

  clearInterrupt(): void {
    this.interruptRequested = false
  }

  // ==================== 主运行循环 ====================

  async run(
    userMessage: string,
    conversationHistory?: AgentMessage[],
    useStream: boolean = true,
  ): Promise<AgentRunResult> {
    // 重置状态
    this.interruptRequested = false
    this.apiCallCount = 0
    this.iterationBudget = new IterationBudget(this.config.maxIterations)

    // 构建运行循环所需的依赖
    const deps: RunLoopDeps = {
      config: {
        model: this.config.model,
        provider: this.config.provider,
        apiUrl: this.config.apiUrl,
        apiKey: this.config.apiKey,
        maxIterations: this.config.maxIterations ?? 90,
        timeout: this.config.timeout ?? 60000,
        maxRetries: this.config.maxRetries ?? 3,
        contextLength: this.config.contextLength,
        summaryModel: this.config.summaryModel,
      },
      llmClient: this.llmClient,
      toolRegistry: this.toolRegistry,
      eventManager: this.eventManager,
      auxClient: this.getAuxClient(),
      getMessages: () => this.messages,
      setMessages: (m) => { this.messages = m },
      iterationBudget: this.iterationBudget,
      interruptRequested: () => this.interruptRequested,
      lastPromptTokens: this.lastPromptTokens,
      setLastPromptTokens: (v) => { this.lastPromptTokens = v },
      previousSummary: this.previousSummary,
      setPreviousSummary: (v) => { this.previousSummary = v },
      summaryFailureCooldownUntil: this.summaryFailureCooldownUntil,
      getSystemPrompt: () => this.llmBridge.getSystemPrompt(),
      buildApiMessages: (sp) => this.llmBridge.buildApiMessages(sp),
      callLLMStream: (sp, msgs) => this.llmBridge.callLLMStream(sp, msgs),
      callLLMNonStream: (sp, msgs) => this.llmBridge.callLLMNonStream(sp, msgs),
    }

    // 委托给运行循环
    const result = await runAgentLoop(userMessage, conversationHistory, useStream, deps)

    // 同步回写状态
    this.messages = result.messages
    this.apiCallCount = result.apiCalls

    // 记忆同步（turn-end 非阻塞持久化）
    if (this.memoryManager) {
      this.memoryManager.syncAll().catch(err =>
        logger.warn('[AIAgent] 记忆同步失败:', err)
      )
      // 预取下一轮
      const lastUserMsg = [...this.messages].reverse().find(m => m.role === 'user')
      if (lastUserMsg && typeof lastUserMsg.content === 'string') {
        this.memoryManager.prefetch(lastUserMsg.content).catch(() => {})
      }
    }

    return result
  }

  // ==================== 会话管理 ====================

  getMessages(): AgentMessage[] {
    return [...this.messages]
  }

  reset(): void {
    this.messages = []
    this.apiCallCount = 0
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
    this.iterationBudget = new IterationBudget(this.config.maxIterations ?? 90)
  }
}
