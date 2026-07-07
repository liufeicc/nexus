/**
 * 渲染进程状态管理 - 类型定义
 */

import type { LayoutTree, LayoutChild, BrowserTab } from '@core/types'
import type { AttachedFile } from '@core/types/agent'

// 重新导出 core 中的布局类型，保持向后兼容
export type { LayoutTree, LayoutChild, PanelNode } from '@core/types'

/**
 * 面板类型
 */
export type PanelType = 'terminal' | 'file-browser' | 'browser'

/** 已打开的文件条目 */
export interface OpenFileEntry {
  /** 文件唯一标识（使用文件路径） */
  path: string
  /** 文件名 */
  name: string
  /** PDF/PPT 文件上次查看的页码（组件恢复时还原页码位置） */
  pdfPage?: number
  /** XLSX 文件上次查看的 Sheet 索引（仅 XLSX 文件使用） */
  xlsxSheet?: number
}

/**
 * 布局模式
 */
export type LayoutMode = 'horizontal' | 'vertical'

/**
 * 面板状态 — discriminated union，按 panelType 区分
 */

/** 所有面板的公共字段 */
interface BasePanel {
  id: string
  title: string
  /** 智能体联动：智能体是否正在运行 */
  agentRunning?: boolean
}

/** 终端面板 */
export interface TerminalPanel extends BasePanel {
  panelType: 'terminal'
  ptyId: string
  cwd?: string
  nexusConnected?: boolean
}

/** 文件浏览器面板 */
export interface FileBrowserPanel extends BasePanel {
  panelType: 'file-browser'
  rootPath?: string
  currentPath?: string
  viewMode?: 'grid' | 'list'
  openFiles?: OpenFileEntry[]
  activeFile?: string | null
  agentActiveFiles?: string[]
  nexusConnected?: boolean
}

/** 浏览器面板 */
export interface BrowserPanel extends BasePanel {
  panelType: 'browser'
  browserTabs: Map<string, BrowserTab>
  activeTabId: string | null
  nexusConnected?: boolean
}

/** 面板状态（渲染进程运行时使用） */
export type PanelState = TerminalPanel | FileBrowserPanel | BrowserPanel

/**
 * 应用状态接口
 */
export interface AppState {
  // 会话相关
  activeSessionId: string | null
  sessionIds: string[]

  // 面板相关
  panels: PanelState[]
  layout: LayoutTree | null // 布局树（v2.0）
  activePanelId: string | null // 当前选中的面板 ID

  // 会话面板缓存：每个会话独立维护面板状态
  sessionsPanels: Map<string, PanelState[]>
  sessionsLayouts: Map<string, LayoutTree | null>

  // UI 状态
  sidebarWidth: number
  sidebarCollapsed: boolean

  // 主题
  currentThemeId: string

  // 智能体
  agentEnabled: boolean

  // Nexus 连接状态（双轨独立：浏览器轨与数据轨可同时连接）
  nexusBrowserPanelId: string | null  // 浏览器轨连接的面板 ID
  nexusDataPanelId: string | null     // 数据轨连接的面板 ID（terminal 或 file-panel）

  // 设置模态框
  settingsModalVisible: boolean

  // 目录档案模态框
  nexusProfileModal: {
    visible: boolean
  }

  // 关于模态框
  aboutModalVisible: boolean

  // 右键菜单
  contextMenu: {
    visible: boolean
    x: number
    y: number
    selectedSessionId?: string // 选中的会话 ID（右键点击的会话）
    selectedPanelId?: string // 选中的面板 ID（右键点击的面板）
    hasTerminalSelection?: boolean // 终端是否有选中文本
    rightClickedFilePath?: string // 右键命中的文件路径（文件面板专用）
    rightClickedSelectedText?: string // 右键时捕获的编辑器选中文本
  } | null

  // 拖动状态（面板交换）
  draggingPanelId: string | null
  dropTargetPanelId: string | null

  // 模态框
  confirmModal: {
    visible: boolean
    title: string
    message: string
    onConfirm?: () => void
    onCancel?: () => void
    showCancel?: boolean // 是否显示取消按钮，默认 true；false 时为纯提示对话框（alert 模式）
  } | null

