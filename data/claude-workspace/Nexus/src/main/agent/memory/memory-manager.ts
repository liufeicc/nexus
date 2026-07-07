/**
 * 记忆系统编排器
 *
 * 统一管理基于 SQLite 的记忆存储（MEMORY.md/USER.md 等价物 + 智能记忆 facts）。
 * 所有数据按 Nexus 会话 ID（sessions 表的 INTEGER id）隔离。
 *
 * 生命周期：
 * - Session Start: initializeAll() → loadAndFreezeSnapshot() → prefetch()
 * - Each Turn: handleToolCall() → syncAll() (turn-end) → prefetch()
 * - Session End: shutdownAll()
 */

import {
  MemoryManagerConfig,
  MemorySessionState,
} from '../../../core/types/memory'
import { ToolDefinition, ToolResult } from '../../../core/types/agent'
import { MemoryDAO } from '../../db/memory.dao'
import { DatabaseService } from '../../services/database.service'
import { logger } from '../../utils/logger'

// ==================== SqliteMemoryProvider ====================

/**
 * 基于 SQLite 的记忆提供者。
 *
 * 统一管理两类数据：
 * 1. memory_entries：等价于 MEMORY.md/USER.md，按 scope 区分
 * 2. memory_facts：智能记忆，支持 FTS5 全文检索
 *
 * 所有数据按 nexus_session_id 隔离。
 */
export class SqliteMemoryProvider {
  readonly name = 'sqlite'

  private dao: MemoryDAO | null = null
  private nexusSessionId: string
  private memoryMaxChars: number
  private userMaxChars: number
  private initialized = false
  private userProfileCache: string = ''

  constructor(config: MemoryManagerConfig, nexusSessionId: string) {
    this.nexusSessionId = nexusSessionId
    this.memoryMaxChars = config.memoryMaxChars
    this.userMaxChars = config.userMaxChars
  }

  private getDao(): MemoryDAO {
    if (!this.dao) {
      const db = DatabaseService.getInstance()
      if (!db) {
        throw new Error('[SqliteMemory] 数据库服务未初始化')
      }
      this.dao = db.getMemoryDAO()
    }
    return this.dao
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // 触发 DAO 初始化（确保表已创建）
    try {
      this.getDao()
      this.initialized = true
      logger.info(`[SqliteMemory] 已初始化 (nexusSession: ${this.nexusSessionId})`)
    } catch (err) {
      logger.warn('[SqliteMemory] 数据库未就绪，将延迟初始化:', err)
    }
  }

  /**
   * 构建 system prompt 中的记忆 block（只返回缓存的 user profile）。
   * memory scope 的内容不再全量注入，改为每轮按需检索。
   */
  async systemPromptBlock(): Promise<string> {
    if (!this.initialized || !this.userProfileCache) {
      return '## Memory\n\nNo persistent memory entries yet. Use memory_add to store important facts.'
    }

    return `## Memory\n\n### User Profile\n\n${this.userProfileCache}`
  }

  /**
   * 从数据库读取所有 scope=user 的 entries，缓存到内存。
   * 仅在会话启动时调用一次。
   */
  async loadUserProfileCache(): Promise<void> {
    if (!this.initialized) return

    const dao = this.getDao()
    const userEntries = dao.getEntries(this.nexusSessionId, 'user')

    if (userEntries.length > 0) {
      this.userProfileCache = userEntries.map(e => `§ ${e.content}`).join('\n\n')
      logger.info(`[SqliteMemory] 已缓存 ${userEntries.length} 条 user profile`)
    } else {
      this.userProfileCache = ''
    }
  }

