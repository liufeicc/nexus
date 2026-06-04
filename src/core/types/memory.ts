/**
 * 记忆系统类型定义
 */

import { ToolDefinition, ToolResult } from './agent'

// ==================== 基础类型 ====================

/**
 * 单条记忆条目
 */
export interface MemoryEntry {
  /** 唯一标识 */
  id: string
  /** 记忆内容 */
  content: string
  /** 作用域：'memory' = MEMORY.md，'user' = USER.md */
  scope: 'memory' | 'user'
  /** 创建时间戳（秒） */
  createdAt: number
  /** 最后修改时间戳（秒） */
  updatedAt: number
}

/**
 * 记忆搜索结果（含评分信息）
 */
export interface MemorySearchResult extends MemoryEntry {
  /** 相关度评分（0-1） */
  score: number
  /** 被检索次数 */
  retrievalCount: number
  /** 信任评分 */
  trustScore: number
}

// ==================== MemoryProvider 抽象接口 ====================

/**
 * 记忆提供者抽象接口。
 *
 * 每个具体实现（文件式、SQLite 式等）都实现此接口。
 */
export interface MemoryProvider {
  /** 提供者标识（如 'file'、'sqlite'） */
  readonly name: string

  /** 初始化（创建文件、表等） */
  initialize(): Promise<void>

  /**
   * 返回注入 system prompt 的文本块。
   * 每次会话启动时调用一次（冻结快照）。
   */
  systemPromptBlock(): Promise<string>

  /**
   * 后台预取：基于当前查询预热缓存。
   * 会话启动时和每次 turn 结束后调用。
   */
  prefetch(query: string): Promise<void>

  /**
   * 将内存中的变更持久化到存储。
   * 每次 turn 结束后调用（非阻塞）。
   */
  sync(): Promise<void>

  /** 返回此提供者贡献的工具 schema */
  getToolSchemas(): ToolDefinition[]

  /** 处理发往此提供者的工具调用 */
  handleToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolResult>

  /** 清理资源（关闭文件句柄、数据库连接等） */
  shutdown(): Promise<void>
}

// ==================== 配置类型 ====================

/**
 * 记忆系统配置
 */
export interface MemoryConfig {
  /** MEMORY.md 最大字符数（默认 2200） */
  memoryMaxChars?: number
  /** USER.md 最大字符数（默认 1375） */
  userMaxChars?: number
}

/**
 * MemoryManager 配置（内部使用，含运行时依赖）
 */
export interface MemoryManagerConfig {
  /** MEMORY.md 最大字符数 */
  memoryMaxChars: number
  /** USER.md 最大字符数 */
  userMaxChars: number
}

// ==================== 会话状态 ====================

/**
 * 记忆会话状态（跟踪每轮同步状态）
 */
export interface MemorySessionState {
  /** 冻结快照内容 */
  frozenSnapshot: string | null
  /** 当前 turn 是否有未同步的变更 */
  dirty: boolean
  /** 最后一次预取查询 */
  lastPrefetchQuery: string | null
}
