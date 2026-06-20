/**
 * 智能体服务 — 管理 AIAgent 实例生命周期，桥接事件到渲染进程。
 *
 * 使用 Map<sessionId, AIAgent> 支持多会话并行，
 * 每个 AIAgent 实例拥有独立的会话状态（TodoStore、文件缓存等）。
 */

import { BrowserWindow, ipcMain } from 'electron'
import { AIAgent, AIAgentOptions } from '../agent/ai-agent'
import { createBuiltTools } from '../agent/tools'
import { TodoItem } from '../agent/tools/todo-store'
import { BackgroundCompressor } from '../agent/background-compressor'
import { MemoryExtractorAgent } from '../agent/memory-extractor'
import { AgentState, AgentConfig, AttachedFile, AgentMessage } from '../../core/types/agent'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'
import { DatabaseService } from '../services/database.service'
import { setApprovalCallback, setInteractiveMode, ApprovalAction } from '../agent/utils/approval'
import { setClarifyCallback } from '../agent/tools/clarify-tool'
import { configureEmail } from '../agent/tools/email-tools'
import { createWritePlanTool } from '../agent/tools/write-plan-tool'
import { createUpdatePlanTool } from '../agent/tools/update-plan-tool'
import { createExitPlanModeTool, createEnterPlanModeTool } from '../agent/tools/plan-mode-tools'
import { logger } from '../utils/logger'
import { estimateMessageTokens } from '../agent/context-compressor'
import { resolveContextLength } from '../agent/model-metadata'
import { NexusConnectionManager } from '../services/nexus-connection-manager'

/**
 * 按 sessionId 隔离的 AIAgent 实例映射。
 */
const agentSessions = new Map<string, AIAgent>()

/**
 * 按 sessionId 隔离的后台压缩器映射。
 */
const backgroundCompressors = new Map<string, BackgroundCompressor>()

/**
 * 按 sessionId 隔离的计划模式状态（agent 可能尚未创建，需提前记录用户意图）
 */
const planModeStates = new Map<string, boolean>()

/**
 * 触发记忆提取（异步，不阻塞调用方）
 *
 * 在"清除历史对话"或"总结历史对话"时调用，
 * 后台启动副模型分析对话历史，提取值得长期保存的记忆。
 */
function triggerMemoryExtraction(messages: AgentMessage[], sessionId: string): void {
  if (messages.length < 4) {
    return
  }

  const agent = agentSessions.get(sessionId)
  if (!agent) {
    logger.warn('[AIAgentManager] agent 实例不存在，跳过记忆提取')
    return
  }

  const nexusSessionId = agent.getNexusSessionId()
  if (!nexusSessionId) {
    logger.warn('[AIAgentManager] nexusSessionId 为空，跳过记忆提取')
    return
  }

  const parentConfig = agent.getConfig()
  const summaryModelConfig = agent.getSummaryModelConfig()
  logger.debug(`[AIAgentManager] 记忆提取配置: parent=${parentConfig?.model}, summary=${summaryModelConfig?.model}`)

  const extractor = new MemoryExtractorAgent({
    nexusSessionId,
    parentConfig,
    summaryModelConfig,
  })

  // Fire and forget，不阻塞调用方
  extractor.extract(messages).then(() => {
    logger.info('[AIAgentManager] 已触发记忆提取，sessionId=%s', sessionId)
  }).catch(err => {
    logger.error('[AIAgentManager] 记忆提取失败: sessionId=%s, error=%s', sessionId, err)
  })
  logger.info(`[AIAgentManager] 已触发记忆提取: ${messages.length} 条消息`)
}

/**
 * 手动触发后台压缩
 */
