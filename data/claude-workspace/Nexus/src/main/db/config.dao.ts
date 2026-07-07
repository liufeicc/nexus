/**
 * 配置数据访问层（类型安全版）
 */

import Database from 'better-sqlite3'
import type { ConfigKey, ConfigValueMap, ConfigValue } from '../../core/types'

/**
 * 配置数据访问类
 */
export class ConfigDAO {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  /**
   * 保存配置项
   * @param key 配置键名
   * @param value 配置值 (自动序列化为 JSON)
   */
  save<K extends ConfigKey>(key: K, value: ConfigValueMap[K]): void
  save(key: string, value: unknown): void
  save(key: string, value: unknown): void {
    const id = crypto.randomUUID()
    const stmt = this.db.prepare(`
      INSERT INTO configs (id, key, value, updated_at)
      VALUES (?, ?, ?, strftime('%s', 'now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)
    stmt.run(id, key, JSON.stringify(value))
  }

  /**
   * 获取配置项
   * @param key 配置键名
   * @returns 配置值对象，不存在返回 null
   */
  get<K extends ConfigKey>(key: K): ConfigValueMap[K] | null
  get(key: string): unknown | null
  get(key: string): unknown | null {
    const stmt = this.db.prepare('SELECT value FROM configs WHERE key = ?')
    const row = stmt.get(key) as { value: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value)
    } catch {
      // 兼容非 JSON 格式的裸字符串值（如直接插入的配置）
      return row.value
    }
  }

  /**
   * 获取所有配置
   * @returns 配置对象 { [key]: value }
   */
  getAll(): Partial<ConfigValueMap> {
    const stmt = this.db.prepare('SELECT key, value FROM configs')
    const rows = stmt.all() as { key: string; value: string }[]
    const result: Partial<ConfigValueMap> = {}
    for (const row of rows) {
      try {
        result[row.key as ConfigKey] = JSON.parse(row.value)
      } catch {
        // 兼容非 JSON 格式的裸字符串值
        result[row.key as ConfigKey] = row.value as any
      }
    }
    return result
  }

  /**
   * 删除配置项
   * @param key 配置键名
   */
  delete(key: string): void {
    const stmt = this.db.prepare('DELETE FROM configs WHERE key = ?')
    stmt.run(key)
  }
}
