/**
 * 会话快照数据访问层
 */

import Database from 'better-sqlite3'
import type { LayoutTree, SnapshotPanelState } from '../../core/types'

/**
 * 快照数据库行
 */
export interface SnapshotRow {
  id: string
  session_id: string
  name: string | null
  layout_data: string
  active_panel_id: string | null
  panel_states: string
  saved_at: number
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

/**
 * 快照数据访问类
 */
export class SessionSnapshotDAO {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  /**
   * 转换数据库行为应用层快照对象
   */
  private mapRow(row: SnapshotRow): Snapshot {
    return {
      id: row.id,
      sessionId: row.session_id,
      name: row.name,
      layoutData: JSON.parse(row.layout_data),
      activePanelId: row.active_panel_id,
      panelStates: JSON.parse(row.panel_states),
      savedAt: row.saved_at,
    }
  }

  /**
   * 保存会话快照（同一会话只保留最新一条，不保留历史）
   * @param sessionId 会话 ID
   * @param data 快照数据
   * @returns 创建的快照 ID
   */
  save(
    sessionId: string,
    data: {
      name?: string
      layoutData: LayoutTree | null
      activePanelId?: string
      panelStates: SnapshotPanelState[]
    }
  ): string {
    // 先删除该 session 的所有旧快照，只保留最新一条
    const deleteStmt = this.db.prepare(
      'DELETE FROM session_snapshots WHERE session_id = ?'
    )
    deleteStmt.run(sessionId)

    const id = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const stmt = this.db.prepare(`
      INSERT INTO session_snapshots
        (id, session_id, name, layout_data, active_panel_id, panel_states, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      id,
      sessionId,
      data.name || null,
      JSON.stringify(data.layoutData),
      data.activePanelId || null,
      JSON.stringify(data.panelStates),
      now
    )
    return id
  }

  /**
   * 获取会话的所有快照
   * @param sessionId 会话 ID
   * @returns 快照列表
   */
  listBySession(sessionId: string): Snapshot[] {
    const stmt = this.db.prepare(`
      SELECT * FROM session_snapshots
      WHERE session_id = ?
      ORDER BY saved_at DESC
    `)
    const rows = stmt.all(sessionId) as SnapshotRow[]
    return rows.map((row) => this.mapRow(row))
  }

  /**
   * 获取指定快照
   * @param id 快照 ID
   * @returns 快照对象，不存在返回 null
   */
  getById(id: string): Snapshot | null {
    const stmt = this.db.prepare('SELECT * FROM session_snapshots WHERE id = ?')
    const row = stmt.get(id) as SnapshotRow | undefined
    if (!row) return null
    return this.mapRow(row)
  }

  /**
   * 删除快照
   * @param id 快照 ID
   */
  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM session_snapshots WHERE id = ?')
    stmt.run(id)
  }

  /**
   * 删除会话的所有快照
   * @param sessionId 会话 ID
   */
  deleteBySession(sessionId: string): void {
    const stmt = this.db.prepare(
      'DELETE FROM session_snapshots WHERE session_id = ?'
    )
    stmt.run(sessionId)
  }

  /**
   * 获取会话的最新快照
   * @param sessionId 会话 ID
   * @returns 最新快照，不存在返回 null
   */
  getLatestBySession(sessionId: string): Snapshot | null {
    const stmt = this.db.prepare(`
      SELECT * FROM session_snapshots
      WHERE session_id = ?
      ORDER BY saved_at DESC
      LIMIT 1
    `)
    const row = stmt.get(sessionId) as SnapshotRow | undefined
    if (!row) return null
    return this.mapRow(row)
  }
}
