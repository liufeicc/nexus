/**
 * 会话快照类型定义
 */

import type { LayoutTree } from './layout'

/**
 * 快照/序列化数据中单个面板的状态
 * 用于 DB 存储和 PTY 重建（cwd、ptyId 是重建 PTY 的最小必需字段）
 */
export interface SnapshotPanelState {
  panelId: string
  panelType?: 'terminal' | 'file-browser' | 'browser'  // 可选，兼容旧快照
  ptyId?: string   // 终端面板需要，文件/浏览器面板不需要
  cwd?: string     // 终端面板的工作目录
  rootPath?: string  // 文件面板的根路径
  currentPath?: string  // 文件面板的当前路径
  url?: string  // 浏览器面板的当前 URL（向后兼容，新快照用 browserTabs）
  browserTabs?: Array<{ id: string; url: string; title: string; favicon?: string; isLoading: boolean }>  // 浏览器面板的标签列表
  activeTabId?: string | null  // 浏览器面板当前活动的标签 ID
  viewMode?: 'grid' | 'list'  // 文件面板的视图模式
  title: string
}

/**
 * 快照数据
 */
export interface SnapshotData {
  name?: string
  layoutData: LayoutTree | null
  activePanelId?: string
  panelStates: SnapshotPanelState[]
}

/**
 * 快照对象
 */
export interface Snapshot {
  id: string
  sessionId: string
  name: string | null
  layoutData: LayoutTree | null
  activePanelId: string | null
  panelStates: SnapshotPanelState[]
  savedAt: number
}
