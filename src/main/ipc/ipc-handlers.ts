/**
 * IPC 处理器注册入口
 *
 * 各功能域的 IPC 处理器已拆分到 handlers/ 子目录中。
 * 本文件负责汇总注册并提供主窗口管理。
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'
import { PtyService } from '../services/pty.service'
import { NexusConnectionManager } from '../services/nexus-connection-manager'
import { BrowserViewService } from '../services/browser-view.service'

import { registerConfigHandlers } from './handlers/config'
import { registerSessionHandlers } from './handlers/session'
import { registerSnapshotHandlers } from './handlers/snapshot'
import { registerPtyHandlers } from './handlers/pty'
import { registerAppHandlers, registerPathHandlers } from './handlers/app'
import { registerWindowHandlers } from './handlers/window'
import { registerClipboardHandlers } from './handlers/clipboard'
import { registerFilesystemHandlers } from './handlers/filesystem'
import { registerFileWatcherHandlers, cleanupFileWatchers } from './handlers/file-watcher'
import { registerBrowserHandlers } from './handlers/browser'
import { registerBrowserDataHandlers } from './handlers/browser-data'
import { registerOperationHandlers } from './handlers/operation'
import { registerAgentHandlers } from './handlers/agent'
import { registerFileAttachmentHandlers } from './handlers/file-attachment'
import { registerNexusHandlers } from './handlers/nexus'
import { registerInputHistoryHandlers } from './handlers/input-history'
import { registerUpdateHandlers } from './handlers/update'
import { registerNexusProfileHandlers } from './handlers/nexus-profile'
import { TaskManager } from '../agent/tasks/task-manager'
import { SkillManager } from '../agent/skills/skill-manager'
import { DatabaseService } from '../services/database.service'

// 非 handle 频道（用 ipcMain.on 或 webContents.send 通信，不应 removeHandler）
const NON_HANDLE_CHANNELS: Set<string> = new Set([
  // 窗口事件（ipcMain.on）
  IPC_CHANNELS.WINDOW_MINIMIZE,
  IPC_CHANNELS.WINDOW_MAXIMIZE,
  IPC_CHANNELS.WINDOW_UNMAXIMIZE,
  IPC_CHANNELS.WINDOW_CLOSE,
  // 主进程 → 渲染进程事件（webContents.send）
  IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGED,
  IPC_CHANNELS.PTY_DATA,
  IPC_CHANNELS.FS_DIR_CHANGED,
  IPC_CHANNELS.FS_FILE_CHANGED,
  IPC_CHANNELS.BROWSER_NAVIGATING,
  IPC_CHANNELS.BROWSER_DID_NAVIGATE,
  IPC_CHANNELS.BROWSER_DID_NAVIGATE_IN_PAGE,
  IPC_CHANNELS.BROWSER_PAGE_TITLE_UPDATED,
  IPC_CHANNELS.BROWSER_PAGE_FAVICON_UPDATED,
  IPC_CHANNELS.BROWSER_CONTEXT_MENU,
  IPC_CHANNELS.BROWSER_WINDOW_OPEN,
  IPC_CHANNELS.AGENT_STREAMING,
  IPC_CHANNELS.AGENT_THINKING,
  IPC_CHANNELS.AGENT_TOOL_CALL,
  IPC_CHANNELS.AGENT_TOOL_RESULT,
  IPC_CHANNELS.AGENT_STATE_CHANGE,
  IPC_CHANNELS.AGENT_NEW_ITERATION,
  IPC_CHANNELS.AGENT_BACKGROUND_ACTIVITY,
  IPC_CHANNELS.AGENT_REQUEST_APPROVAL,
  IPC_CHANNELS.AGENT_APPROVAL_RESULT,
  IPC_CHANNELS.AGENT_CLARIFY,
  IPC_CHANNELS.AGENT_CLARIFY_RESULT,
  IPC_CHANNELS.NEXUS_CONNECTION_STATE_CHANGED,
  // 自动更新事件（webContents.send）
  IPC_CHANNELS.UPDATE_STATE,
  IPC_CHANNELS.UPDATE_ERROR,
])

let mainWindow: BrowserWindow | null = null

const getMainWindow = (): BrowserWindow | null => mainWindow

/**
 * 设置主窗口
 */
export function setMainWindow(window: BrowserWindow): void {
  mainWindow = window
  PtyService.getInstance().setMainWindow(window)
  NexusConnectionManager.getInstance().setMainWindow(window)
  BrowserViewService.getInstance()

  // 监听窗口最大化/还原事件，通知渲染进程
  window.on('maximize', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGED, true)
  })
  window.on('unmaximize', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGED, false)
  })
}

/**
 * 注册 IPC 处理器
 */
