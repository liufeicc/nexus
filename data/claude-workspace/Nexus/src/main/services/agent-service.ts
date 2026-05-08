/**
 * 智能体服务 — 管理 AIAgent 实例生命周期，桥接事件到渲染进程。
 *
 * 使用 Map<sessionId, AIAgent> 支持多会话并行，
 * 每个 AIAgent 实例拥有独立的会话状态（TodoStore、文件缓存等）。
 */

import { BrowserWindow, ipcMain } from 'electron'
import { AIAgent, AIAgentOptions } from '../agent/ai-agent'
import { createBuiltTools } from '../agent/tools'
import { BackgroundCompressor } from '../agent/background-compressor'
import { AgentState, AgentConfig, AttachedFile } from '../../core/types/agent'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'
import { DatabaseService } from '../services/database.service'
import { setApprovalCallback, setInteractiveMode, ApprovalAction } from '../agent/utils/approval'
import { setClarifyCallback } from '../agent/tools/clarify-tool'
import { configureWebSearch } from '../agent/tools/web-tools'
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
 * 默认会话 ID（单会话向后兼容）
 */
const DEFAULT_SESSION_ID = '__default__'

/**
 * 手动触发后台压缩
 */
export function compressConversationHistory(sessionId: string = DEFAULT_SESSION_ID): boolean {
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
  compressor.requestCompression(sessionId)
  logger.info(`[AIAgentManager] 手动触发压缩: sessionId=${sessionId}`)
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
function loadAgentConfig(): (AgentConfig & { summaryModelConfig?: AgentConfig }) | null {
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

    const webSearch = configDAO.get('webSearch') as {
      provider: string
      apiUrl: string
      apiKey: string
    } | null
    if (webSearch && webSearch.apiUrl && webSearch.apiKey) {
      configureWebSearch(webSearch)
      logger.info('[AIAgentManager] webSearch 工具已配置:', webSearch.provider)
    } else {
      configureWebSearch(null)
      logger.info('[AIAgentManager] webSearch 工具未配置或配置不完整')
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

    return {
      provider: agentConfig.provider,
      apiUrl: agentConfig.apiUrl,
      apiKey: agentConfig.apiKey,
      model: agentConfig.model,
      maxIterations: agentConfig.maxIterations ?? 90,
      timeout: agentConfig.timeout ?? 600000,
      maxRetries: agentConfig.maxRetries ?? 3,
      contextLength: agentConfig.contextLength || undefined,
      accessModes: agentConfig.accessModes,
      summaryModelConfig: auxAgentConfig,
    }
  } catch (err) {
    logger.error('[AIAgentManager] 读取配置失败:', err)
    return null
  }
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

  const messages = DatabaseService.getInstance().getAgentMessageDAO().loadAllMessages()
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

  const messages = DatabaseService.getInstance().getAgentMessageDAO().loadAllMessages()
  if (messages.length === 0) {
    return { contextUsagePercent: 0 }
  }

  const tokenCount = estimateMessageTokens(messages)
  const contextLength = resolveContextLength(config.model, config.contextLength)
  const pct = contextLength > 0 ? (tokenCount / contextLength) * 100 : 0

  return { contextUsagePercent: Math.round(pct * 10) / 10 }
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
        break
      case 'tool_result': {
        let fullOutput = ''
        const msgs = agent.getMessages()
        const toolMsg = msgs.find(m => m.role === 'tool' && m.tool_call_id === event.data.toolCallId)
        if (toolMsg) {
          const c = toolMsg.content
          fullOutput = typeof c === 'string' ? (c ?? '') : ''
        }
        broadcast(IPC_CHANNELS.AGENT_TOOL_RESULT, {
          toolCallId: event.data.toolCallId as string,
          toolName: event.data.toolName as string,
          success: event.data.success as boolean,
          output: fullOutput,
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
  const activeSession = DatabaseService.getInstance().getSessionDAO().getActive()
  const nexusSessionId = activeSession?.id

  const agentOptions: AIAgentOptions = {
    ...config,
    nexusSessionId: nexusSessionId || undefined,
  }

  const agent = new AIAgent(agentOptions)
  const tools = createBuiltTools(agent.sessionState)
  agent.registerTools(tools)

  // 初始化 Skill 系统
  agent.initSkills()

  // 初始化 Task 系统
  agent.initTasks()

  setupEventBridge(agent)

  // 创建并启动后台压缩器
  const compressor = new BackgroundCompressor({
    mainModel: config.model,
    contextLength: config.contextLength,
    summaryModelConfig: config.summaryModelConfig,
    pollIntervalMs: 5000,
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
export function getOrCreateAIAgent(sessionId: string = DEFAULT_SESSION_ID): AIAgent | null {
  // 检查是否存在活跃的 Nexus 会话，没有则不启动智能体
  const activeSession = DatabaseService.getInstance().getSessionDAO().getActive()
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
  sessionId: string = DEFAULT_SESSION_ID,
): Promise<{ success: boolean; error?: string }> {
  try {
    const agent = getOrCreateAIAgent(sessionId)
    if (!agent) {
      return { success: false, error: 'AIAgent 未初始化，请检查 API 配置' }
    }
    if (agent.currentState === 'running') {
      return { success: false, error: 'Agent is currently running' }
    }

    // 根据 accessModes 决定调用方式：优先 invoke，不支持则降级 stream
    const config = loadAgentConfig()
    const accessModes = config?.accessModes ?? []
    const hasInvoke = accessModes.includes('invoke')
    const hasStream = accessModes.includes('stream')
    // 优先 invoke；仅 invoke 时 useStream=false；仅 stream 或两者都有时按 invoke 优先
    const useStream = !hasInvoke && hasStream

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
export function interruptAIAgent(sessionId: string = DEFAULT_SESSION_ID): void {
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
 * 查询 AIAgent 状态
 */
export function getAIAgentStatus(sessionId: string = DEFAULT_SESSION_ID): { state: AgentState; sessionId: string | null } {
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
export function resetAIAgent(sessionId: string = DEFAULT_SESSION_ID): void {
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

// ==================== 清除历史对话 IPC 处理器 ====================

/**
 * 设置清除历史对话的 IPC 处理器。
 * 在主窗口创建完成后调用，注册 IPC 监听器。
 */
export function setupClearHistoryHandler(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.AGENT_CLEAR_HISTORY, async () => {
    try {
      // 尝试从已有的 agent 实例清除
      const agent = agentSessions.get(DEFAULT_SESSION_ID)
      if (agent) {
        agent.clearHistory()
        broadcast(IPC_CHANNELS.AGENT_STATE_CHANGE, {
          state: agent.currentState,
          contextUsagePercent: 0,
        })
      } else {
        // agent 未创建时，直接删除数据库记录并重置内存状态
        const db = DatabaseService.getInstance()
        if (db) {
          db.getAgentMessageDAO().deleteAll()
          logger.info('[AIAgentManager] 已直接删除数据库中的对话历史')
        } else {
          logger.warn('[AIAgentManager] 数据库服务未初始化')
        }
      }

      logger.info('[AIAgentManager] 对话历史已清除')
      return { success: true }
    } catch (err) {
      logger.error('[AIAgentManager] 清除对话历史失败:', err)
      return { success: false, error: (err as Error).message }
    }
  })

  logger.info('[AIAgentManager] 清除历史对话 IPC 处理器已注册')
}