export function compressConversationHistory(sessionId: string): boolean {
  // 如果后台压缩器不存在，先创建 agent 会话
  if (!backgroundCompressors.has(sessionId)) {
    logger.info(`[AIAgentManager] 压缩器不存在，正在创建 agent 会话: ${sessionId}`)
    const agent = getOrCreateAIAgent(sessionId)
    if (!agent) {
      logger.warn('[AIAgentManager] 无法创建 agent 会话，跳过压缩')
      return false
    }
  }

  const compressor = backgroundCompressors.get(sessionId)!
  if (compressor.isCompressing) {
    logger.info('[AIAgentManager] 压缩已在进行中，跳过重复请求')
    return false
  }

  // 获取该 session 下的 topicId
  const agent = agentSessions.get(sessionId)
  const topicId = agent?.getTopicId() || sessionId
  compressor.requestCompression(topicId, sessionId)
  logger.info(`[AIAgentManager] 手动触发压缩: sessionId=${sessionId}, topicId=${topicId}`)
  return true
}

/**
 * 向所有渲染进程广播事件
 */
function broadcast(eventChannel: string, data: Record<string, unknown>): void {
  const allWindows = BrowserWindow.getAllWindows()
  for (const win of allWindows) {
    try {
      win.webContents.send(eventChannel, data)
    } catch {
      // 窗口可能已关闭，忽略
    }
  }
}

/**
 * 从数据库读取 agent 配置
 */

/** 配置缓存，避免每次调用都读数据库 */
let cachedAgentConfig: (AgentConfig & { summaryModelConfig?: AgentConfig }) | null = null
/** 语言缓存 */
let cachedLanguage: 'zh' | 'en' = 'zh'

export function loadAgentConfig(): (AgentConfig & { summaryModelConfig?: AgentConfig }) | null {
  // 优先使用缓存
  if (cachedAgentConfig !== null) {
    return cachedAgentConfig
  }
  try {
    const db = DatabaseService.getInstance()
    if (!db) return null

    const configDAO = db.getConfigDAO()
    const agentConfig = configDAO.get('agentConfig') as {
      provider: 'openai' | 'anthropic'
      apiUrl: string
      apiKey: string
      model: string
      maxIterations?: number
      timeout?: number
      maxRetries?: number
      contextLength?: number
      accessModes?: string[]
    } | null

    if (!agentConfig || !agentConfig.apiKey || !agentConfig.apiUrl) {
      logger.warn('[AIAgentManager] 缺少 agentConfig 或 apiKey/apiUrl 为空')
      return null
    }

    // 副模型配置（用于摘要生成等辅助任务）
    const subAgentConfig = configDAO.get('subAgentConfig') as {
      provider: 'openai' | 'anthropic'
      apiUrl: string
      apiKey: string
      model: string
      timeout?: number
      maxRetries?: number
      contextLength?: number
      accessModes?: string[]
    } | null
    const agentInteractive = configDAO.get('agentInteractive') as boolean | null

    setInteractiveMode(agentInteractive !== false)

    // 邮件工具配置
    const emailConf = configDAO.get('emailConfig') as {
      enabled: boolean
      account: {
        email: string
        appPassword: string
        imapHost: string
        imapPort: number
        imapSecure: boolean
        smtpHost: string
        smtpPort: number
        smtpSecure: boolean
        displayName?: string
      }
    } | null
    if (emailConf && emailConf.enabled && emailConf.account) {
      configureEmail(emailConf)
      logger.info('[AIAgentManager] email 工具已配置:', emailConf.account.email)
    } else {
      configureEmail(null)
      logger.info('[AIAgentManager] email 工具未配置或未启用')
    }

    // 构建辅助客户端配置：优先使用副模型配置，未配置时回退到主模型
    const auxAgentConfig: AgentConfig | undefined = subAgentConfig
      && subAgentConfig.apiKey
      && subAgentConfig.apiUrl
      ? {
        provider: subAgentConfig.provider,
        apiUrl: subAgentConfig.apiUrl,
        apiKey: subAgentConfig.apiKey,
        model: subAgentConfig.model,
        maxIterations: 1,
        timeout: subAgentConfig.timeout ?? 120000,
        maxRetries: subAgentConfig.maxRetries ?? 2,
        contextLength: subAgentConfig.contextLength,
      }
      : undefined

    // 缓存结果
    const result: AgentConfig & { summaryModelConfig?: AgentConfig } = {
      provider: agentConfig.provider,
      apiUrl: agentConfig.apiUrl,
      apiKey: agentConfig.apiKey,
      model: agentConfig.model,
      maxIterations: agentConfig.maxIterations ?? 200,
      timeout: agentConfig.timeout ?? 600000,
      maxRetries: agentConfig.maxRetries ?? 3,
      contextLength: agentConfig.contextLength || undefined,
      accessModes: agentConfig.accessModes,
      summaryModelConfig: auxAgentConfig,
    }
    cachedAgentConfig = result

    // 读取语言配置
    try {
      const savedLang = configDAO.get('language') as string | null
      if (savedLang && (savedLang === 'zh' || savedLang === 'en')) {
        cachedLanguage = savedLang
      }
    } catch {
      // 语言读取失败不影响主配置
    }

    return result
  } catch (err) {
    logger.error('[AIAgentManager] 读取配置失败:', err)
    return null
  }
}

