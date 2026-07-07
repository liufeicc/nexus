/**
 * ConfigDAO 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { ConfigDAO } from '../../src/main/db/config.dao'
import { createTestDatabase, cleanupDatabase } from '../setup'

describe('ConfigDAO', () => {
  let db: Database.Database
  let dao: ConfigDAO

  beforeEach(() => {
    db = createTestDatabase()
    dao = new ConfigDAO(db)
  })

  afterEach(() => {
    cleanupDatabase(db)
  })

  describe('save', () => {
    it('should save a string config', () => {
      dao.save('language', 'zh')
      expect(dao.get('language')).toBe('zh')
    })

    it('should save a number config', () => {
      dao.save('sidebarWidth', 300)
      expect(dao.get('sidebarWidth')).toBe(300)
    })

    it('should save a boolean config', () => {
      dao.save('sidebarCollapsed', true)
      expect(dao.get('sidebarCollapsed')).toBe(true)
    })

    it('should save a complex object config', () => {
      const theme = { name: 'deepblue' }
      dao.save('theme', theme)
      expect(dao.get('theme')).toEqual(theme)
    })

    it('should save an array config', () => {
      const paths = [{ name: 'home', path: '/home/user' }]
      dao.save('commonPaths', paths)
      expect(dao.get('commonPaths')).toEqual(paths)
    })

    it('should update existing config on conflict', () => {
      dao.save('sidebarWidth', 200)
      dao.save('sidebarWidth', 400)
      expect(dao.get('sidebarWidth')).toBe(400)
    })

    it('should handle nested objects', () => {
      const config = {
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-4',
        maxIterations: 50,
      }
      dao.save('agentConfig', config)
      expect(dao.get('agentConfig')).toEqual(config)
    })
  })

  describe('get', () => {
    it('should return null for non-existent config', () => {
      expect(dao.get('nonExistent' as any)).toBeNull()
    })

    it('should return parsed JSON for JSON values', () => {
      dao.save('agentEnabled', true)
      expect(dao.get('agentEnabled')).toBe(true)
    })

    it('should handle bare string values (non-JSON fallback)', () => {
      // 直接插入裸字符串绕过 save 的 JSON.stringify
      db.prepare('INSERT INTO configs (id, key, value) VALUES (?, ?, ?)').run(
        'bare-id', 'bareKey', 'bareValue'
      )
      expect(dao.get('bareKey')).toBe('bareValue')
    })
  })

  describe('getAll', () => {
    it('should return empty object when no configs', () => {
      expect(dao.getAll()).toEqual({})
    })

    it('should return all configs as key-value pairs', () => {
      dao.save('language', 'en')
      dao.save('sidebarWidth', 250)
      dao.save('sidebarCollapsed', false)

      const all = dao.getAll()
      expect(all.language).toBe('en')
      expect(all.sidebarWidth).toBe(250)
      expect(all.sidebarCollapsed).toBe(false)
    })

    it('should handle mixed JSON and bare string values', () => {
      dao.save('language', 'zh')
      db.prepare('INSERT INTO configs (id, key, value) VALUES (?, ?, ?)').run(
        'bare-id', 'bareKey', 'raw'
      )

      const all = dao.getAll()
      expect(all.language).toBe('zh')
      expect((all as any).bareKey).toBe('raw')
    })
  })

  describe('delete', () => {
    it('should delete an existing config', () => {
      dao.save('language', 'zh')
      dao.delete('language')
      expect(dao.get('language')).toBeNull()
    })

    it('should not throw when deleting non-existent config', () => {
      expect(() => dao.delete('nonExistent')).not.toThrow()
    })

    it('should not affect other configs', () => {
      dao.save('language', 'zh')
      dao.save('sidebarWidth', 300)
      dao.delete('language')
      expect(dao.get('sidebarWidth')).toBe(300)
    })
  })
})
