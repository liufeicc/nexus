/**
 * 渲染进程状态管理 - 入口
 *
 * 纯 re-export 文件，保持向后兼容。
 * 所有消费者文件无需修改。
 */

// 类型
export type {
  PanelType,
  OpenFileEntry,
  LayoutMode,
  PanelState,
  LayoutTree,
  LayoutChild,
  PanelNode,
} from './types'

// 布局操作
export { simplifyLayout, cleanupLayoutFlexValues } from './layout-ops'

// Store
export { useAppStore } from './store'

// 辅助函数
export { captureAllBrowsersBeforeModal, clearAllBrowserSnapshots } from './helpers'
