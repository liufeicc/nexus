/**
 * BrowserHistoryDAO 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { BrowserHistoryDAO } from '../../src/main/db/browser-history.dao'
import { createTestDatabase, cleanupDatabase } from '../setup'

describe('BrowserHistoryDAO', () => {
  let db: Database.Database
  let dao: BrowserHistoryDAO

  beforeEach(() => {
    db = createTestDatabase()
    dao = new BrowserHistoryDAO(db)
  })

  afterEach(() => {
    cleanupDatabase(db)
  })

  describe('save', () => {
    it('should save a new history entry', () => {
      dao.save('https://example.com', 'Example')
      const history = dao.list()
      expect(history).toHaveLength(1)
      expect(history[0].url).toBe('https://example.com')
      expect(history[0].title).toBe('Example')
    })

    it('should update existing URL (upsert by url)', () => {
      dao.save('https://example.com', 'Old Title')
      dao.save('https://example.com', 'New Title')

      const history = dao.list()
      expect(history).toHaveLength(1)
      expect(history[0].title).toBe('New Title')
    })

    it('should handle null/undefined title', () => {
      dao.save('https://example.com')
      const history = dao.list()
      expect(history[0].title).toBeNull()
    })

    it('should keep only last 500 entries', () => {
      for (let i = 0; i < 510; i++) {
        dao.save(`https://example.com/page${i}`, `Page ${i}`)
      }
      const history = dao.list(600)
      expect(history.length).toBeLessThanOrEqual(500)
    })

    it('should auto-delete oldest when exceeding 500', () => {
      for (let i = 0; i < 501; i++) {
        dao.save(`https://example.com/page${i}`, `Page ${i}`)
      }
      const history = dao.list(600)
      expect(history.length).toBe(500)
      // 最旧的 page0 应该被删除
      const urls = history.map(h => h.url)
      expect(urls).not.toContain('https://example.com/page0')
      expect(urls).toContain('https://example.com/page500')
    })
  })

  describe('list', () => {
    it('should return empty array when no history', () => {
      expect(dao.list()).toEqual([])
    })

    it('should order by visited_at DESC', () => {
      const now = Math.floor(Date.now() / 1000)
      db.prepare('INSERT INTO browser_history (id, url, title, visited_at) VALUES (?, ?, ?, ?)').run('h1', 'https://old.com', 'Old', now - 100)
      db.prepare('INSERT INTO browser_history (id, url, title, visited_at) VALUES (?, ?, ?, ?)').run('h2', 'https://new.com', 'New', now)

      const history = dao.list()
      expect(history[0].url).toBe('https://new.com')
      expect(history[1].url).toBe('https://old.com')
    })

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        dao.save(`https://example.com/${i}`, `Page ${i}`)
      }
      const history = dao.list(5)
      expect(history).toHaveLength(5)
    })

    it('should return entries with camelCase visitedAt', () => {
      dao.save('https://example.com', 'Test')
      const history = dao.list()
      expect(history[0].visitedAt).toBeGreaterThan(0)
    })
  })

  describe('delete', () => {
    it('should delete history by id', () => {
      dao.save('https://example.com', 'Test')
      const history = dao.list()
      const id = history[0].id

      dao.delete(id)
      expect(dao.list()).toHaveLength(0)
    })

    it('should not throw when deleting non-existent id', () => {
      expect(() => dao.delete('non-existent')).not.toThrow()
    })

    it('should not affect other entries', () => {
      dao.save('https://one.com', 'One')
      dao.save('https://two.com', 'Two')
      const history = dao.list()
      dao.delete(history[0].id)

      expect(dao.list()).toHaveLength(1)
    })
  })

  describe('clear', () => {
    it('should clear all history', () => {
      dao.save('https://one.com', 'One')
      dao.save('https://two.com', 'Two')
      dao.save('https://three.com', 'Three')

      dao.clear()
      expect(dao.list()).toEqual([])
    })

    it('should not throw when table is already empty', () => {
      expect(() => dao.clear()).not.toThrow()
    })
  })
})