/**
 * 获取当前界面语言对应的显示名称，用于 prompt 注入
 */
export function getAppLanguageName(): string {
  const map: Record<string, string> = { zh: '中文', en: 'English', fr: 'Français', es: 'Español' }
  return map[cachedLanguage] || '中文'
}

/**
 * 使配置缓存失效，下次 loadAgentConfig 会从数据库重新读取
 */
export function invalidateConfigCache(): void {
  cachedAgentConfig = null
  cachedLanguage = 'zh'
}

/**
 * 启动时计算并广播初始上下文使用率
 *
 * 从数据库加载持久化消息，估算 token 数，广播一个初始的 state_change 事件。
 * 这样 DynamicIsland 在启动后就能显示真实的百分比，而不是固定的 0%。
 */
export function broadcastStartupContextUsage(): void {
  const config = loadAgentConfig()
  if (!config) {
    logger.info('[AIAgentManager] 未配置模型，跳过初始上下文使用率计算')
    return
  }

  const db = DatabaseService.getInstance()
  if (!db) {
    logger.warn('[AIAgentManager] 数据库服务未就绪，跳过初始上下文使用率计算')
    return
  }
  const messages = db.getAgentMessageDAO().loadAllMessages()
  if (messages.length === 0) {
    logger.info('[AIAgentManager] 无历史消息，初始上下文使用率为 0%')
    return
  }

  const tokenCount = estimateMessageTokens(messages)
  const contextLength = resolveContextLength(config.model, config.contextLength)
  const pct = contextLength > 0 ? (tokenCount / contextLength) * 100 : 0

  broadcast(IPC_CHANNELS.AGENT_STATE_CHANGE, {
    state: 'idle',
    contextUsagePercent: Math.round(pct * 10) / 10,
  })
  logger.info(`[AIAgentManager] 初始上下文使用率: ${pct.toFixed(1)}% (${tokenCount}/${contextLength} tokens)`)
}

/**
 * 获取当前上下文使用率（供渲染进程主动请求）
 *
 * 从数据库加载持久化消息并估算 token 数，返回百分比。
 * 用于 DynamicIsland 挂载时获取初始值，避免启动时序竞争。
 */
export function getAgentContextUsage(): { contextUsagePercent: number } {
  const config = loadAgentConfig()
  if (!config) {
    return { contextUsagePercent: 0 }
  }

  const db = DatabaseService.getInstance()
  if (!db) return { contextUsagePercent: 0 }
  const messages = db.getAgentMessageDAO().loadAllMessages()
  if (messages.length === 0) {
    return { contextUsagePercent: 0 }
  }

  const tokenCount = estimateMessageTokens(messages)
  const contextLength = resolveContextLength(config.model, config.contextLength)
  const pct = contextLength > 0 ? (tokenCount / contextLength) * 100 : 0

  return { contextUsagePercent: Math.round(pct * 10) / 10 }
}

