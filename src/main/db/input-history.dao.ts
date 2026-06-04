/**
 * 输入历史 DAO
 * 记录灵动岛用户输入历史，最多保留 50 条
 */

import Database from 'better-sqlite3'

/** 输入历史记录 */
export interface InputHistoryEntry {
  id: number
  text: string
  createdAt: number
}

/** 最大历史记录数 */
const MAX_HISTORY = 50

export class InputHistoryDAO {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  /**
   * 保存一条输入历史
   * 插入后若超过 MAX_HISTORY 条则自动删除最旧的一条
   */
  add(text: string): void {
    const createdAt = Math.floor(Date.now() / 1000)
    this.db.prepare(
      'INSERT INTO input_history (text, created_at) VALUES (?, ?)'
    ).run(text, createdAt)

    // 检查是否超出限制
    const { cnt } = this.db.prepare('SELECT COUNT(*) as cnt FROM input_history').get() as { cnt: number }
    if (cnt > MAX_HISTORY) {
      this.db.prepare(
        'DELETE FROM input_history WHERE id = (SELECT id FROM input_history ORDER BY created_at ASC LIMIT 1)'
      ).run()
    }
  }

  /**
   * 查询历史记录（按创建时间降序）
   */
  list(limit: number = MAX_HISTORY): InputHistoryEntry[] {
    const stmt = this.db.prepare(
      'SELECT id, text, created_at as createdAt FROM input_history ORDER BY created_at DESC LIMIT ?'
    )
    return stmt.all(limit) as InputHistoryEntry[]
  }

  /**
   * 删除单条记录
   */
  delete(id: number): void {
    this.db.prepare('DELETE FROM input_history WHERE id = ?').run(id)
  }

  /**
   * 清空所有记录
   */
  clear(): void {
    this.db.prepare('DELETE FROM input_history').run()
  }
}
