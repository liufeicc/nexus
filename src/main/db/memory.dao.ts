/**
 * 记忆数据访问层
 *
 * 统一管理 memory_entries（MEMORY.md/USER.md 等价物）和 memory_facts（智能记忆）。
 * 所有数据按 nexus_session_id（Nexus sessions 表的 INTEGER id）隔离。
 */

import Database from 'better-sqlite3'
import { MemorySearchResult } from '../../core/types/memory'

export class MemoryDAO {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  // ==================== Memory Entries（MEMORY.md/USER.md 等价物） ====================

  /**
   * 获取指定 Nexus 会话的所有记忆条目
   */
  getEntries(nexusSessionId: string, scope?: 'memory' | 'user'): Array<{
    id: string; content: string; scope: 'memory' | 'user'; createdAt: number; updatedAt: number
  }> {
    let sql = 'SELECT id, content, scope, created_at, updated_at FROM memory_entries WHERE nexus_session_id = ?'
    const params: unknown[] = [nexusSessionId]

    if (scope) {
      sql += ' AND scope = ?'
      params.push(scope)
    }

    sql += ' ORDER BY created_at ASC'

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string; content: string; scope: 'memory' | 'user'; created_at: number; updated_at: number
    }>

    return rows.map(r => ({
      id: r.id,
      content: r.content,
      scope: r.scope as 'memory' | 'user',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  }

  /**
   * 插入一条记忆条目
   */
  insertEntry(nexusSessionId: string, content: string, scope: 'memory' | 'user' = 'memory', id?: string): string {
    const entryId = id || generateId()
    const now = Math.floor(Date.now() / 1000)

    this.db.prepare(
      `INSERT INTO memory_entries (id, nexus_session_id, scope, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(entryId, nexusSessionId, scope, content, now, now)

    return entryId
  }

  /**
   * 更新记忆条目
   */
  updateEntry(id: string, content: string, nexusSessionId: string): void {
    const now = Math.floor(Date.now() / 1000)
    this.db.prepare(
      'UPDATE memory_entries SET content = ?, updated_at = ? WHERE id = ? AND nexus_session_id = ?'
    ).run(content, now, id, nexusSessionId)
  }

  /**
   * 删除记忆条目
   */
  deleteEntry(id: string, nexusSessionId: string): void {
    this.db.prepare(
      'DELETE FROM memory_entries WHERE id = ? AND nexus_session_id = ?'
    ).run(id, nexusSessionId)
  }

  /**
   * 计算指定 session + scope 的总字符数
   */
  countChars(nexusSessionId: string, scope: 'memory' | 'user'): number {
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(LENGTH(content)), 0) as total
       FROM memory_entries WHERE nexus_session_id = ? AND scope = ?`
    ).get(nexusSessionId, scope) as { total: number }

    return row.total
  }

  // ==================== Memory Facts（智能记忆） ====================

  /**
   * 插入一条事实
   */
  insertFact(content: string, nexusSessionId: string, id?: string, trustScore = 1.0, scope: 'memory' | 'user' = 'memory'): string {
    const factId = id || generateId()
    const now = Math.floor(Date.now() / 1000)

    this.db.prepare(
      `INSERT INTO memory_facts (id, nexus_session_id, content, source, scope, trust_score, created_at, updated_at)
       VALUES (?, ?, ?, 'agent', ?, ?, ?, ?)`
    ).run(factId, nexusSessionId, content, scope, trustScore, now, now)

    return factId
  }

  /**
   * 获取单个事实
   */
  getFact(id: string, nexusSessionId: string): {
    content: string; trustScore: number; retrievalCount: number; createdAt: number
  } | null {
    const row = this.db.prepare(
      'SELECT content, trust_score, retrieval_count, created_at FROM memory_facts WHERE id = ? AND nexus_session_id = ?'
    ).get(id, nexusSessionId) as { content: string; trust_score: number; retrieval_count: number; created_at: number } | undefined

    if (!row) return null

    return {
      content: row.content,
      trustScore: row.trust_score,
      retrievalCount: row.retrieval_count,
      createdAt: row.created_at,
    }
  }

  /**
   * 更新事实内容
   */
  updateFact(id: string, content: string, nexusSessionId: string): void {
    const now = Math.floor(Date.now() / 1000)
    this.db.prepare(
      'UPDATE memory_facts SET content = ?, updated_at = ? WHERE id = ? AND nexus_session_id = ?'
    ).run(content, now, id, nexusSessionId)
  }

  /**
   * 删除事实
   */
  deleteFact(id: string, nexusSessionId: string): void {
    this.db.prepare('DELETE FROM memory_facts WHERE id = ? AND nexus_session_id = ?').run(id, nexusSessionId)
  }

  /**
   * 按 uuid（entry_id）删除事实
   */
  deleteFactByUuid(uuid: string, nexusSessionId: string): void {
    this.db.prepare('DELETE FROM memory_facts WHERE id = ? AND nexus_session_id = ?').run(uuid, nexusSessionId)
  }

  /**
   * FTS5 全文搜索（按 nexus_session_id 过滤）
   */
  searchFacts(nexusSessionId: string, query: string, limit = 10): MemorySearchResult[] {
    const rows = this.db.prepare(
      `SELECT f.id, f.content, f.scope, f.trust_score, f.retrieval_count,
              f.created_at, f.updated_at,
              ft.rank as fts_rank
       FROM memory_facts f
       JOIN memory_facts_fts ft ON f.rowid = ft.rowid
       WHERE memory_facts_fts MATCH ? AND f.nexus_session_id = ?
       ORDER BY f.trust_score DESC, ft.rank ASC
       LIMIT ?`
    ).all(ftsQuery(query), nexusSessionId, limit) as Array<{
      id: string
      content: string
      scope: string
      trust_score: number
      retrieval_count: number
      created_at: number
      updated_at: number
      fts_rank: number
    }>

    return rows.map(row => ({
      id: row.id,
      content: row.content,
      scope: row.scope as 'memory' | 'user',
      score: normalizeScore(row.fts_rank),
      retrievalCount: row.retrieval_count,
      trustScore: row.trust_score,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  /**
   * 获取指定 session 的所有事实
   */
  getAllFacts(nexusSessionId: string, limit = 20): Array<{
    id: string; content: string; scope: 'memory' | 'user'; trustScore: number; retrievalCount: number
  }> {
    const rows = this.db.prepare(
      'SELECT id, content, scope, trust_score, retrieval_count FROM memory_facts WHERE nexus_session_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(nexusSessionId, limit) as Array<{
      id: string; content: string; scope: string; trust_score: number; retrieval_count: number
    }>

    return rows.map(r => ({
      id: r.id,
      content: r.content,
      scope: r.scope as 'memory' | 'user',
      trustScore: r.trust_score,
      retrievalCount: r.retrieval_count,
    }))
  }

  /**
   * 增加检索计数
   */
  incrementRetrievalCount(id: string, nexusSessionId: string): void {
    this.db.prepare(
      'UPDATE memory_facts SET retrieval_count = retrieval_count + 1 WHERE id = ? AND nexus_session_id = ?'
    ).run(id, nexusSessionId)
  }

  /**
   * 更新信任评分
   */
  updateTrustScore(id: string, score: number, nexusSessionId: string): void {
    this.db.prepare(
      'UPDATE memory_facts SET trust_score = MAX(0.0, MIN(1.0, ?)) WHERE id = ? AND nexus_session_id = ?'
    ).run(score, id, nexusSessionId)
  }

  /**
   * 查找内容相似的条目（防重复）
   * 使用分词 Jaccard 相似度，返回最高相似度及对应条目
   */
  findSimilarEntry(
    nexusSessionId: string,
    content: string,
    threshold = 0.6,
  ): { entry: { id: string; content: string; scope: string }; similarity: number } | null {
    const entries = this.db.prepare(
      'SELECT id, content, scope FROM memory_entries WHERE nexus_session_id = ? ORDER BY created_at DESC'
    ).all(nexusSessionId) as Array<{ id: string; content: string; scope: string }>

    const newWords = new Set(normalizeAndSplit(content))
    let best: { entry: { id: string; content: string; scope: string }; similarity: number } | null = null

    for (const entry of entries) {
      const existingWords = new Set(normalizeAndSplit(entry.content))
      const similarity = jaccardSimilarity(newWords, existingWords)
      if (similarity >= threshold && (!best || similarity > best.similarity)) {
        best = { entry, similarity }
      }
    }

    return best
  }

  /**
   * 删除指定 Nexus 会话的所有记忆数据
   */
  deleteAllForSession(nexusSessionId: string): void {
    this.db.prepare('DELETE FROM memory_entries WHERE nexus_session_id = ?').run(nexusSessionId)
    this.db.prepare('DELETE FROM memory_facts WHERE nexus_session_id = ?').run(nexusSessionId)
    // FTS 条目会通过 trigger 自动清理
  }
}

/**
 * 标准化文本并分词：转小写、去标点、按空格/标点分词、去停用词
 */
function normalizeAndSplit(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[，。、；：！？\s\n\r\t,.;:!?'"/\\\-_=+*&^%$#@~`()[\]{}<>（）【】《》]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1) // 过滤单字符
}

/**
 * 计算两个词集合的 Jaccard 相似度
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const word of a) {
    if (b.has(word)) intersection++
  }
  return intersection / (a.size + b.size - intersection)
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * 将 FTS 查询文本转为安全格式
 *
 * FTS5 MATCH 语法中的特殊字符需要转义：
 * - `:` 列名前缀运算符（如 column:term）
 * - `"` 短语定界符
 * - `-` 排除运算符
 * - `+` 必须包含运算符
 * - `*` 前缀匹配
 * - `AND`/`OR`/`NOT` 布尔运算符
 * - `()` 分组
 * - `^` 提升权重
 *
 * 使用双引号包裹整个查询，将输入作为字面短语搜索。
 */
function ftsQuery(query: string): string {
  // 移除 FTS5 特殊字符，保留语义内容
  const cleaned = query
    .replace(/["^()]/g, '')  // 删除引号、^、括号
    .replace(/[\"\*\s]+/g, ' ')  // 合并多余空白
    .trim()
    .slice(0, 200)

  if (!cleaned) return '""'

  // 用双引号包裹，作为字面短语搜索，避免 `:` 等被解析为运算符
  return `"${cleaned}"`
}

/**
 * 将 FTS rank 归一化为 0-1 评分
 */
function normalizeScore(rank: number): number {
  return Math.min(1, 1 / (1 + Math.abs(rank)))
}
