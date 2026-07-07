/**
 * 浏览器历史数据访问层
 */

import Database from 'better-sqlite3'

/**
 * 浏览器历史记录条目
 */
export interface BrowserHistoryEntry {
  id: string
  url: string
  title?: string
  visitedAt: number
}

/**
 * 浏览器历史 DAO 类
 * 所有浏览器面板共享同一份历史记录，最多保留 500 条，超出时自动删除最旧的记录
 */
export class BrowserHistoryDAO {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  /**
   * 保存一条浏览历史记录
   * 如果该 URL 已存在，只更新 visited_at 和 title；
   * 如果不存在，插入新记录。总数超过 500 条时自动删除最旧的记录。
   *
   * @param url - 访问的 URL
   * @param title - 页面标题（可选）
   */
  save(url: string, title?: string): void {
    const visitedAt = Math.floor(Date.now() / 1000)

    // 使用 UPSERT 语法：url 唯一键冲突时更新 visited_at 和 title
    this.db.prepare(
      `INSERT INTO browser_history (url, title, visited_at) VALUES (?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET title = excluded.title, visited_at = excluded.visited_at`
    ).run(url, title || null, visitedAt)

    // 如果总数超过 500 条，删除最旧的记录
    const { cnt } = this.db.prepare('SELECT COUNT(*) as cnt FROM browser_history').get() as { cnt: number }
    if (cnt > 500) {
      this.db.prepare(
        'DELETE FROM browser_history WHERE id = (SELECT id FROM browser_history ORDER BY visited_at ASC LIMIT 1)'
      ).run()
    }
  }

  /**
   * 查询历史记录（按访问时间降序排列）
   *
   * @param limit - 返回数量限制，默认 100
   * @returns 历史记录列表
   */
  list(limit: number = 100): BrowserHistoryEntry[] {
    const stmt = this.db.prepare(
      'SELECT id, url, title, visited_at as visitedAt FROM browser_history ORDER BY visited_at DESC LIMIT ?'
    )
    return stmt.all(limit) as BrowserHistoryEntry[]
  }

  /**
   * 删除一条历史记录
   *
   * @param id - 记录 ID
   */
  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM browser_history WHERE id = ?')
    stmt.run(id)
  }

  /**
   * 清空所有历史记录
   */
  clear(): void {
    const stmt = this.db.prepare('DELETE FROM browser_history')
    stmt.run()
  }
}