/**
 * 加载指定会话的对话历史（用于 UI 恢复）
 *
 * 从数据库读取消息，按 turn_index 配对 user 和 assistant 消息，
 * 返回 { question, answer, timestamp }[] 格式。
 * 忽略 system、tool 消息和中间过程。
 */
export function loadConversationHistory(sessionId: string): Array<{
  question: string
  answer: string
  timestamp: number
}> {
  const db = DatabaseService.getInstance()
  if (!db) {
    logger.warn('[AIAgentManager] 数据库服务未就绪，无法加载对话历史')
    return []
  }
  const dao = db.getAgentMessageDAO()
  const allMessages = dao.loadAllBySessionId(sessionId)

  const turns: Array<{ question: string; answer: string; timestamp: number }> = []
  let pendingUser = null as { content: string; timestamp: number } | null

  for (const msg of allMessages) {
    if (msg.role === 'user') {
      // 提取用户消息文本
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content && Array.isArray(msg.content)
          ? msg.content.map((b: any) => b.type === 'text' ? b.text : '').join('')
          : ''
      if (text.trim()) {
        pendingUser = { content: text.trim(), timestamp: msg.timestamp || Date.now() }
      }
    } else if (msg.role === 'assistant' && pendingUser && !msg.tool_calls) {
      // 非工具调用的 assistant 消息，配对为完整一轮
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content && Array.isArray(msg.content)
          ? msg.content.map((b: any) => b.type === 'text' ? b.text : '').join('')
          : ''
      if (text.trim()) {
        turns.push({
          question: pendingUser.content,
          answer: text.trim(),
          timestamp: pendingUser.timestamp,
        })
        pendingUser = null
      }
    } else if (msg.role === 'tool' || (msg.role === 'assistant' && msg.tool_calls)) {
      // tool 消息或有工具调用的 assistant 消息，不配对
      // 但如果有 pendingUser，保留等待下一个 assistant 回复
    }
  }

  return turns
}

/**
 * 设置事件桥接到渲染进程
 */
function setupEventBridge(agent: AIAgent): void {
  agent.onEvent((event) => {
    switch (event.type) {
      case 'message_delta':
        broadcast(IPC_CHANNELS.AGENT_STREAMING, { text: event.data.text })
        break
      case 'thinking':
        broadcast(IPC_CHANNELS.AGENT_THINKING, { text: event.data.text })
        break
      case 'tool_start':
        broadcast(IPC_CHANNELS.AGENT_TOOL_CALL, {
          toolCallId: event.data.toolCallId as string,
          toolName: event.data.toolName as string,
          toolArgs: event.data.toolArgs as Record<string, unknown> | undefined,
        })
        logger.info(`[AgentService] tool_start: ${event.data.toolName} args=${JSON.stringify(event.data.toolArgs).slice(0, 200)}`)
        break
      case 'tool_result': {
        let fullOutput = ''
        const msgs = agent.getMessages()
        const toolMsg = msgs.find(m => m.role === 'tool' && m.tool_call_id === event.data.toolCallId)
        if (toolMsg) {
          const c = toolMsg.content
          fullOutput = typeof c === 'string' ? (c ?? '') : ''
        }
        // 透传工具附加数据（如 write_plan 的计划文档内容）
        const toolData = event.data.data
        broadcast(IPC_CHANNELS.AGENT_TOOL_RESULT, {
          toolCallId: event.data.toolCallId as string,
          toolName: event.data.toolName as string,
          success: event.data.success as boolean,
          output: fullOutput,
          ...(toolData != null ? { data: toolData } : {}),
        })
        break
      }
      case 'state_change':
        broadcast(IPC_CHANNELS.AGENT_STATE_CHANGE, {
          state: event.data.state,
          apiCall: event.data.apiCall,
          budgetRemaining: event.data.budgetRemaining,
          contextUsagePercent: event.data.contextUsagePercent,
        })
        break
      case 'new_iteration':
        broadcast(IPC_CHANNELS.AGENT_NEW_ITERATION, {})
        break
      case 'tool_calling_started':
        broadcast(IPC_CHANNELS.AGENT_TOOL_CALLING_STARTED, {
          toolCallId: event.data.toolCallId as string,
          toolName: event.data.toolName as string,
        })
        break
    }
  })
}

