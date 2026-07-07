/**
 * SessionSnapshotDAO 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { SessionSnapshotDAO } from '../../src/main/db/snapshot.dao'
import { SessionDAO } from '../../src/main/db/session.dao'
import { createTestDatabase, cleanupDatabase } from '../setup'

// Mock crypto.randomUUID
let idCounter = 0
vi.mock('crypto', () => ({
  randomUUID: () => `snap-${++idCounter}`,
}))

describe('SessionSnapshotDAO', () => {
  let db: Database.Database
  let dao: SessionSnapshotDAO
  let sessionDao: SessionDAO

  beforeEach(() => {
    db = createTestDatabase()
    dao = new SessionSnapshotDAO(db)
    sessionDao = new SessionDAO(db)
    idCounter = 0
  })

  afterEach(() => {
    cleanupDatabase(db)
  })

  describe('save', () => {
    it('should save a snapshot and return id', () => {
      const session = sessionDao.create('test')
      const snapId = dao.save(session.id, {
        name: 'my-snapshot',
        layoutData: { type: 'panel', panelId: 'p1' } as any,
        activePanelId: 'p1',
        panelStates: [{ panelId: 'p1', cwd: '/home' }] as any,
      })

      expect(snapId).toBe('snap-1')
    })

    it('should replace previous snapshots for same session', () => {
      const session = sessionDao.create('test')
      
      dao.save(session.id, {
        layoutData: null,
        panelStates: [],
      })
      
      const secondId = dao.save(session.id, {
        layoutData: null,
        panelStates: [],
      })

      const snapshots = dao.listBySession(session.id)
      expect(snapshots.length).toBe(1)
      expect(snapshots[0].id).toBe(secondId)
    })

    it('should handle null layoutData', () => {
      const session = sessionDao.create('test')
      const snapId = dao.save(session.id, {
        layoutData: null,
        panelStates: [],
      })

      const snap = dao.getById(snapId)
      expect(snap!.layoutData).toBeNull()
    })

    it('should parse JSON layoutData', () => {
      const session = sessionDao.create('test')
      const layout = { type: 'split', direction: 'horizontal', children: [] }
      
      dao.save(session.id, {
        layoutData: layout as any,
        panelStates: [],
      })

      const snap = dao.getLatestBySession(session.id)
      expect(snap!.layoutData).toEqual(layout)
    })
  })

  describe('listBySession', () => {
    it('should return empty array when no snapshots', () => {
      const session = sessionDao.create('test')
      expect(dao.listBySession(session.id)).toEqual([])
    })

    it('should return snapshots ordered by saved_at DESC', () => {
      const session = sessionDao.create('test')
      
      // 手动插入多个快照
      const now = Math.floor(Date.now() / 1000)
      db.prepare(`
        INSERT INTO session_snapshots (id, session_id, name, layout_data, active_panel_id, panel_states, saved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('snap-old', session.id, 'old', '{}', null, '[]', now - 100)
      
      db.prepare(`
        INSERT INTO session_snapshots (id, session_id, name, layout_data, active_panel_id, panel_states, saved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('snap-new', session.id, 'new', '{}', null, '[]', now)

      const snapshots = dao.listBySession(session.id)
      expect(snapshots.length).toBe(2)
      expect(snapshots[0].id).toBe('snap-new')
      expect(snapshots[1].id).toBe('snap-old')
    })
  })

  describe('getById', () => {
    it('should return snapshot when exists', () => {
      const session = sessionDao.create('test')
      const snapId = dao.save(session.id, {
        name: 'test-snap',
        layoutData: null,
        panelStates: [],
      })

      const snap = dao.getById(snapId)
      expect(snap).not.toBeNull()
      expect(snap!.name).toBe('test-snap')
    })

    it('should return null when not exists', () => {
      expect(dao.getById('non-existent')).toBeNull()
    })

    it('should parse panelStates from JSON', () => {
      const session = sessionDao.create('test')
      const panelStates = [
        { panelId: 'p1', cwd: '/home' },
        { panelId: 'p2', cwd: '/tmp' },
      ]
      
      dao.save(session.id, {
        layoutData: null,
        panelStates: panelStates as any,
      })

      const snap = dao.getLatestBySession(session.id)
      expect(snap!.panelStates).toEqual(panelStates)
    })
  })

  describe('delete', () => {
    it('should delete a snapshot', () => {
      const session = sessionDao.create('test')
      const snapId = dao.save(session.id, {
        layoutData: null,
        panelStates: [],
      })

      dao.delete(snapId)
      expect(dao.getById(snapId)).toBeNull()
    })
  })

  describe('deleteBySession', () => {
    it('should delete all snapshots for a session', () => {
      const session = sessionDao.create('test')
      
      // 手动插入多个快照
      const now = Math.floor(Date.now() / 1000)
      db.prepare(`
        INSERT INTO session_snapshots (id, session_id, name, layout_data, active_panel_id, panel_states, saved_at)
        VALUES ('s1', ?, 'one', '{}', null, '[]', ?)
      `).run(session.id, now)
      
      db.prepare(`
        INSERT INTO session_snapshots (id, session_id, name, layout_data, active_panel_id, panel_states, saved_at)
        VALUES ('s2', ?, 'two', '{}', null, '[]', ?)
      `).run(session.id, now)

      dao.deleteBySession(session.id)
      expect(dao.listBySession(session.id)).toEqual([])
    })
  })

  describe('getLatestBySession', () => {
    it('should return the most recent snapshot', () => {
      const session = sessionDao.create('test')
      
      const now = Math.floor(Date.now() / 1000)
      db.prepare(`
        INSERT INTO session_snapshots (id, session_id, name, layout_data, active_panel_id, panel_states, saved_at)
        VALUES ('old', ?, 'old', '{}', null, '[]', ?)
      `).run(session.id, now - 100)
      
      db.prepare(`
        INSERT INTO session_snapshots (id, session_id, name, layout_data, active_panel_id, panel_states, saved_at)
        VALUES ('new', ?, 'new', '{}', null, '[]', ?)
      `).run(session.id, now)

      const latest = dao.getLatestBySession(session.id)
      expect(latest).not.toBeNull()
      expect(latest!.id).toBe('new')
      expect(latest!.name).toBe('new')
    })

    it('should return null when no snapshots', () => {
      const session = sessionDao.create('test')
      expect(dao.getLatestBySession(session.id)).toBeNull()
    })
  })
})