  renameModal: {
    visible: boolean
    sessionId?: string
    sessionName?: string
  } | null

  pathSelectorModal: {
    visible: boolean
    onConfirm?: (path: string) => void
    sessionId?: string // 关联的会话 ID
  } | null

  // 文件重命名模态框
  fileRenameModal: {
    visible: boolean
    filePath?: string // 完整文件路径
    fileName?: string // 当前文件名
    panelId?: string // 所属面板 ID，用于刷新目录
  } | null

  // 智能体交互式审批模态框
  approvalModal: {
    visible: boolean
    command: string
    description: string
    sessionKey: string
  } | null

  // 智能体 Clarify 提问模态框
  clarifyModal: {
    visible: boolean
    question: string
    choices: string[] | null
  } | null

  // 终端选区状态（用于 Ctrl+C 快捷键判断）
  hasTerminalSelection: boolean

  // 文件剪贴板状态（用于文件复制/粘贴）
  fileClipboard: { paths: string[]; mode: 'copy' | 'cut' } | null

  // 文件面板选中路径（以 panelId 为 key，每个面板独立维护选中集合）
  selectedFilePaths: Map<string, Set<string>>

  // Toast 提示
  toast: {
    message: string
    visible: boolean
  } | null

  // 截图占位图：key=browserPanelId, value=dataURL
  browserSnapshots: Map<string, string>

  // 文件附件：当前待发送的附件列表
  attachedFiles: AttachedFile[]

