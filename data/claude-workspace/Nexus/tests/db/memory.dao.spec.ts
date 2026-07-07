/**
 * MemoryDAO 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { MemoryDAO } from '../../src/main/db/memory.dao'
import { SessionDAO } from '../../src/main/db/session.dao'
import { createTestDatabase, cleanupDatabase } from '../setup'

// Mock crypto.randomUUID
let idCounter = 0
vi.stubGlobal('crypto', {
  randomUUID: () => `memory-${++idCounter}`,
})

describe('MemoryDAO', () => {
  let db: Database.Database
  let dao: MemoryDAO
  let sessionDao: SessionDAO

  beforeEach(() => {
    db = createTestDatabase()
    dao = new MemoryDAO(db)
    sessionDao = new SessionDAO(db)
    idCounter = 0
  })

  afterEach(() => {
    cleanupDatabase(db)
  })

  describe('insertEntry', () => {
    it('should insert a memory entry', () => {
      const session = sessionDao.create('test')
      const entryId = dao.insertEntry(session.id, 'Test memory content')

      expect(entryId).toBeTruthy()
      const entries = dao.getEntries(session.id)
      expect(entries).toHaveLength(1)
      expect(entries[0].content).toBe('Test memory content')
      expect(entries[0].scope).toBe('memory')
    })

    it('should insert with custom id', () => {
      const session = sessionDao.create('test')
      const entryId = dao.insertEntry(session.id, 'Test', 'memory', 'custom-id')

      expect(entryId).toBe('custom-id')
    })

    it('should insert user scope entry', () => {
      const session = sessionDao.create('test')
      dao.insertEntry(session.id, 'User preference', 'user')

      const entries = dao.getEntries(session.id, 'user')
      expect(entries).toHaveLength(1)
      expect(entries[0].scope).toBe('user')
    })

    it('should insert multiple entries', () => {
      const session = sessionDao.create('test')
      dao.insertEntry(session.id, 'First')
      dao.insertEntry(session.id, 'Second')
      dao.insertEntry(session.id, 'Third')

      const entries = dao.getEntries(session.id)
      expect(entries).toHaveLength(3)
    })

    it('should isolate entries by session', () => {
      const s1 = sessionDao.create('session1')
      const s2 = sessionDao.create('session2')

      dao.insertEntry(s1.id, 'Session 1 memory')
      dao.insertEntry(s2.id, 'Session 2 memory')

      expect(dao.getEntries(s1.id)).toHaveLength(1)
      expect(dao.getEntries(s2.id)).toHaveLength(1)
      expect(dao.getEntries(s1.id)[0].content).toBe('Session 1 memory')
    })
  })

  describe('getEntries', () => {
    it('should return empty array when no entries', () => {
      const session = sessionDao.create('test')
      expect(dao.getEntries(session.id)).toEqual([])
    })

    it('should filter by scope', () => {
      const session = sessionDao.create('test')
      dao.insertEntry(session.id, 'Memory 1', 'memory')
      dao.insertEntry(session.id, 'User 1', 'user')
      dao.insertEntry(session.id, 'Memory 2', 'memory')

      const memories = dao.getEntries(session.id, 'memory')
      expect(memories).toHaveLength(2)
      expect(memories.every(m => m.scope === 'memory')).toBe(true)

      const users = dao.getEntries(session.id, 'user')
      expect(users).toHaveLength(1)
      expect(users[0].scope).toBe('user')
    })

    it('should order by created_at ASC', () => {
      const session = sessionDao.create('test')
      const now = Math.floor(Date.now() / 1000)
      
      db.prepare('INSERT INTO memory_entries (id, nexus_session_id, scope, content, created_at) VALUES (?, ?, ?, ?, ?)').run('m1', session.id, 'memory', 'Old', now - 100)
      db.prepare('INSERT INTO memory_entries (id, nexus_session_id, scope, content, created_at) VALUES (?, ?, ?, ?, ?)').run('m2', session.id, 'memory', 'New', now)

      const entries = dao.getEntries(session.id)
      expect(entries[0].content).toBe('Old')
      expect(entries[1].content).toBe('New')
    })

    it('should return camelCase fields (createdAt, updatedAt)', () => {
      const session = sessionDao.create('test')
      dao.insertEntry(session.id, 'Test')

      const entries = dao.getEntries(session.id)
      expect(entries[0].createdAt).toBeDefined()
      expect(entries[0].updatedAt).toBeDefined()
    })
  })

  describe('updateEntry', () => {
    it('should update entry content', () => {
      const session = sessionDao.create('test')
      const entryId = dao.insertEntry(session.id, 'Original')
      
      dao.updateEntry(entryId, 'Updated', session.id)
      
      const entries = dao.getEntries(session.id)
      expect(entries[0].content).toBe('Updated')
    })

    it('should update updated_at timestamp', () => {
      const session = sessionDao.create('test')
      const entryId = dao.insertEntry(session.id, 'Original')
      
      const before = dao.getEntries(session.id)[0].updatedAt
      dao.updateEntry(entryId, 'Updated', session.id)
      const after = dao.getEntries(session.id)[0].updatedAt

      expect(after).toBeGreaterThanOrEqual(before)
    })

    it('should not affect other entries', () => {
      const session = sessionDao.create('test')
      const id1 = dao.insertEntry(session.id, 'First')
      const id2 = dao.insertEntry(session.id, 'Second')

      dao.updateEntry(id1, 'Changed', session.id)

      const entries = dao.getEntries(session.id)
      expect(entries.find(e => e.id === id1)!.content).toBe('Changed')
      expect(entries.find(e => e.id === id2)!.content).toBe('Second')
    })
  })

  describe('deleteEntry', () => {
    it('should delete entry by id', () => {
      const session = sessionDao.create('test')
      const entryId = dao.insertEntry(session.id, 'To delete')

      dao.deleteEntry(entryId, session.id)

      expect(dao.getEntries(session.id)).toHaveLength(0)
    })

    it('should not affect other entries', () => {
      const session = sessionDao.create('test')
      const id1 = dao.insertEntry(session.id, 'Keep')
      const id2 = dao.insertEntry(session.id, 'Delete')

      dao.deleteEntry(id2, session.id)

      const entries = dao.getEntries(session.id)
      expect(entries).toHaveLength(1)
      expect(entries[0].content).toBe('Keep')
    })
  })

  describe('countChars', () => {
    it('should return 0 when no entries', () => {
      const session = sessionDao.create('test')
      expect(dao.countChars(session.id, 'memory')).toBe(0)
    })

    it('should count total characters', () => {
      const session = sessionDao.create('test')
      dao.insertEntry(session.id, 'Hello', 'memory') // 5
      dao.insertEntry(session.id, 'World!', 'memory') // 6

      expect(dao.countChars(session.id, 'memory')).toBe(11)
    })

    it('should count by scope', () => {
      const session = sessionDao.create('test')
      dao.insertEntry(session.id, 'Memory', 'memory') // 6
      dao.insertEntry(session.id, 'User', 'user') // 4

      expect(dao.countChars(session.id, 'memory')).toBe(6)
      expect(dao.countChars(session.id, 'user')).toBe(4)
    })
  })

  describe('insertFact', () => {
    it('should insert a fact', () => {
      const session = sessionDao.create('test')
      const factId = dao.insertFact('User prefers TypeScript', session.id)

      expect(factId).toBeTruthy()
      const fact = dao.getFact(factId, session.id)
      expect(fact).not.toBeNull()
      expect(fact!.content).toBe('User prefers TypeScript')
    })

    it('should insert with custom id', () => {
      const session = sessionDao.create('test')
      const factId = dao.insertFact('Test fact', session.id, 'custom-fact-id')

      expect(factId).toBe('custom-fact-id')
    })

    it('should insert with custom trust score', () => {
      const session = sessionDao.create('test')
      const factId = dao.insertFact('Test', session.id, undefined, 0.8)

      const fact = dao.getFact(factId, session.id)
      expect(fact!.trustScore).toBe(0.8)
    })

    it('should insert with scope', () => {
      const session = sessionDao.create('test')
      const factId = dao.insertFact('User fact', session.id, undefined, 1.0, 'user')

      const fact = dao.getFact(factId, session.id)
      // getFact doesn't return scope, but we can verify via getAllFacts
      const allFacts = dao.getAllFacts(session.id)
      expect(allFacts[0].scope).toBe('user')
    })
  })

  describe('getFact', () => {
    it('should return fact when exists', () => {
      const session = sessionDao.create('test')
      const factId = dao.insertFact('Test fact', session.id)

      const fact = dao.getFact(factId, session.id)
      expect(fact).not.toBeNull()
      expect(fact!.content).toBe('Test fact')
      expect(fact!.trustScore).toBe(1.0)
      expect(fact!.retrievalCount).toBe(0)
    })

    it('should return null when not exists', () => {
      const session = sessionDao.create('test')
      expect(dao.getFact('nonexistent', session.id)).toBeNull()
    })

    it('should return camelCase fields', () => {
      const session = sessionDao.create('test')
      const factId = dao.insertFact('Test', session.id)

      const fact = dao.getFact(factId, session.id)
      expect(fact!.trustScore).toBeDefined()
      expect(fact!.retrievalCount).toBeDefined()
      expect(fact!.createdAt).toBeDefined()
    })
  })

  describe('updateFact', () => {
    it('should update fact content', () => {
      const session = sessionDao.create('test')
      const factId = dao.insertFact('Original', session.id)

      dao.updateFact(factId, 'Updated', session.id)

      const fact = dao.getFact(factId, session.id)
      expect(fact!.content).toBe('Updated')
    })
  })

  describe('deleteFact', () => {
    it('should delete fact by id', () => {
      const session = sessionDao.create('test')
      const factId = dao.insertFact('To delete', session.id)

      dao.deleteFact(factId, session.id)
      expect(dao.getFact(factId, session.id)).toBeNull()
    })
  })

  describe('getAllFacts', () => {
    it('should return empty array when no facts', () => {
      const session = sessionDao.create('test')
      expect(dao.getAllFacts(session.id)).toEqual([])
    })

    it('should return all facts for session', () => {
      const session = sessionDao.create('test')
      dao.insertFact('Fact 1', session.id)
      dao.insertFact('Fact 2', session.id)
      dao.insertFact('Fact 3', session.id)

      const facts = dao.getAllFacts(session.id)
      expect(facts).toHaveLength(3)
    })

    it('should respect limit parameter', () => {
      const session = sessionDao.create('test')
      for (let i = 0; i < 10; i++) {
        dao.insertFact(`Fact ${i}`, session.id)
      }

      const facts = dao.getAllFacts(session.id, 5)
      expect(facts).toHaveLength(5)
    })

    it('should return camelCase fields', () => {
      const session = sessionDao.create('test')
      dao.insertFact('Test', session.id)

      const facts = dao.getAllFacts(session.id)
      expect(facts[0].trustScore).toBeDefined()
      expect(facts[0].retrievalCount).toBeDefined()
    })
  })

  describe('searchFacts', () => {
    it('should search facts by keyword', () => {
      const session = sessionDao.create('test')
      dao.insertFact('User likes coffee', session.id)
      dao.insertFact('User prefers tea', session.id)
      dao.insertFact('Project uses TypeScript', session.id)

      const results = dao.searchFacts(session.id, 'coffee')
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.content.includes('coffee'))).toBe(true)
    })

    it('should return empty array when no match', () => {
      const session = sessionDao.create('test')
      dao.insertFact('Test fact', session.id)
      
      const results = dao.searchFacts(session.id, 'nonexistent')
      expect(results).toEqual([])
    })

    it('should limit results', () => {
      const session = sessionDao.create('test')
      for (let i = 0; i < 10; i++) {
        dao.insertFact(`Test fact ${i}`, session.id)
      }

      const results = dao.searchFacts(session.id, 'Test', 5)
      expect(results.length).toBeLessThanOrEqual(5)
    })

    it('should return score and trustScore', () => {
      const session = sessionDao.create('test')
      dao.insertFact('Test fact', session.id)

      const results = dao.searchFacts(session.id, 'Test')
      expect(results[0].score).toBeDefined()
      expect(results[0].trustScore).toBeDefined()
    })
  })

  describe('incrementRetrievalCount', () => {
    it('should increment retrieval count', () => {
      const session = sessionDao.create('test')
      const factId = dao.insertFact('Test', session.id)

      const before = dao.getFact(factId, session.id)!.retrievalCount
      dao.incrementRetrievalCount(factId, session.id)
      const after = dao.getFact(factId, session.id)!.retrievalCount

      expect(after).toBe(before + 1)
    })

    it('should increment multiple times', () => {
      const session = sessionDao.create('test')
      const factId = dao.insertFact('Test', session.id)

      dao.incrementRetrievalCount(factId, session.id)
      dao.incrementRetrievalCount(factId, session.id)
      dao.incrementRetrievalCount(factId, session.id)

      const fact = dao.getFact(factId, session.id)
      expect(fact!.retrievalCount).toBe(3)
    })
  })

  describe('updateTrustScore', () => {
    it('should update trust score', () => {
      const session = sessionDao.create('test')
      const factId = dao.insertFact('Test', session.id)

      dao.updateTrustScore(factId, 0.5, session.id)

      const fact = dao.getFact(factId, session.id)
      expect(fact!.trustScore).toBe(0.5)
    })

    it('should clamp score between 0 and 1', () => {
      const session = sessionDao.create('test')
      const factId = dao.insertFact('Test', session.id)

      dao.updateTrustScore(factId, 1.5, session.id)
      expect(dao.getFact(factId, session.id)!.trustScore).toBe(1.0)

      dao.updateTrustScore(factId, -0.5, session.id)
      expect(dao.getFact(factId, session.id)!.trustScore).toBe(0.0)
    })
  })

  describe('findSimilarEntry', () => {
    it('should find similar entry', () => {
      const session = sessionDao.create('test')
      dao.insertEntry(session.id, 'User prefers TypeScript programming')
      dao.insertEntry(session.id, 'User likes JavaScript')

      const result = dao.findSimilarEntry(session.id, 'User prefers TypeScript coding', 0.5)
      expect(result).not.toBeNull()
      expect(result!.similarity).toBeGreaterThan(0.5)
    })

    it('should return null when no similar entry', () => {
      const session = sessionDao.create('test')
      dao.insertEntry(session.id, 'Completely different content')

      const result = dao.findSimilarEntry(session.id, 'Nothing similar here', 0.8)
      expect(result).toBeNull()
    })

    it('should return null when no entries', () => {
      const session = sessionDao.create('test')
      const result = dao.findSimilarEntry(session.id, 'Test')
      expect(result).toBeNull()
    })
  })

  describe('deleteAllForSession', () => {
    it('should delete all entries and facts for session', () => {
      const session = sessionDao.create('test')
      dao.insertEntry(session.id, 'Entry 1')
      dao.insertEntry(session.id, 'Entry 2')
      dao.insertFact('Fact 1', session.id)
      dao.insertFact('Fact 2', session.id)

      dao.deleteAllForSession(session.id)

      expect(dao.getEntries(session.id)).toEqual([])
      expect(dao.getAllFacts(session.id)).toEqual([])
    })

    it('should not affect other sessions', () => {
      const s1 = sessionDao.create('session1')
      const s2 = sessionDao.create('session2')

      dao.insertEntry(s1.id, 'Session 1')
      dao.insertEntry(s2.id, 'Session 2')

      dao.deleteAllForSession(s1.id)

      expect(dao.getEntries(s1.id)).toEqual([])
      expect(dao.getEntries(s2.id)).toHaveLength(1)
    })
  })
})
