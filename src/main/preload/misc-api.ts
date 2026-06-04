/**
 * 杂项 API
 * 包含应用信息、平台检测、剪贴板、路径检查、窗口控制、
 * 操作记录、文件附件、任务/技能管理、输入历史、记忆管理、
 * 自动更新、目录档案、引导窗口等小型功能模块
 */

import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'

// ===== 应用信息 =====
export const app = {
  getPath: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PATH, name),
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
  getResourcePath: (filename: string) => ipcRenderer.invoke('app:get-resource-path', filename),
  getLocale: () => ipcRenderer.invoke('app:get-locale'),
}

// ===== 平台信息 =====
export const platform = {
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
}

// ===== 剪贴板 =====
export const clipboard = {
  readText: () => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_READ_TEXT),
  writeText: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_WRITE_TEXT, text),
  readFiles: () => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_READ_FILES),
}

// ===== 路径检查 =====
export const path = {
  exists: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.PATH_EXISTS, path),
  autocomplete: (input: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PATH_AUTOCOMPLETE, input),
}

// ===== 渲染进程内部事件（非 IPC） =====
/** 显示路径选择器（直接调用 store，不需要 IPC） */
export const showPathSelector = (onConfirm: (path: string) => void, sessionId?: string) => {
  // 存储回调到全局，供 Modal 组件使用
  const win = window as unknown as { __pathSelectorCallback?: (path: string) => void; __pathSelectorSessionId?: string }
  win.__pathSelectorCallback = onConfirm
  win.__pathSelectorSessionId = sessionId
  window.dispatchEvent(new CustomEvent('show-path-selector'))
}

// ===== 窗口控制 =====
export const minimizeWindow = () => {
  ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE)
}
export const maximizeWindow = () => {
  ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE)
}
export const unmaximizeWindow = () => {
  ipcRenderer.send(IPC_CHANNELS.WINDOW_UNMAXIMIZE)
}
export const closeWindow = () => {
  ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE)
}
/** 获取窗口是否最大化 */
export const isMaximized = () => {
  return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED)
}
/** 监听窗口最大化/还原事件 */
export const onMaximizedChanged = (callback: (isMaximized: boolean) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => {
    callback(isMaximized)
  }
  ipcRenderer.on(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGED, listener)
  return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGED, listener)
}

// ===== 操作记录 =====
export const operation = {
  /** 获取自上次读取后的新操作 */
  getNew: (sessionId: string, lastReadIndex: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.OPERATION_GET_NEW, sessionId, lastReadIndex),
  /** 按条件查询操作记录 */
  query: (sessionId: string, filter: { type?: string; panelId?: string; keyword?: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.OPERATION_QUERY, sessionId, filter),
  /** 获取最近 N 条操作 */
  getRecent: (sessionId: string, count: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.OPERATION_GET_RECENT, sessionId, count),
}

// ===== 文件附件 =====
export const fileAttachment = {
  /** 打开文件选择对话框 */
  openFileDialog: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_DIALOG_OPEN),
  /** 保存附件到临时目录 */
  attachFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_ATTACH, filePath),
  /** 读取文本文件内容 */
  readAsText: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_AS_TEXT, filePath),
  /** 读取文件为 base64 */
  readAsBase64: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_AS_BASE64, filePath),
  /** 检测文件类型 */
  detectType: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_DETECT_TYPE, filePath),
}

// ===== Task 任务管理 =====
export const task = {
  /** 获取任务列表 */
  list: () => ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST),
  /** 获取单个任务完整内容 */
  view: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.TASK_VIEW, name),
  /** 管理任务（创建/编辑/删除） */
  manage: (action: string, name?: string, content?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TASK_MANAGE, { action, name, content }),
}

// ===== Skill 技能管理 =====
export const skill = {
  /** 获取技能列表 */
  list: () => ipcRenderer.invoke(IPC_CHANNELS.SKILL_LIST),
  /** 获取单个技能完整内容 */
  view: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.SKILL_VIEW, name),
  /** 管理技能（创建/编辑/删除） */
  manage: (action: string, name?: string, content?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SKILL_MANAGE, { action, name, content }),
}

// ===== 输入历史 =====
export const inputHistory = {
  /** 保存一条输入历史 */
  add: (text: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.INPUT_HISTORY_ADD, text),
  /** 查询历史记录 */
  list: (limit?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.INPUT_HISTORY_LIST, limit),
  /** 删除单条记录 */
  delete: (id: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.INPUT_HISTORY_DELETE, id),
  /** 清空所有记录 */
  clear: () =>
    ipcRenderer.invoke(IPC_CHANNELS.INPUT_HISTORY_CLEAR),
}

// ===== 记忆管理 =====
export const memory = {
  /** 获取记忆列表（entries + facts） */
  list: () =>
    ipcRenderer.invoke(IPC_CHANNELS.MEMORY_LIST),
  /** 获取单条记忆详情 */
  view: (id: string, source: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MEMORY_VIEW, id, source),
  /** 删除记忆条目 */
  delete: (id: string, source: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.MEMORY_DELETE, id, source),
}

// ===== 自动更新 =====
export const update = {
  /** 检查更新 */
  checkForUpdate: () =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),
  /** 下载更新 */
  downloadUpdate: () =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD),
  /** 安装更新并重启 */
  installAndRestart: () =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL),
  /** 监听更新状态变更 */
  onUpdateState: (callback: (data: { state: string; version?: string; progress?: number; releaseNotes?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { state: string; version?: string; progress?: number; releaseNotes?: string }) =>
      callback(data)
    ipcRenderer.on(IPC_CHANNELS.UPDATE_STATE, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_STATE, listener)
  },
  /** 监听更新错误 */
  onUpdateError: (callback: (data: { error: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { error: string }) =>
      callback(data)
    ipcRenderer.on(IPC_CHANNELS.UPDATE_ERROR, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_ERROR, listener)
  },
}

// ===== 目录档案 NEXUS.md =====
export const nexusProfile = {
  /** 读取指定目录的 NEXUS.md */
  read: (dir: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NEXUS_PROFILE_READ, dir),
  /** 写入指定目录的 NEXUS.md */
  write: (dir: string, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NEXUS_PROFILE_WRITE, dir, content),
  /** 检查目录下是否存在 NEXUS.md */
  exists: (dir: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NEXUS_PROFILE_EXISTS, dir),
  /** 自动生成指定目录的 NEXUS.md */
  generate: (dir: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NEXUS_PROFILE_GENERATE, dir),
}

// ===== 引导窗口 =====
/** 引导完成：保存配置并创建主窗口 */
export const onboardingComplete = (agentConfig: any, subAgentConfig: any, emailConfig?: any) =>
  ipcRenderer.invoke('onboarding:complete', { agentConfig, subAgentConfig, emailConfig })
/** 跳过引导：直接创建主窗口 */
export const onboardingSkip = () =>
  ipcRenderer.invoke('onboarding:skip')
