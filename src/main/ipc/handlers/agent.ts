/**
 * AI 智能体 IPC 处理器
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { sendMessageToAIAgent, interruptAIAgent, getAIAgentStatus, compressConversationHistory, clearAgentHistory, getAgentContextUsage, loadConversationHistory, setAIAgentPlanMode, getAIAgentPlanMode } from '../../services/agent-service'
import { AttachedFile } from '../../../core/types/agent'

/**
 * 验证 sessionId 是否为合法非空字符串
 */
function validateSessionId(sessionId: unknown): sessionId is string {
  return typeof sessionId === 'string' && sessionId.length > 0
}

export function registerAgentHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AGENT_SEND_MESSAGE, (_event, content: string, attachments: AttachedFile[] | undefined, sessionId: string) => {
    if (!validateSessionId(sessionId)) {
      throw new Error('sessionId 不能为空')
    }
    return sendMessageToAIAgent(content, attachments, sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_INTERRUPT, (_event, sessionId: string) => {
    if (!validateSessionId(sessionId)) return
    interruptAIAgent(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_GET_STATUS, (_event, sessionId: string) => {
    if (!validateSessionId(sessionId)) return null
    return getAIAgentStatus(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_SET_PLAN_MODE, (_event, enabled: boolean, sessionId: string) => {
    if (!validateSessionId(sessionId)) return
    setAIAgentPlanMode(sessionId, enabled)
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_GET_PLAN_MODE, (_event, sessionId: string) => {
    if (!validateSessionId(sessionId)) return false
    return getAIAgentPlanMode(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_COMPRESS_HISTORY, (_event, sessionId: string) => {
    if (!validateSessionId(sessionId)) return { success: false }
    return { success: compressConversationHistory(sessionId) }
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_CLEAR_HISTORY, (_event, sessionId: string) => {
    if (!validateSessionId(sessionId)) return { success: false, message: 'sessionId 不能为空' }
    return clearAgentHistory(sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_GET_CONTEXT_USAGE, () => {
    return getAgentContextUsage()
  })

  ipcMain.handle(IPC_CHANNELS.AGENT_LOAD_HISTORY, (_event, sessionId: string) => {
    if (!validateSessionId(sessionId)) return []
    return loadConversationHistory(sessionId)
  })
}
