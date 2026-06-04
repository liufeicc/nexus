/**
 * ModelCatalogDAO 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { ModelCatalogDAO, ModelCatalogItem } from '../../src/main/db/model-catalog.dao'
import { createTestDatabase, cleanupDatabase } from '../setup'

/** 创建测试用的模型条目 */
function makeModel(overrides: Partial<ModelCatalogItem> = {}): ModelCatalogItem {
  return {
    id: 1,
    displayName: 'Test Model',
    modelName: 'test-model',
    provider: 'test',
    interfaceType: 'openai',
    defaultApiUrl: 'https://api.test.com/v1',
    contextLength: 4096,
    description: null,
    sortWeight: 10,
    ...overrides,
  }
}

describe('ModelCatalogDAO', () => {
  let db: Database.Database
  let dao: ModelCatalogDAO

  beforeEach(() => {
    db = createTestDatabase()
    dao = new ModelCatalogDAO(db)
  })

  afterEach(() => {
    cleanupDatabase(db)
  })

  describe('add', () => {
    it('should insert a new model and return it', () => {
      const item = makeModel()
      const result = dao.add(item)

      expect(result.id).toBe(1)
      expect(result.displayName).toBe('Test Model')
      expect(result.modelName).toBe('test-model')
      expect(result.provider).toBe('test')
      expect(result.interfaceType).toBe('openai')
      expect(result.contextLength).toBe(4096)
    })

    it('should handle null description', () => {
      const item = makeModel({ description: null })
      const result = dao.add(item)
      expect(result.description).toBeNull()
    })

    it('should handle non-null description', () => {
      const item = makeModel({ description: 'A test model' })
      const result = dao.add(item)
      expect(result.description).toBe('A test model')
    })

    it('should throw on duplicate id', () => {
      dao.add(makeModel({ id: 1 }))
      expect(() => dao.add(makeModel({ id: 1 }))).toThrow()
    })
  })

  describe('getAll', () => {
    it('should return empty array when no models', () => {
      expect(dao.getAll()).toEqual([])
    })

    it('should order by sort_weight ASC', () => {
      dao.add(makeModel({ id: 1, sortWeight: 30 }))
      dao.add(makeModel({ id: 2, sortWeight: 10 }))
      dao.add(makeModel({ id: 3, sortWeight: 20 }))

      const models = dao.getAll()
      expect(models[0].id).toBe(2) // sortWeight=10
      expect(models[1].id).toBe(3) // sortWeight=20
      expect(models[2].id).toBe(1) // sortWeight=30
    })
  })

  describe('getAllIncludeDisabled', () => {
    it('should return same result as getAll', () => {
      dao.add(makeModel({ id: 1 }))
      dao.add(makeModel({ id: 2 }))

      expect(dao.getAllIncludeDisabled()).toEqual(dao.getAll())
    })
  })

  describe('getById', () => {
    it('should return model when exists', () => {
      dao.add(makeModel({ id: 42, displayName: 'My Model' }))
      const result = dao.getById(42)
      expect(result).not.toBeNull()
      expect(result!.displayName).toBe('My Model')
    })

    it('should return null when not exists', () => {
      expect(dao.getById(999)).toBeNull()
    })
  })

  describe('getByProvider', () => {
    it('should filter by provider', () => {
      dao.add(makeModel({ id: 1, provider: 'openai' }))
      dao.add(makeModel({ id: 2, provider: 'anthropic' }))
      dao.add(makeModel({ id: 3, provider: 'openai' }))

      const openai = dao.getByProvider('openai')
      expect(openai).toHaveLength(2)
      expect(openai.every(m => m.provider === 'openai')).toBe(true)

      const anthropic = dao.getByProvider('anthropic')
      expect(anthropic).toHaveLength(1)
    })

    it('should return empty array when no match', () => {
      dao.add(makeModel({ id: 1, provider: 'test' }))
      expect(dao.getByProvider('nonexistent')).toEqual([])
    })

    it('should order results by sort_weight ASC', () => {
      dao.add(makeModel({ id: 1, provider: 'test', sortWeight: 50 }))
      dao.add(makeModel({ id: 2, provider: 'test', sortWeight: 10 }))

      const models = dao.getByProvider('test')
      expect(models[0].id).toBe(2)
      expect(models[1].id).toBe(1)
    })
  })

  describe('update', () => {
    it('should update displayName', () => {
      dao.add(makeModel({ id: 1 }))
      const result = dao.update(1, { displayName: 'Updated Name' })
      expect(result).not.toBeNull()
      expect(result!.displayName).toBe('Updated Name')
    })

    it('should update multiple fields', () => {
      dao.add(makeModel({ id: 1 }))
      const result = dao.update(1, {
        displayName: 'New Name',
        contextLength: 128000,
        description: 'Updated',
      })
      expect(result!.displayName).toBe('New Name')
      expect(result!.contextLength).toBe(128000)
      expect(result!.description).toBe('Updated')
    })

    it('should return null when updating non-existent model', () => {
      const result = dao.update(999, { displayName: 'Test' })
      expect(result).toBeNull()
    })

    it('should return existing model when no updates provided', () => {
      dao.add(makeModel({ id: 1 }))
      const result = dao.update(1, {})
      expect(result).not.toBeNull()
      expect(result!.displayName).toBe('Test Model')
    })

    it('should only update specified fields', () => {
      dao.add(makeModel({ id: 1, displayName: 'Original', provider: 'openai' }))
      const result = dao.update(1, { displayName: 'Changed' })
      expect(result!.displayName).toBe('Changed')
      expect(result!.provider).toBe('openai') // unchanged
    })
  })

  describe('delete', () => {
    it('should delete model and return true', () => {
      dao.add(makeModel({ id: 1 }))
      const result = dao.delete(1)
      expect(result).toBe(true)
      expect(dao.getById(1)).toBeNull()
    })

    it('should return false when deleting non-existent model', () => {
      const result = dao.delete(999)
      expect(result).toBe(false)
    })

    it('should not affect other models', () => {
      dao.add(makeModel({ id: 1 }))
      dao.add(makeModel({ id: 2 }))

      dao.delete(1)
      expect(dao.getAll()).toHaveLength(1)
      expect(dao.getById(2)).not.toBeNull()
    })
  })
})
