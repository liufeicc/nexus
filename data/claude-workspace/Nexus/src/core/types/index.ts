/**
 * 统一导出所有类型定义
 */

// 会话相关
export type { Session, CreateSessionParams, UpdateSessionParams } from './session'

// 面板相关
export type { PanelNode } from './pane'

// 布局相关
export type {
  LayoutContainerNode,
  LayoutChild,
  LayoutTree,
  SplitDirection,
} from './layout'

// 配置相关
export type {
  WindowStateConfig,
  CommonPathItem,
  TerminalConfig,
  ThemeConfig,
  ConfigMap,
  ConfigValueMap,
  ConfigKey,
  ConfigValue,
} from './config'

// 快照相关
export type { SnapshotData, Snapshot, SnapshotPanelState } from './snapshot'

// 浏览器相关
export type { BrowserTab } from './browser'
export type { BrowserHistoryEntry } from '../../main/db/browser-history.dao'
export type { Bookmark } from '../../main/db/browser-bookmark.dao'

// 记忆系统相关
export type {
  MemoryEntry,
  MemorySearchResult,
  MemoryProvider,
  MemoryConfig,
  MemoryManagerConfig,
  MemorySessionState,
} from './memory'

// Skill 系统相关
export type {
  SkillFrontmatter,
  ParsedSkill,
  SkillMeta,
  SkillContent,
  SkillManageAction,
  SkillManageResult,
  SecurityScanResult,
} from './skill'

// Task 系统相关
export type {
  ParsedTask,
  TaskMeta,
  TaskContent,
  TaskManageAction,
  TaskManageResult,
} from './task'

// 智能体相关
export type {
  AgentConfig,
  AgentMessage,
  AttachedFile,
  ContentBlock,
  ToolCall,
  MessageRole,
  ToolParameterProperty,
  ToolParameters,
  ToolDefinition,
  ToolResult,
  AgentState,
  AgentEvent,
  AgentEventType,
  AgentEventCallback,
  McpServerConfig,
  ContextCompressorConfig,
} from './agent'