  // 动作
  setActiveSessionId: (id: string | null) => void
  setSessionIds: (ids: string[]) => void
  deleteSessionCache: (sessionId: string) => void
  setSidebarWidth: (width: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setCurrentThemeId: (themeId: string) => void
  setAgentEnabled: (enabled: boolean) => void
  setSettingsModalVisible: (visible: boolean) => void
  setAboutModalVisible: (visible: boolean) => void
  setNexusProfileModalVisible: (visible: boolean) => void

  // 面板动作
  addPanel: (panel: PanelState) => void
  removePanel: (panelId: string) => void
  updatePanelTitle: (panelId: string, title: string) => void
  setPanelsFromSnapshot: (panels: PanelState[], layout?: LayoutTree | null) => void
  setActivePanelId: (panelId: string | null) => void
  swapPanels: (panelId1: string, panelId2: string) => void // 交换两个面板的位置

  // 拖动状态动作
  setDraggingPanelId: (panelId: string | null) => void
  setDropTargetPanelId: (panelId: string | null) => void

  // 布局树动作（v2.0）
  setLayout: (layout: LayoutTree | null) => void
  splitPanel: (panelId: string, direction: 'horizontal' | 'vertical', newPanel: PanelState) => void
  updateLayoutFlex: (path: number[], flexValues: Record<number, number>) => void // 更新布局的 flex 比例

  // 快照动作：保存当前布局到数据库
  saveSnapshot: (sessionId: string, customLayout?: LayoutTree | null, customActivePanelId?: string | null) => Promise<void>

  // PTY 生命周期动作（统一管理 PTY 创建/销毁）
  createPanel: (cwd: string) => Promise<string> // 创建 PTY + 面板，返回新面板 ID
  splitPanelWithPty: (panelId: string, direction: 'horizontal' | 'vertical', cwd: string) => Promise<string> // 分屏，返回新面板 ID
  closePanel: (panelId: string) => Promise<void> // 终止 PTY + 移除面板
  restorePanelsFromData: (panelStates: Array<{ panelId: string; cwd?: string; title: string; panelType?: string; rootPath?: string; currentPath?: string; viewMode?: 'grid' | 'list'; url?: string; browserTabs?: BrowserTab[]; activeTabId?: string }>, layout?: LayoutTree | null) => Promise<void> // 从快照恢复（重建 PTY）

  // 文件面板生命周期动作
  createFilePanel: (rootPath: string) => Promise<string> // 创建文件面板，返回新面板 ID
  splitPanelWithFilePanel: (panelId: string, direction: 'horizontal' | 'vertical', rootPath: string) => Promise<string> // 分割出文件面板，返回新面板 ID
  updatePanelFileState: (panelId: string, updates: { openFiles?: OpenFileEntry[]; activeFile?: string | null }) => void // 更新文件面板的打开文件状态
  updatePanelCurrentPath: (panelId: string, currentPath: string) => void // 同步文件面板的当前路径
  updatePanelViewMode: (panelId: string, viewMode: 'grid' | 'list') => void // 更新文件面板的视图模式
  updatePanelCwd: (panelId: string, cwd: string) => void // 同步终端面板的工作目录

  // 智能体文件联动动作
  agentOpenFileInFilePanel: (filePath: string, fileName: string, action: 'create' | 'edit') => void // 智能体调用文件工具时，在文件面板打开预览
  agentClearFileActivity: () => void // 清除智能体文件活动标记

  // 浏览器面板生命周期动作
  createBrowserPanel: (url?: string) => Promise<string> // 创建浏览器面板，返回新面板 ID
  splitPanelWithBrowserPanel: (panelId: string, direction: 'horizontal' | 'vertical', url?: string) => Promise<string> // 分割出浏览器面板，返回新面板 ID
  addBrowserTab: (panelId: string, url?: string) => string // 添加新标签，返回 tabId
  registerBrowserTab: (panelId: string, tabId: string, url: string) => void // 注册主进程创建的标签（用于 window.open 拦截）
  closeBrowserTab: (panelId: string, tabId: string) => void // 关闭指定标签
  switchBrowserTab: (panelId: string, tabId: string) => void // 切换活动标签
  updateTabState: (panelId: string, tabId: string, patch: Partial<BrowserTab>) => void // 更新标签状态

  // 面板原地替换动作（替换面板类型，保持 ID 和布局位置不变）
  replacePanelInPlace: (panelId: string, updates: {
    panelType: PanelType
    title: string
    ptyId?: string
    cwd?: string
    rootPath?: string
    currentPath?: string
    viewMode?: 'grid' | 'list'
    openFiles?: OpenFileEntry[]
    activeFile?: string | null
    browserTabs?: Map<string, BrowserTab>
    activeTabId?: string | null
  }) => void

  // 右键菜单动作
  showContextMenu: (x: number, y: number, selectedSessionId?: string, selectedPanelId?: string, hasTerminalSelection?: boolean, rightClickedFilePath?: string, rightClickedSelectedText?: string) => void
  hideContextMenu: () => void

  // 模态框动作
  showConfirmModal: (title: string, message: string, onConfirm?: () => void, onCancel?: () => void) => void
  showAlertModal: (title: string, message: string) => void
  hideConfirmModal: () => void
  showRenameModal: (sessionId: string, sessionName: string) => void
  hideRenameModal: () => void
  showPathSelectorModal: (onConfirm?: (path: string) => void, sessionId?: string) => void
  hidePathSelectorModal: () => void
  showFileRenameModal: (filePath: string, panelId: string) => void
  hideFileRenameModal: () => void

  // 交互式审批模态框动作
  showApprovalModal: (command: string, description: string, sessionKey: string) => void
  hideApprovalModal: () => void

  // Clarify 提问模态框动作
  showClarifyModal: (question: string, choices: string[] | null) => void
  hideClarifyModal: () => void

  // Toast 提示
  showToast: (message: string, duration?: number) => void
  hideToast: () => void

  // 截图占位
  setBrowserSnapshot: (panelId: string, dataUrl: string | null) => void

  // 终端选区
  setTerminalSelection: (hasSelection: boolean) => void

  // 文件剪贴板
  setFileClipboard: (paths: string[] | null, mode?: 'copy' | 'cut') => void

  // 文件面板选中路径
  setSelectedFilePaths: (panelId: string, paths: Set<string>) => void

  // 文件附件动作
  addAttachedFile: (file: AttachedFile) => void
  removeAttachedFile: (id: string) => void
  clearAttachedFiles: () => void

  // Nexus 连接动作
  setNexusBrowserPanelId: (panelId: string | null) => void
  setNexusDataPanelId: (panelId: string | null) => void
}