export function registerIpcHandlers(): void {
  // ===== 基础服务 =====
  registerConfigHandlers()
  registerSessionHandlers()
  registerSnapshotHandlers()
  registerPtyHandlers()

  // ===== 系统级 =====
  registerAppHandlers()
  registerPathHandlers()
  registerWindowHandlers(getMainWindow)
  registerClipboardHandlers()

  // ===== 文件系统 =====
  registerFilesystemHandlers()
  registerFileWatcherHandlers(getMainWindow)

  // ===== 浏览器 =====
  registerBrowserHandlers(getMainWindow)
  registerBrowserDataHandlers()

  // ===== 业务 =====
  registerOperationHandlers()
  registerAgentHandlers()
  registerFileAttachmentHandlers()
  registerNexusHandlers()
  registerInputHistoryHandlers()

  // ===== 自动更新 =====
  registerUpdateHandlers()

  // ===== 目录档案 NEXUS.md =====
  registerNexusProfileHandlers()

  // ===== Task 管理 =====
  let taskManager: TaskManager | null = null
  function getTaskManager(): TaskManager {
    if (!taskManager) {
      taskManager = new TaskManager()
    }
    return taskManager
  }

  ipcMain.handle(IPC_CHANNELS.TASK_LIST, () => {
    try {
      const tasks = getTaskManager().listTasks()
      return { success: true, tasks }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.TASK_VIEW, (_event, name: string) => {
    try {
      const content = getTaskManager().getTaskContent(name)
      return { success: true, content }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.TASK_MANAGE, (_event, args: { action: string; name?: string; content?: string }) => {
    try {
      const tm = getTaskManager()
      const { action, name, content } = args
      let result
      switch (action) {
        case 'create':
          result = name ? tm.createTask(name, content || '') : { success: false, message: '缺少 name 参数' }
          break
        case 'edit':
          result = (name && content) ? tm.editTask(name, content) : { success: false, message: '缺少 name 或 content 参数' }
          break
        case 'delete':
          result = name ? tm.deleteTask(name) : { success: false, message: '缺少 name 参数' }
          break
        default:
          result = { success: false, message: `未知操作: ${action}` }
      }
      return result
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  // ===== Skill 管理 =====
  let skillManager: SkillManager | null = null
  function getSkillManager(): SkillManager {
    if (!skillManager) {
      skillManager = new SkillManager()
    }
    return skillManager
  }

  ipcMain.handle(IPC_CHANNELS.SKILL_LIST, () => {
    try {
      const skills = getSkillManager().listSkills()
      return { success: true, skills }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SKILL_VIEW, (_event, name: string) => {
    try {
      const content = getSkillManager().getSkillContent(name)
      return { success: true, content }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SKILL_MANAGE, (_event, args: { action: string; name?: string; content?: string }) => {
    try {
      const sm = getSkillManager()
      const { action, name, content } = args
      let result
      switch (action) {
        case 'create':
          result = name ? sm.createSkill(name, content || '') : { success: false, message: '缺少 name 参数' }
          break
        case 'edit':
          result = (name && content) ? sm.editSkill(name, content) : { success: false, message: '缺少 name 或 content 参数' }
          break
        case 'delete':
          result = name ? sm.deleteSkill(name) : { success: false, message: '缺少 name 参数' }
          break
        default:
          result = { success: false, message: `未知操作: ${action}` }
      }
      return result
    } catch (error) {
      return { success: false, message: String(error) }
    }
  })

  // ===== Memory 记忆管理 =====
  ipcMain.handle(IPC_CHANNELS.MEMORY_LIST, () => {
    try {
      const activeSession = DatabaseService.getInstance().getSessionDAO().getActive()
      if (!activeSession) {
        return { success: false, error: '无活跃会话' }
      }
      const nexusSessionId = String(activeSession.id)
      const dao = DatabaseService.getInstance().getMemoryDAO()

      // 获取 memory_entries（手动记忆条目）
      const entries = dao.getEntries(nexusSessionId).map(e => ({
        ...e,
        source: 'entry' as const,
      }))

      // 获取 memory_facts（自动提取的事实）
      const facts = dao.getAllFacts(nexusSessionId, 100).map(f => ({
        id: f.id,
        content: f.content,
        scope: f.scope,
        source: 'fact' as const,
        trustScore: f.trustScore,
        retrievalCount: f.retrievalCount,
        createdAt: 0,
        updatedAt: 0,
      }))

      // 合并并去重：同一条内容在 entries 和 facts 中都有（共享 id），优先保留 entry
      type MemoryListItem = typeof entries[number] | typeof facts[number]
      const seen = new Map<string, MemoryListItem>()
      for (const fact of facts) {
        if (!seen.has(fact.id)) {
          seen.set(fact.id, fact)
        }
      }
      for (const entry of entries) {
        seen.set(entry.id, entry) // entry 覆盖 fact，因为 entry 有完整时间
      }
      const all = Array.from(seen.values()).sort((a, b) => b.createdAt - a.createdAt)

      return { success: true, memories: all }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_VIEW, (_event, id: string, source: string) => {
    try {
      const activeSession = DatabaseService.getInstance().getSessionDAO().getActive()
      if (!activeSession) {
        return { success: false, error: '无活跃会话' }
      }
      const nexusSessionId = String(activeSession.id)
      const dao = DatabaseService.getInstance().getMemoryDAO()

      if (source === 'entry') {
        const entries = dao.getEntries(nexusSessionId)
        const entry = entries.find(e => e.id === id)
        if (!entry) {
          return { success: false, error: '记忆条目不存在' }
        }
        return { success: true, memory: entry }
      } else {
        const fact = dao.getFact(id, nexusSessionId)
        if (!fact) {
          return { success: false, error: '记忆事实不存在' }
        }
        return { success: true, memory: { id, ...fact, scope: 'memory' as const } }
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_DELETE, (_event, id: string, source: string) => {
    try {
      const activeSession = DatabaseService.getInstance().getSessionDAO().getActive()
      if (!activeSession) {
        return { success: false, error: '无活跃会话' }
      }
      const nexusSessionId = String(activeSession.id)
      const dao = DatabaseService.getInstance().getMemoryDAO()

      // 同步删除 entry 和 fact，保持两表一致
      try { dao.deleteEntry(id, nexusSessionId) } catch { /* 可能不存在 */ }
      try { dao.deleteFact(id, nexusSessionId) } catch { /* 可能不存在 */ }
      return { success: true, message: '已删除' }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

}

/**
 * 清理 IPC 处理器
 */
export function unregisterIpcHandlers(): void {
  cleanupFileWatchers()

  for (const channel of Object.values(IPC_CHANNELS)) {
    if (!NON_HANDLE_CHANNELS.has(channel)) {
      ipcMain.removeHandler(channel)
    }
  }
}