/**
 * 创建新的 AIAgent 会话
 */
function createAgentSession(sessionId: string): AIAgent | null {
  const config = loadAgentConfig()
  if (!config) {
    logger.warn('[AIAgentManager] 无法加载 agent 配置')
    return null
  }

  // 获取当前激活的 Nexus 会话 ID（用于记忆隔离）
  const db = DatabaseService.getInstance()
  const activeSession = db?.getSessionDAO().getActive()
  const nexusSessionId = activeSession?.id

  const agentOptions: AIAgentOptions = {
    ...config,
    nexusSessionId: nexusSessionId || undefined,
    promptBuilderOptions: {
      language: cachedLanguage,
    },
  }

  const agent = new AIAgent(agentOptions)
  const tools = createBuiltTools(agent.sessionState)
  agent.registerTools(tools)

  // 初始化 Skill 系统
  agent.initSkills()

  // 初始化 Task 系统
  agent.initTasks()

  // 注册计划模式工具（write_plan + update_plan）
  agent.registerTool(createWritePlanTool(() => agent.getPlanMode()))
  agent.registerTool(createUpdatePlanTool(() => agent.getPlanMode()))

  // 注册计划模式切换工具（AI 自动进入/退出计划模式）
  const planModeToggle = (enabled: boolean) => {
    agent.setPlanMode(enabled)
    planModeStates.set(sessionId, enabled)
    broadcast(IPC_CHANNELS.AGENT_PLAN_MODE_CHANGED, { planMode: enabled })
    logger.info(`[AIAgentManager] AI 自动${enabled ? '进入' : '退出'}计划模式: sessionId=${sessionId}`)
  }
  agent.registerTool(createExitPlanModeTool(() => agent.getPlanMode(), planModeToggle))
  agent.registerTool(createEnterPlanModeTool(() => agent.getPlanMode(), planModeToggle))

  // 应用预设的计划模式状态（用户可能在 agent 创建前就切换了计划模式）
  const presetPlanMode = planModeStates.get(sessionId) ?? false
  if (presetPlanMode) {
    agent.setPlanMode(true)
    logger.info(`[AIAgentManager] 应用预设计划模式: sessionId=${sessionId}`)
  }

  setupEventBridge(agent)

  // 注册 TodoStore 变更回调，计划变更时广播到渲染进程
  agent.sessionState.todoStore.setOnChange((items: TodoItem[]) => {
    broadcast(IPC_CHANNELS.AGENT_PLAN_UPDATE, { todos: items })
  })

  // 创建并启动后台压缩器
  const compressor = new BackgroundCompressor({
    mainModel: config.model,
    contextLength: config.contextLength,
    summaryModelConfig: config.summaryModelConfig,
    pollIntervalMs: 5000,
    nexusSessionId: nexusSessionId,
  })
  compressor.setReloadCallback(() => agent.setNeedsReload(true))
  compressor.setActivityCallback((data) => {
    broadcast(IPC_CHANNELS.AGENT_BACKGROUND_ACTIVITY, data)
  })
  agent.setBackgroundCompressor(compressor)
  compressor.start()
  backgroundCompressors.set(sessionId, compressor)

  // 异步初始化记忆系统
  if (nexusSessionId) {
    agent.initializeMemory().catch(err =>
      logger.warn('[AIAgentManager] 记忆系统初始化失败:', err)
    )
  }

  agentSessions.set(sessionId, agent)

  logger.info(`[AIAgentManager] 新会话已创建: ${sessionId} (nexusSession: ${nexusSessionId})`)
  return agent
}

/**
 * 获取或创建 AIAgent 实例（按 sessionId 隔离）
 */
