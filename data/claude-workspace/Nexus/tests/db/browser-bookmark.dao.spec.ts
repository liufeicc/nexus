/**
 * BrowserBookmarkDAO 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { BrowserBookmarkDAO } from '../../src/main/db/browser-bookmark.dao'
import { createTestDatabase, cleanupDatabase } from '../setup'

// Mock crypto.randomUUID
let idCounter = 0
vi.stubGlobal('crypto', {
  randomUUID: () => `bookmark-${++idCounter}`,
})

describe('BrowserBookmarkDAO', () => {
  let db: Database.Database
  let dao: BrowserBookmarkDAO

  beforeEach(() => {
    db = createTestDatabase()
    dao = new BrowserBookmarkDAO(db)
    idCounter = 0
  })

  afterEach(() => {
    cleanupDatabase(db)
  })

  describe('add', () => {
    it('should add a bookmark', () => {
      dao.add('https://example.com', 'Example')
      const bookmarks = dao.list()
      expect(bookmarks).toHaveLength(1)
      expect(bookmarks[0].url).toBe('https://example.com')
      expect(bookmarks[0].title).toBe('Example')
    })

    it('should auto-increment sortOrder', () => {
      dao.add('https://one.com', 'One')
      dao.add('https://two.com', 'Two')
      dao.add('https://three.com', 'Three')

      const bookmarks = dao.list()
      expect(bookmarks[0].sortOrder).toBe(1)
      expect(bookmarks[1].sortOrder).toBe(2)
      expect(bookmarks[2].sortOrder).toBe(3)
    })

    it('should update title when URL already exists', () => {
      dao.add('https://example.com', 'Old Title')
      dao.add('https://example.com', 'New Title')

      const bookmarks = dao.list()
      expect(bookmarks).toHaveLength(1)
      expect(bookmarks[0].title).toBe('New Title')
      // sortOrder should not change on update
      expect(bookmarks[0].sortOrder).toBe(1)
    })

    it('should handle special characters in URL', () => {
      dao.add('https://example.com/path?q=test&lang=zh', 'Search')
      const bookmarks = dao.list()
      expect(bookmarks[0].url).toBe('https://example.com/path?q=test&lang=zh')
    })
  })

  describe('list', () => {
    it('should return empty array when no bookmarks', () => {
      expect(dao.list()).toEqual([])
    })

    it('should order by sortOrder ASC', () => {
      db.prepare('INSERT INTO browser_bookmarks (id, url, title, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run('b1', 'https://c.com', 'C', 3, 1000)
      db.prepare('INSERT INTO browser_bookmarks (id, url, title, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run('b2', 'https://a.com', 'A', 1, 1000)
      db.prepare('INSERT INTO browser_bookmarks (id, url, title, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run('b3', 'https://b.com', 'B', 2, 1000)

      const bookmarks = dao.list()
      expect(bookmarks[0].url).toBe('https://a.com')
      expect(bookmarks[1].url).toBe('https://b.com')
      expect(bookmarks[2].url).toBe('https://c.com')
    })

    it('should return camelCase fields (sortOrder, createdAt)', () => {
      dao.add('https://example.com', 'Test')
      const bookmarks = dao.list()
      expect(bookmarks[0].sortOrder).toBeDefined()
      expect(bookmarks[0].createdAt).toBeDefined()
    })
  })

  describe('delete', () => {
    it('should delete bookmark by id', () => {
      dao.add('https://example.com', 'Test')
      const bookmarks = dao.list()
      const id = bookmarks[0].id

      dao.delete(id)
      expect(dao.list()).toHaveLength(0)
    })

    it('should not throw when deleting non-existent id', () => {
      expect(() => dao.delete('non-existent')).not.toThrow()
    })

    it('should not affect other bookmarks', () => {
      dao.add('https://one.com', 'One')
      dao.add('https://two.com', 'Two')
      const bookmarks = dao.list()

      dao.delete(bookmarks[0].id)
      const remaining = dao.list()
      expect(remaining).toHaveLength(1)
    })
  })

  describe('reorderAll', () => {
    it('should batch update sort orders', () => {
      dao.add('https://one.com', 'One')
      dao.add('https://two.com', 'Two')
      dao.add('https://three.com', 'Three')

      const bookmarks = dao.list()
      // 反转排序
      dao.reorderAll([
        { id: bookmarks[0].id, sortOrder: 30 },
        { id: bookmarks[1].id, sortOrder: 20 },
        { id: bookmarks[2].id, sortOrder: 10 },
      ])

      const reordered = dao.list()
      expect(reordered[0].id).toBe(bookmarks[2].id) // sortOrder=10
      expect(reordered[1].id).toBe(bookmarks[1].id) // sortOrder=20
      expect(reordered[2].id).toBe(bookmarks[0].id) // sortOrder=30
    })

    it('should handle empty array', () => {
      expect(() => dao.reorderAll([])).not.toThrow()
    })

    it('should run in transaction (atomic)', () => {
      dao.add('https://one.com', 'One')
      dao.add('https://two.com', 'Two')

      const bookmarks = dao.list()
      dao.reorderAll([
        { id: bookmarks[0].id, sortOrder: 99 },
        { id: bookmarks[1].id, sortOrder: 88 },
      ])

      const updated = dao.list()
      const bm1 = updated.find(b => b.id === bookmarks[0].id)
      const bm2 = updated.find(b => b.id === bookmarks[1].id)
      expect(bm1!.sortOrder).toBe(99)
      expect(bm2!.sortOrder).toBe(88)
    })
  })
})
