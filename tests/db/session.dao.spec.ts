/**
 * SessionDAO 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { SessionDAO } from '../../src/main/db/session.dao'
import { createTestDatabase, cleanupDatabase } from '../setup'

// Mock crypto.randomUUID 以保证 ID 可控
vi.mock('crypto', () => ({
  randomUUID: () => `session-${Math.random().toString(36).slice(2, 9)}`,
}))

// Mock MemoryDAO（避免真实依赖）
const mockMemoryDAO = {
  deleteAllForSession: vi.fn(),
} as any

describe('SessionDAO', () => {
  let db: Database.Database
  let dao: SessionDAO

  beforeEach(() => {
    db = createTestDatabase()
    dao = new SessionDAO(db, mockMemoryDAO)
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanupDatabase(db)
  })

  describe('create', () => {
    it('should create a session with provided name', () => {
      const session = dao.create('my-session')
      expect(session.name).toBe('my-session')
      expect(session.id).toBeTruthy()
      expect(session.isActive).toBe(false)
      expect(session.createdAt).toBeGreaterThan(0)
    })

    it('should auto-generate session name when not provided', () => {
      const session = dao.create()
      expect(session.name).toMatch(/^new-shell-\d+$/)
    })

    it('should auto-increment session number', () => {
      const s1 = dao.create()
      const s2 = dao.create()
      expect(s1.name).toBe('new-shell-1')
      expect(s2.name).toBe('new-shell-2')
    })

    it('should reuse session number if deleted', () => {
      const s1 = dao.create()
      const s2 = dao.create()
      dao.delete(s1.id)
      const s3 = dao.create()
      expect(s3.name).toBe('new-shell-1')
      expect(s2.name).toBe('new-shell-2')
    })
  })

  describe('list', () => {
    it('should return empty list when no sessions', () => {
      expect(dao.list()).toEqual([])
    })

    it('should return all sessions ordered by created_at DESC', () => {
      const s1 = dao.create('first')
      // 手动增加 created_at 差异
      db.prepare('UPDATE sessions SET created_at = created_at + ? WHERE id = ?').run(1, s1.id)
      const s2 = dao.create('second')

      const list = dao.list()
      expect(list.length).toBe(2)
      // 最新的在前
      expect(list[0].id).toBe(s2.id)
      expect(list[1].id).toBe(s1.id)
    })
  })

  describe('getById', () => {
    it('should return session when exists', () => {
      const s = dao.create('test')
      const found = dao.getById(s.id)
      expect(found).not.toBeNull()
      expect(found!.name).toBe('test')
    })

    it('should return null when not exists', () => {
      expect(dao.getById('non-existent')).toBeNull()
    })
  })

  describe('updateName', () => {
    it('should update session name', () => {
      const s = dao.create('old')
      dao.updateName(s.id, 'new')
      expect(dao.getById(s.id)!.name).toBe('new')
    })
  })

  describe('setActive', () => {
    it('should set a session as active', () => {
      const s = dao.create('test')
      dao.setActive(s.id)
      const active = dao.getActive()
      expect(active).not.toBeNull()
      expect(active!.id).toBe(s.id)
      expect(active!.isActive).toBe(true)
    })

    it('should deactivate previous active session', () => {
      const s1 = dao.create('one')
      const s2 = dao.create('two')
      dao.setActive(s1.id)
      dao.setActive(s2.id)
      const active = dao.getActive()
      expect(active!.id).toBe(s2.id)

      const s1Updated = dao.getById(s1.id)
      expect(s1Updated!.isActive).toBe(false)
    })
  })

  describe('delete', () => {
    it('should delete a session', () => {
      const s = dao.create('to-delete')
      dao.delete(s.id)
      expect(dao.getById(s.id)).toBeNull()
    })

    it('should cascade delete snapshots', () => {
      const s = dao.create('with-snap')
      db.prepare(`
        INSERT INTO session_snapshots (id, session_id, name, layout_data, active_panel_id, panel_states, saved_at)
        VALUES ('snap1', ?, 'test', '{}', NULL, '[]', ?)
      `).run(s.id, Math.floor(Date.now() / 1000))

      dao.delete(s.id)

      const snap = db.prepare('SELECT * FROM session_snapshots WHERE id = ?').get('snap1')
      expect(snap).toBeUndefined()
    })

    it('should call memoryDAO.deleteAllForSession', () => {
      const s = dao.create('with-memory')
      dao.delete(s.id)
      expect(mockMemoryDAO.deleteAllForSession).toHaveBeenCalledWith(s.id)
    })
  })

  describe('getActive', () => {
    it('should return null when no active session', () => {
      expect(dao.getActive()).toBeNull()
    })

    it('should return the active session', () => {
      const s = dao.create()
      dao.setActive(s.id)
      const active = dao.getActive()
      expect(active).not.toBeNull()
      expect(active!.id).toBe(s.id)
    })
  })

  describe('getRecent', () => {
    it('should return recent sessions sorted by last_used_at DESC', () => {
      const s1 = dao.create('one')
      const s2 = dao.create('two')
      const s3 = dao.create('three')

      // 模拟使用时间
      db.prepare('UPDATE sessions SET last_used_at = 100 WHERE id = ?').run(s1.id)
      db.prepare('UPDATE sessions SET last_used_at = 300 WHERE id = ?').run(s3.id)
      db.prepare('UPDATE sessions SET last_used_at = 200 WHERE id = ?').run(s2.id)

      const recent = dao.getRecent(3)
      expect(recent.length).toBe(3)
      expect(recent[0].id).toBe(s3.id) // last_used_at=300
      expect(recent[1].id).toBe(s2.id) // last_used_at=200
      expect(recent[2].id).toBe(s1.id) // last_used_at=100
    })

    it('should respect the limit parameter', () => {
      dao.create('one')
      dao.create('two')
      dao.create('three')
      const recent = dao.getRecent(2)
      expect(recent.length).toBe(2)
    })

    it('should prefer active sessions', () => {
      const s1 = dao.create('one')
      const s2 = dao.create('two')
      dao.setActive(s2.id)
      db.prepare('UPDATE sessions SET last_used_at = 100 WHERE id = ?').run(s2.id)
      db.prepare('UPDATE sessions SET last_used_at = 300 WHERE id = ?').run(s1.id)

      const recent = dao.getRecent(2)
      // is_active DESC 优先
      expect(recent[0].id).toBe(s2.id)
    })
  })

  describe('updateLastUsed', () => {
    it('should update the last_used_at timestamp', () => {
      const s = dao.create()
      db.prepare('UPDATE sessions SET last_used_at = 100 WHERE id = ?').run(s.id)
      dao.updateLastUsed(s.id)
      const updated = dao.getById(s.id)
      expect(updated!.lastUsedAt).toBeGreaterThan(100)
    })
  })

  describe('getNextSessionNumber', () => {
    it('should return 1 when no sessions', () => {
      expect(dao.getNextSessionNumber()).toBe(1)
    })

    it('should skip used numbers', () => {
      // 手动插入占用的名字
      db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?, ?, ?)').run('id1', 'new-shell-1', 100)
      db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?, ?, ?)').run('id2', 'new-shell-2', 200)
      expect(dao.getNextSessionNumber()).toBe(3)
    })

    it('should find first gap', () => {
      db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?, ?, ?)').run('id1', 'new-shell-1', 100)
      db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?, ?, ?)').run('id3', 'new-shell-3', 300)
      expect(dao.getNextSessionNumber()).toBe(2)
    })

    it('should ignore non-matching session names', () => {
      db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?, ?, ?)').run('id1', 'custom-name', 100)
      expect(dao.getNextSessionNumber()).toBe(1)
    })
  })
})