export function getOrCreateAIAgent(sessionId: string): AIAgent | null {
  // 检查是否存在活跃的 Nexus 会话，没有则不启动智能体
  const db = DatabaseService.getInstance()
  const activeSession = db?.getSessionDAO().getActive()
  if (!activeSession) {
    logger.warn('[AIAgentManager] 无活跃会话，智能体未启动')
    return null
  }

  let agent: AIAgent | null = agentSessions.get(sessionId) ?? null
  if (!agent) {
    agent = createAgentSession(sessionId)
  }
  return agent
}

/**
 * 发送消息给 AIAgent（异步，结果通过事件返回）
 */
export async function sendMessageToAIAgent(
  userMessage: string,
  attachments: AttachedFile[] | undefined,
  sessionId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const agent = getOrCreateAIAgent(sessionId)
    if (!agent) {
      return { success: false, error: 'AIAgent 未初始化，请检查 API 配置' }
    }
    if (agent.currentState === 'running') {
      return { success: false, error: 'Agent is currently running' }
    }

    // 根据 accessModes 决定调用方式：优先 stream，不支持则降级 invoke
    const config = loadAgentConfig()
    const accessModes = config?.accessModes ?? []
    const hasStream = accessModes.includes('stream')
    const useStream = hasStream

    agent.run(userMessage, attachments, agent.getMessages(), useStream).then((result) => {
      // 运行结束后广播最终响应和错误信息
      broadcast(IPC_CHANNELS.AGENT_STATE_CHANGE, {
        state: agent.currentState,
        apiCall: result.apiCalls,
        budgetRemaining: result.completed ? 0 : undefined,
        finalResponse: result.finalResponse ?? null,
        errorMessage: result.error ?? null,
      })
      logger.info(
        `[AIAgentManager] 运行结束: state=${agent.currentState} ` +
        `apiCalls=${result.apiCalls} completed=${result.completed} ` +
        `finalResponse="${(result.finalResponse ?? '').slice(0, 80)}${(result.finalResponse ?? '').length > 80 ? '...' : ''}"`
      )
    }).catch((err) => {
      logger.error('[AIAgentManager] run() 异常:', err)
      broadcast(IPC_CHANNELS.AGENT_STATE_CHANGE, {
        state: 'error',
        finalResponse: null,
        errorMessage: String(err),
      })
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/**
 * 中断 AIAgent
 */
export function interruptAIAgent(sessionId: string): void {
  logger.info(`[AIAgentManager] interruptAIAgent 被调用, sessionId=${sessionId}, 已有会话: [${Array.from(agentSessions.keys()).join(', ')}]`)
  const agent = agentSessions.get(sessionId)
  if (!agent) {
    logger.warn(`[AIAgentManager] 未找到 sessionId=${sessionId} 的 agent`)
    return
  }
  logger.info(`[AIAgentManager] 找到 agent, currentState=${agent.currentState}`)
  if (agent.currentState === 'running') {
    agent.interrupt()
    // 如果有 Nexus 连接且正在执行命令，发送 Ctrl+C 中断 PTY 中的进程
    NexusConnectionManager.getInstance().interruptCommand()
    logger.info('[AIAgentManager] 中断请求已发送')
  } else {
    logger.warn(`[AIAgentManager] agent 状态不是 running (当前=${agent.currentState})，跳过中断`)
  }
}

/**
 * 设置 AIAgent 的计划模式
 *
 * 将状态记录到 planModeStates Map。
 * 如果 agent 已存在，立即同步；如果尚未创建，在 createAgentSession 时应用。
 */
export function setAIAgentPlanMode(sessionId: string, enabled: boolean): void {
  planModeStates.set(sessionId, enabled)

  const agent = agentSessions.get(sessionId)
  if (agent) {
    agent.setPlanMode(enabled)
  }
  logger.info(`[AIAgentManager] 计划模式已${enabled ? '开启' : '关闭'}: sessionId=${sessionId} (agent=${agent ? '已同步' : '待创建'})`)
}

/**
 * 查询 AIAgent 的计划模式状态
 *
 * 优先从 agent 实例读取，agent 不存在时从预设状态读取。
 */
export function getAIAgentPlanMode(sessionId: string): boolean {
  const agent = agentSessions.get(sessionId)
  if (agent) {
    return agent.getPlanMode()
  }
  return planModeStates.get(sessionId) ?? false
}

/**
 * 查询 AIAgent 状态
 */
export function getAIAgentStatus(sessionId: string): { state: AgentState; sessionId: string | null } {
  const agent = agentSessions.get(sessionId)
  if (!agent) {
    return { state: 'idle', sessionId: null }
  }
  return {
    state: agent.currentState,
    sessionId: agent.sessionId,
  }
}

/**
 * 重置 AIAgent 会话
 */
export function resetAIAgent(sessionId: string): void {
  // 停止并清理后台压缩器
  const compressor = backgroundCompressors.get(sessionId)
  if (compressor) {
    compressor.stop()
    backgroundCompressors.delete(sessionId)
  }

  const agent = agentSessions.get(sessionId)
  if (agent) {
    agent.reset()
    // reset() 内部已调用 memoryManager.shutdownAll()，需要重新创建
    // 下次 getOrCreateAIAgent 时会重新初始化
  }
}

// ==================== 交互式交互 IPC 处理器 ====================

/**
 * 设置交互式 IPC 处理器（审批 + clarify）。
 * 在主窗口创建完成后调用，注册 IPC 监听器以处理渲染进程的交互请求。
 */
export function setupInteractiveHandlers(mainWindow: BrowserWindow): void {
  // --- 危险命令审批 ---

  // 审批回调：向渲染进程发送请求，等待用户回复
  setApprovalCallback(async (command, description, sessionKey) => {
    return new Promise<ApprovalAction>((resolve) => {
      // 超时保护：30 秒无操作自动拒绝
      const timeout = setTimeout(() => {
        resolve('reject')
      }, 30_000)

      // 一次性监听渲染进程的审批结果
      const handler = (_event: Electron.IpcMainInvokeEvent, data: { action: ApprovalAction }) => {
        clearTimeout(timeout)
        ipcMain.removeHandler(IPC_CHANNELS.AGENT_APPROVAL_RESULT)
        resolve(data.action)
        return { success: true }
      }
      ipcMain.handle(IPC_CHANNELS.AGENT_APPROVAL_RESULT, handler)

      // 发送审批请求到渲染进程
      mainWindow.webContents.send(IPC_CHANNELS.AGENT_REQUEST_APPROVAL, {
        command,
        description,
        sessionKey,
      })
    })
  })

  // --- Clarify 提问 ---

  // Clarify 回调：向渲染进程发送问题，等待用户回答
  setClarifyCallback(async (question, choices) => {
    return new Promise<string>((resolve, reject) => {
      // 超时保护：60 秒无操作自动返回空
      const timeout = setTimeout(() => {
        resolve('')
      }, 60_000)

      // 一次性监听渲染进程的回答
      const handler = (_event: Electron.IpcMainInvokeEvent, data: { response: string }) => {
        clearTimeout(timeout)
        ipcMain.removeHandler(IPC_CHANNELS.AGENT_CLARIFY_RESULT)
        resolve(data.response)
        return { success: true }
      }
      ipcMain.handle(IPC_CHANNELS.AGENT_CLARIFY_RESULT, handler)

      // 发送提问请求到渲染进程
      mainWindow.webContents.send(IPC_CHANNELS.AGENT_CLARIFY, {
        question,
        choices,
      })
    })
  })

  logger.info('[AIAgentManager] 交互式 IPC 处理器已注册')
}

// ==================== 清除历史对话 ====================

/**
 * 清除指定会话的历史对话（触发记忆提取后删除）
 */
export async function clearAgentHistory(sessionId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const agent = agentSessions.get(sessionId)
    if (agent) {
      // ---- 在清除前触发记忆提取 ----
      const topicId = agent.getTopicId()
      const nexusSessionId = agent.getNexusSessionId()
      if (topicId && nexusSessionId) {
        const dao = DatabaseService.getInstance()?.getAgentMessageDAO()
        if (dao) {
          const messages = dao.loadByTopic(topicId, nexusSessionId)
          triggerMemoryExtraction(messages, sessionId)
        }
      }

      agent.clearHistory()
      broadcast(IPC_CHANNELS.AGENT_STATE_CHANGE, {
        state: agent.currentState,
        contextUsagePercent: 0,
      })
      logger.info(`[AIAgentManager] 会话 ${nexusSessionId || sessionId} 对话历史已清除`)
    } else {
      // agent 未创建时，先从数据库按 session 读取消息触发记忆提取，再删除
      logger.info(`[AIAgentManager] agent 实例不存在 (sessionId=${sessionId})，尝试从数据库读取消息`)
      const db = DatabaseService.getInstance()
      if (db) {
        const dao = db.getAgentMessageDAO()
        const allMessages = dao.loadAllBySessionId(sessionId)
        logger.info(`[AIAgentManager] 从 session ${sessionId} 读取到 ${allMessages.length} 条消息`)

        if (allMessages.length >= 4) {
          // 从数据库获取该 session 的真实 nexus_session_id
          const realSessionId = dao.getDistinctSessionIds().find(id => id === sessionId) || sessionId

          // 读取 agent 配置，配置不可用时跳过记忆提取
          let parentConfig: AgentConfig | null = null
          try {
            const configDAO = db.getConfigDAO()
            const savedConfig = configDAO.get('agentConfig') as Record<string, unknown> | null
            if (savedConfig?.model && savedConfig?.provider && savedConfig?.apiKey && savedConfig?.apiUrl) {
              parentConfig = {
                provider: savedConfig.provider as AgentConfig['provider'],
                apiUrl: savedConfig.apiUrl as string,
                apiKey: savedConfig.apiKey as string,
                model: savedConfig.model as string,
                maxIterations: Number(savedConfig.maxIterations) || 200,
                timeout: Number(savedConfig.timeout) || 600000,
                maxRetries: Number(savedConfig.maxRetries) || 3,
                contextLength: Number(savedConfig.contextLength) || undefined,
                accessModes: savedConfig.accessModes as string[] | undefined,
              }
            }
          } catch (e) {
            logger.warn('[AIAgentManager] 读取 agent 配置失败:', e)
          }

          if (!parentConfig) {
            logger.warn('[AIAgentManager] agent 配置不完整，跳过记忆提取')
          } else {
            logger.info('[AIAgentManager] 触发记忆提取: model=%s, nexusSessionId=%s, messages=%d', parentConfig.model, realSessionId, allMessages.length)
            const extractor = new MemoryExtractorAgent({
              nexusSessionId: realSessionId,
              parentConfig,
              summaryModelConfig: undefined,
            })
            extractor.extract(allMessages).then(() => {
              logger.info('[AIAgentManager] 无 agent 实例时的记忆提取完成')
            }).catch(err => {
              logger.error('[AIAgentManager] 无 agent 实例时的记忆提取失败:', err)
            })
          }
        } else {
          logger.info('[AIAgentManager] 消息数不足 4 条，跳过记忆提取')
        }

        dao.deleteAllBySessionId(sessionId)
        logger.info(`[AIAgentManager] 已删除 session ${sessionId} 的对话历史`)

        // FIX: agent 不存在时也要广播 contextUsagePercent 重置
        broadcast(IPC_CHANNELS.AGENT_STATE_CHANGE, {
          state: 'idle',
          contextUsagePercent: 0,
        })
      } else {
        logger.warn('[AIAgentManager] 数据库服务未初始化')
      }
    }

    return { success: true }
  } catch (err) {
    logger.error('[AIAgentManager] 清除对话历史失败:', err)
    return { success: false, error: (err as Error).message }
  }
}