  /**
   * 同步检索相关记忆（每轮对话前调用）。
   * 先 FTS5 搜索，无结果回退到 memory_entries 模糊匹配。
   * 返回格式化的 <memory-context> 字符串，无结果返回空字符串。
   */
  retrieveForTurn(query: string): string {
    if (!query || !this.initialized) return ''

    const dao = this.getDao()

    // 先尝试 FTS5 全文搜索
    let results = dao.searchFacts(this.nexusSessionId, query, 5)

    // FTS5 无结果时，回退到 memory_entries 模糊搜索
    if (results.length === 0) {
      const entries = dao.getEntries(this.nexusSessionId, 'memory')
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
      const matchedEntries = entries.filter(e =>
        terms.some(t => e.content.toLowerCase().includes(t))
      )
      if (matchedEntries.length === 0) return ''

      // 增加检索计数
      const matchedIds = matchedEntries.slice(0, 5).map(e => e.id)
      for (const id of matchedIds) {
        try { dao.incrementRetrievalCount(id, this.nexusSessionId) } catch { /* ignore */ }
      }

      const formatted = matchedEntries.slice(0, 5)
        .map((e, i) => `${i + 1}. ${e.content}`)
        .join('\n')

      return `<memory-context>\n[System note: The following is recalled memory context, NOT new user input.]\n\n${formatted}\n</memory-context>`
    }

    // FTS5 有结果
    for (const r of results) {
      dao.incrementRetrievalCount(r.id, this.nexusSessionId)
    }

    const formatted = results
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.content}`)
      .join('\n')

    return `<memory-context>\n[System note: The following is recalled memory context, NOT new user input.]\n\n${formatted}\n</memory-context>`
  }

  async prefetch(query: string): Promise<void> {
    if (!query || !this.initialized) return

    try {
      const dao = this.getDao()
      dao.searchFacts(this.nexusSessionId, query, 5)
    } catch {
      // 忽略预取失败
    }
  }

  async sync(): Promise<void> {
    // SQLite 写入是即时的，无需额外同步
  }

  getToolSchemas(): ToolDefinition[] {
    return [
      {
        name: 'memory_add',
        description: 'Add a new entry to persistent memory. MUST be called after EVERY file operation (create, write, edit, delete, rename, move) to record the action. Store file paths, operations performed, and key details so they can be recalled later. Also use for user preferences, project context, and facts worth remembering across sessions.',
        parameters: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The memory entry content. Include file paths, operations, and key details.',
            },
            scope: {
              type: 'string',
              enum: ['memory', 'user'],
              description: "Target store: 'memory' for general agent notes, 'user' for user profile. Default: 'memory'.",
            },
          },
          required: ['content'],
        },
        handler: (args) => this.handleAdd(args),
      },
      {
        name: 'memory_replace',
        description: 'Replace an existing memory entry with updated content. Provide the entry ID and the new content.',
        parameters: {
          type: 'object',
          properties: {
            entry_id: {
              type: 'string',
              description: 'The ID of the entry to replace.',
            },
            content: {
              type: 'string',
              description: 'The new content for this entry.',
            },
            scope: {
              type: 'string',
              enum: ['memory', 'user'],
              description: "Target store. Default: 'memory'.",
            },
          },
          required: ['entry_id', 'content'],
        },
        handler: (args) => this.handleReplace(args),
      },
      {
        name: 'memory_remove',
        description: 'Remove an entry from persistent memory by its ID.',
        parameters: {
          type: 'object',
          properties: {
            entry_id: {
              type: 'string',
              description: 'The ID of the entry to remove.',
            },
            scope: {
              type: 'string',
              enum: ['memory', 'user'],
              description: "Target store. Default: 'memory'.",
            },
          },
          required: ['entry_id'],
        },
        handler: (args) => this.handleRemove(args),
      },
      {
        name: 'memory_search',
        description: 'Search persistent memory for entries matching a query. Use when the user says "this file", "that file", or refers to a previous operation you performed. Also use to find any past actions, file changes, or remembered context.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query string. Use file names, operations, or keywords to find.',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return. Default: 5.',
            },
          },
          required: ['query'],
        },
        handler: (args) => this.handleSearch(args),
      },
    ]
  }

  async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    switch (toolName) {
      case 'memory_add': return this.handleAdd(args)
      case 'memory_replace': return this.handleReplace(args)
      case 'memory_remove': return this.handleRemove(args)
      case 'memory_search': return this.handleSearch(args)
      default:
        return { success: false, output: `Unknown memory tool: ${toolName}` }
    }
  }

  async shutdown(): Promise<void> {
    this.dao = null
    this.initialized = false
  }

  // ==================== 内部方法 ====================

  /**
   * 规范化 scope 值：仅接受 'memory' 或 'user'，其他一律回退到 'memory'
   * 防止 LLM 返回异常值（如 "memory">true"）污染数据库
   */
  private static normalizeScope(raw: unknown): 'memory' | 'user' {
    return raw === 'memory' || raw === 'user' ? raw : 'memory'
  }

  /**
   * 检查字符限制
   */
  private checkCharLimit(scope: 'memory' | 'user', newContent: string): { ok: boolean; limit: number; current: number } {
    const dao = this.getDao()
    const current = dao.countChars(this.nexusSessionId, scope)
    const limit = scope === 'user' ? this.userMaxChars : this.memoryMaxChars

    return { ok: current + newContent.length <= limit, limit, current }
  }

  // ==================== 工具处理器 ====================

  private async handleAdd(args: Record<string, unknown>): Promise<ToolResult> {
    const content = args.content as string
    if (!content || typeof content !== 'string') {
      return { success: false, output: 'memory_add 需要提供 content 参数' }
    }

    const scope = SqliteMemoryProvider.normalizeScope(args.scope)

    // 防重复检查：查找语义相似的已有条目
    try {
      const dao = this.getDao()
      const similar = dao.findSimilarEntry(this.nexusSessionId, content, 0.6)
      if (similar) {
        logger.info(
          `[SqliteMemory] 检测到重复条目 (相似度: ${(similar.similarity * 100).toFixed(0)}%)，拒绝写入`,
        )
        return {
          success: false,
          output: `存在语义相似的已有记忆 (相似度 ${(similar.similarity * 100).toFixed(0)}%, id: ${similar.entry.id.slice(0, 8)})。请使用 memory_replace 更新该条目，或选择不同内容。已有内容: "${similar.entry.content.slice(0, 80)}..."`,
          data: { duplicateId: similar.entry.id, similarity: similar.similarity },
        }
      }
    } catch {
      // 相似度检查失败不影响正常写入
    }

    const limitCheck = this.checkCharLimit(scope, content)

    if (!limitCheck.ok) {
      return {
        success: false,
        output: `Memory limit exceeded for scope "${scope}". `
          + `Current: ${limitCheck.current}/${limitCheck.limit} chars. `
          + `Use memory_replace to update existing entries or memory_remove to free space.`,
      }
    }

    try {
      const dao = this.getDao()
      const entryId = dao.insertEntry(this.nexusSessionId, content, scope)

      // 同时写入 memory_facts 以支持 FTS5 全文搜索
      try {
        dao.insertFact(content, this.nexusSessionId, entryId, 1.0, scope)
      } catch (err) {
        logger.error(`[SqliteMemory] insertFact 失败: ${err instanceof Error ? err.message : String(err)}`)
      }

      return {
        success: true,
        output: `Memory added (scope: ${scope}, id: ${entryId}). `
          + `Content: "${content.slice(0, 100)}${content.length > 100 ? '...' : ''}"`,
        data: { entryId, scope },
      }
    } catch (err) {
      return {
        success: false,
        output: `Memory add failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  private async handleReplace(args: Record<string, unknown>): Promise<ToolResult> {
    const entryId = args.entry_id as string
    const content = args.content as string
    if (!entryId || !content) {
      return { success: false, output: 'memory_replace 需要提供 entry_id 和 content 参数' }
    }

    const scope = SqliteMemoryProvider.normalizeScope(args.scope)

    try {
      const dao = this.getDao()

      // 1. 先更新 entry（失败则整体失败，fact 未被触碰）
      dao.updateEntry(entryId, content, this.nexusSessionId)

      // 2. 再同步 fact：删旧 + 插新
      try {
        dao.deleteFactByUuid(entryId, this.nexusSessionId)
      } catch (err) {
        logger.warn(`[SqliteMemory] replace 删旧 fact 失败: ${err instanceof Error ? err.message : String(err)}`)
      }

      try {
        dao.insertFact(content, this.nexusSessionId, entryId, 1.0, scope)
      } catch (err) {
        logger.error(`[SqliteMemory] replace 插新 fact 失败: ${err instanceof Error ? err.message : String(err)}`)
      }

      return {
        success: true,
        output: `Memory replaced (id: ${entryId}). New content: "${content.slice(0, 100)}${content.length > 100 ? '...' : ''}"`,
        data: { entryId, scope },
      }
    } catch (err) {
      return {
        success: false,
        output: `Memory replace failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  private async handleRemove(args: Record<string, unknown>): Promise<ToolResult> {
    const entryId = args.entry_id as string
    if (!entryId) {
      return { success: false, output: 'memory_remove 需要提供 entry_id 参数' }
    }

    const scope = SqliteMemoryProvider.normalizeScope(args.scope)

    try {
      const dao = this.getDao()
      dao.deleteEntry(entryId, this.nexusSessionId)

      // 同步删除 fact，失败不阻塞主流程
      try { dao.deleteFactByUuid(entryId, this.nexusSessionId) } catch { /* 忽略 */ }

      return {
        success: true,
        output: `Memory removed (id: ${entryId}).`,
        data: { entryId, scope },
      }
    } catch (err) {
      return {
        success: false,
        output: `Memory remove failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args.query as string
    if (!query || typeof query !== 'string') {
      return { success: false, output: 'memory_search 需要提供 query 参数' }
    }

    const limit = Math.min(Math.max(1, (args.limit as number) ?? 5), 20)

    try {
      const dao = this.getDao()
      let results = dao.searchFacts(this.nexusSessionId, query, limit)

      // FTS5 无结果时，回退到 memory_entries 模糊搜索
      if (results.length === 0) {
        const entries = dao.getEntries(this.nexusSessionId)
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
        const matchedEntries = entries.filter(e =>
          terms.some(t => e.content.toLowerCase().includes(t))
        )
        if (matchedEntries.length > 0) {
          const formatted = matchedEntries.slice(0, limit)
            .map((e, i) => `${i + 1}. [${e.id.slice(0, 8)}] ${e.content}`)
            .join('\n')
          return {
            success: true,
            output: `Found ${matchedEntries.length} result(s) for "${query}":\n\n${formatted}`,
            data: { results: matchedEntries, count: matchedEntries.length },
          }
        }
      }

      // 增加检索计数
      for (const r of results) {
        dao.incrementRetrievalCount(r.id, this.nexusSessionId)
      }

      if (results.length === 0) {
        return {
          success: true,
          output: `No memory entries match "${query}". Use memory_add to store relevant facts.`,
        }
      }

      const formatted = results
        .map((r, i) => `${i + 1}. [${r.id.slice(0, 8)}] (score: ${r.score.toFixed(2)}) ${r.content}`)
        .join('\n')

      return {
        success: true,
        output: `Found ${results.length} result(s) for "${query}":\n\n${formatted}`,
        data: { results, count: results.length },
      }
    } catch (err) {
      return {
        success: false,
        output: `Memory search failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }
}

// ==================== MemoryManager ====================

/**
 * 记忆系统编排器。
 *
 * 管理 SQLite 记忆 Provider，提供统一的初始化、快照、工具路由、同步和预取能力。
 */
export class MemoryManager {
  private provider: SqliteMemoryProvider
  private isInitialized = false
  private sessionState: MemorySessionState = {
    frozenSnapshot: null,
    dirty: false,
    lastPrefetchQuery: null,
  }

  constructor(config: MemoryManagerConfig, nexusSessionId: string) {
    this.provider = new SqliteMemoryProvider(config, nexusSessionId)
  }

  /**
   * 初始化 Provider
   */
  async initializeAll(): Promise<void> {
    if (this.isInitialized) return

    await this.provider.initialize()
    this.isInitialized = true
    logger.info('[MemoryManager] Provider 已初始化')
  }

  /**
   * 加载并冻结快照（会话启动时调用一次）
   * 只缓存 user profile，memory scope 改为每轮按需检索。
   */
  async loadAndFreezeSnapshot(): Promise<string> {
    await this.provider.loadUserProfileCache()
    const snapshot = await this.provider.systemPromptBlock()
    this.sessionState.frozenSnapshot = snapshot
    return snapshot
  }

  /**
   * 获取冻结快照
   */
  getFrozenSnapshot(): string | null {
    return this.sessionState.frozenSnapshot
  }

  /**
   * 同步检索相关记忆（每轮对话前调用）。
   * 先 FTS5 搜索，无结果回退到 memory_entries 模糊匹配。
   */
  retrieveForTurn(query: string): string {
    return this.provider.retrieveForTurn(query)
  }

  /**
   * 后台预取
   */
  async prefetch(query: string): Promise<void> {
    this.sessionState.lastPrefetchQuery = query
    this.provider.prefetch(query).catch(err =>
      logger.warn('[MemoryManager] Prefetch 失败:', err)
    )
  }

  /**
   * 处理工具调用
   */
  async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    return this.provider.handleToolCall(toolName, args)
  }

  /**
   * 非阻塞持久化（turn-end 调用）
   */
  async syncAll(): Promise<void> {
    await this.provider.sync()
  }

  /**
   * 会话结束时清理
   */
  async shutdownAll(): Promise<void> {
    await this.provider.shutdown()
    this.sessionState = { frozenSnapshot: null, dirty: false, lastPrefetchQuery: null }
    this.isInitialized = false
  }

  /**
   * 返回所有工具 schema
   */
  getAllToolSchemas(): ToolDefinition[] {
    return this.provider.getToolSchemas()
  }
}
