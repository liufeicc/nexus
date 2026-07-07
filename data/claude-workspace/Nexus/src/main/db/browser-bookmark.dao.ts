/**
 * 浏览器书签数据访问层
 */

import Database from 'better-sqlite3'

/**
 * 浏览器书签
 */
export interface Bookmark {
  id: string
  url: string
  title: string
  sortOrder: number
  createdAt: number
}

/**
 * 浏览器书签 DAO 类
 * 所有浏览器面板共享同一份书签
 */
export class BrowserBookmarkDAO {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  /**
   * 添加一条书签
   * 如果该 URL 已存在，只更新 title；
   * 如果不存在，插入新记录，sortOrder 取当前最大值 + 1。
   *
   * @param url - 书签 URL
   * @param title - 页面标题
   */
  add(url: string, title: string): void {
    const createdAt = Math.floor(Date.now() / 1000)

    // 先查询是否已存在
    const existing = this.db.prepare('SELECT id, sort_order FROM browser_bookmarks WHERE url = ?').get(url) as { id: string; sort_order: number } | undefined
    if (existing) {
      this.db.prepare('UPDATE browser_bookmarks SET title = ? WHERE url = ?').run(title, url)
      return
    }

    // 取当前最大 sortOrder + 1
    const maxOrder = this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) as maxOrder FROM browser_bookmarks').get() as { maxOrder: number }
    const sortOrder = maxOrder.maxOrder + 1

    this.db.prepare(
      'INSERT INTO browser_bookmarks (id, url, title, sort_order, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), url, title, sortOrder, createdAt)
  }

  /**
   * 查询所有书签（按 sort_order 升序排列）
   *
   * @returns 书签列表
   */
  list(): Bookmark[] {
    const stmt = this.db.prepare(
      'SELECT id, url, title, sort_order as sortOrder, created_at as createdAt FROM browser_bookmarks ORDER BY sort_order ASC'
    )
    return stmt.all() as Bookmark[]
  }

  /**
   * 删除一条书签
   *
   * @param id - 书签 ID
   */
  delete(id: string): void {
    this.db.prepare('DELETE FROM browser_bookmarks WHERE id = ?').run(id)
  }

  /**
   * 批量更新书签排序
   * 用于拖动排序后保存结果
   *
   * @param bookmarks - [{ id, sortOrder }, ...]
   */
  reorderAll(bookmarks: { id: string; sortOrder: number }[]): void {
    const stmt = this.db.prepare('UPDATE browser_bookmarks SET sort_order = ? WHERE id = ?')
    const run = this.db.transaction((items) => {
      for (const item of items) {
        stmt.run(item.sortOrder, item.id)
      }
    })
    run(bookmarks)
  }
}
