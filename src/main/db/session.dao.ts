/**
 * 会话数据访问层
 */

import Database from 'better-sqlite3'
import { MemoryDAO } from './memory.dao'

/**
 * 会话对象
 */
export interface SessionRow {
  id: string
  name: string
  created_at: number
  updated_at: number
  is_active: number
  last_used_at: number
}

/**
 * 会话对象 (应用层)
 */
export interface Session {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  isActive: boolean
  lastUsedAt?: number
}

/**
 * 会话数据访问类
 */
export class SessionDAO {
  private db: Database.Database
  private memoryDAO?: MemoryDAO

  constructor(db: Database.Database, memoryDAO?: MemoryDAO) {
    this.db = db
    this.memoryDAO = memoryDAO
  }

  /**
   * 转换数据库行为应用层会话对象
   */
  private mapRow(row: SessionRow): Session {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isActive: row.is_active === 1,
      lastUsedAt: row.last_used_at,
    }
  }

  /**
   * 获取下一个可用的会话编号
   * 从 1 开始查找，直到找到一个未被使用的序号
   * @returns 下一个会话编号
   */
  getNextSessionNumber(): number {
    const stmt = this.db.prepare('SELECT name FROM sessions')
    const rows = stmt.all() as SessionRow[]

    // 提取所有以 "new-shell-" 开头的名称，并解析序号
    const usedNumbers = new Set<number>()
    rows.forEach((row) => {
      const match = row.name.match(/^new-shell-(\d+)$/)
      if (match) {
        usedNumbers.add(parseInt(match[1], 10))
      }
    })

    // 从 1 开始查找第一个未被使用的序号
    let num = 1
    while (usedNumbers.has(num)) {
      num++
    }
    return num
  }

  /**
   * 创建新会话
   * @param name 会话名称，如果为空则自动生成
   * @returns 创建的会话对象
   */
  create(name?: string): Session {
    // 如果没有提供名称，自动生成
    const sessionName = name || `new-shell-${this.getNextSessionNumber()}`
    const now = Math.floor(Date.now() / 1000)
    const id = crypto.randomUUID()
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, name, created_at, is_active)
      VALUES (?, ?, ?, 0)
    `)
    stmt.run(id, sessionName, now)
    return this.getById(id)!
  }

  /**
   * 获取所有会话
   * @returns 会话列表
   */
  list(): Session[] {
    // 按创建时间倒序排序，最新创建的会话排在最前面
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC')
    const rows = stmt.all() as SessionRow[]
    return rows.map((row) => this.mapRow(row))
  }

  /**
   * 获取单个会话
   * @param id 会话 ID
   * @returns 会话对象，不存在返回 null
   */
  getById(id: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?')
    const row = stmt.get(id) as SessionRow | undefined
    if (!row) return null
    return this.mapRow(row)
  }

  /**
   * 更新会话名称
   * @param id 会话 ID
   * @param name 新名称
   */
  updateName(id: string, name: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET name = ?, updated_at = strftime('%s', 'now')
      WHERE id = ?
    `)
    stmt.run(name, id)
  }

  /**
   * 设置激活会话
   * @param id 会话 ID
   */
  setActive(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END,
          updated_at = strftime('%s', 'now'),
          last_used_at = strftime('%s', 'now')
      WHERE id = ? OR is_active = 1
    `)
    stmt.run(id, id)
  }

  /**
   * 删除会话（同时删除关联的快照和记忆数据）
   * @param id 会话 ID
   */
  delete(id: string): void {
    // 先删除关联的记忆数据
    this.memoryDAO?.deleteAllForSession(id)
    // 再删除关联的快照
    this.db.prepare('DELETE FROM session_snapshots WHERE session_id = ?').run(id)
    // 再删除会话
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?')
    stmt.run(id)
  }

  /**
   * 获取当前激活的会话
   * @returns 激活的会话对象，不存在返回 null
   */
  getActive(): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE is_active = 1 LIMIT 1')
    const row = stmt.get() as SessionRow | undefined
    if (!row) return null
    return this.mapRow(row)
  }

  /**
   * 获取最近使用的会话
   * @param limit 限制数量，默认 3
   * @returns 最近使用的会话列表，按 last_used_at 倒序排序（活动会话优先）
   */
  getRecent(limit: number = 3): Session[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      ORDER BY is_active DESC, last_used_at DESC, id DESC
      LIMIT ?
    `)
    const rows = stmt.all(limit) as SessionRow[]
    return rows.map((row) => this.mapRow(row))
  }

  /**
   * 更新会话的 last_used_at 时间
   * @param id 会话 ID
   */
  updateLastUsed(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET last_used_at = strftime('%s', 'now')
      WHERE id = ?
    `)
    stmt.run(id)
  }
}
