/**
 * InputHistoryDAO 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { InputHistoryDAO } from '../../src/main/db/input-history.dao'
import { createTestDatabase, cleanupDatabase } from '../setup'

describe('InputHistoryDAO', () => {
  let db: Database.Database
  let dao: InputHistoryDAO

  beforeEach(() => {
    db = createTestDatabase()
    dao = new InputHistoryDAO(db)
  })

  afterEach(() => {
    cleanupDatabase(db)
  })

  describe('add', () => {
    it('should add input history', () => {
      dao.add('hello world')
      const history = dao.list()
      expect(history).toHaveLength(1)
      expect(history[0].text).toBe('hello world')
    })

    it('should add multiple inputs', () => {
      dao.add('first')
      dao.add('second')
      dao.add('third')
      const history = dao.list()
      expect(history).toHaveLength(3)
    })

    it('should keep only last 50 inputs', () => {
      for (let i = 0; i < 60; i++) {
        dao.add(`input-${i}`)
      }
      const history = dao.list()
      expect(history).toHaveLength(50)
      expect(history[0].text).toBe('input-59')
      expect(history[49].text).toBe('input-10')
    })
  })

  describe('list', () => {
    it('should return empty array when no history', () => {
      expect(dao.list()).toEqual([])
    })

    it('should order by created_at DESC', () => {
      const now = Math.floor(Date.now() / 1000)
      db.prepare('INSERT INTO input_history (text, created_at) VALUES (?, ?)').run('old', now - 100)
      db.prepare('INSERT INTO input_history (text, created_at) VALUES (?, ?)').run('new', now)

      const history = dao.list()
      expect(history[0].text).toBe('new')
      expect(history[1].text).toBe('old')
    })

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        dao.add(`input-${i}`)
      }
      const history = dao.list(5)
      expect(history).toHaveLength(5)
    })
  })

  describe('delete', () => {
    it('should delete input by id', () => {
      dao.add('test')
      const history = dao.list()
      const id = history[0].id

      dao.delete(id)
      expect(dao.list()).toHaveLength(0)
    })

    it('should not throw when deleting non-existent id', () => {
      expect(() => dao.delete(99999)).not.toThrow()
    })
  })

  describe('clear', () => {
    it('should clear all history', () => {
      dao.add('one')
      dao.add('two')
      dao.add('three')

      dao.clear()
      expect(dao.list()).toEqual([])
    })
  })
})
