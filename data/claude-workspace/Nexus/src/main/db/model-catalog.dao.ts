/**
 * 模型目录数据访问层
 *
 * 管理 model_catalog 表的增删改查操作。
 * 模型目录存储可选大模型的元数据（名称、提供商、接口类型、默认 URL 等）。
 */

import Database from 'better-sqlite3'

/** 模型目录条目（数据库行） */
export interface ModelCatalogRow {
  id: number
  display_name: string
  model_name: string
  provider: string
  interface_type: string
  default_api_url: string
  context_length: number
  description: string | null
  sort_weight: number
  created_at: number
  updated_at: number
}

/** 模型目录条目（业务对象） */
export interface ModelCatalogItem {
  id: number
  displayName: string
  modelName: string
  provider: string
  interfaceType: string
  defaultApiUrl: string
  contextLength: number
  description: string | null
  sortWeight: number
}

/**
 * 模型目录数据访问类
 */
export class ModelCatalogDAO {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  /**
   * 将数据库行转换为业务对象
   */
  private toItem(row: ModelCatalogRow): ModelCatalogItem {
    return {
      id: row.id,
      displayName: row.display_name,
      modelName: row.model_name,
      provider: row.provider,
      interfaceType: row.interface_type,
      defaultApiUrl: row.default_api_url,
      contextLength: row.context_length,
      description: row.description,
      sortWeight: row.sort_weight,
    }
  }

  /**
   * 获取所有模型（按 sort_weight 排序）
   */
  getAll(): ModelCatalogItem[] {
    const stmt = this.db.prepare(
      'SELECT * FROM model_catalog ORDER BY sort_weight ASC'
    )
    const rows = stmt.all() as ModelCatalogRow[]
    return rows.map(r => this.toItem(r))
  }

  /**
   * 获取所有模型（同 getAll，保留别名兼容）
   */
  getAllIncludeDisabled(): ModelCatalogItem[] {
    return this.getAll()
  }

  /**
   * 按 ID 获取模型
   */
  getById(id: number): ModelCatalogItem | null {
    const stmt = this.db.prepare(
      'SELECT * FROM model_catalog WHERE id = ?'
    )
    const row = stmt.get(id) as ModelCatalogRow | undefined
    return row ? this.toItem(row) : null
  }

  /**
   * 按提供商过滤
   */
  getByProvider(provider: string): ModelCatalogItem[] {
    const stmt = this.db.prepare(
      'SELECT * FROM model_catalog WHERE provider = ? ORDER BY sort_weight ASC'
    )
    const rows = stmt.all(provider) as ModelCatalogRow[]
    return rows.map(r => this.toItem(r))
  }

  /**
   * 添加模型条目
   */
  add(item: ModelCatalogItem): ModelCatalogItem {
    const now = Math.floor(Date.now() / 1000)
    const stmt = this.db.prepare(`
      INSERT INTO model_catalog (
        id, display_name, model_name, provider, interface_type, default_api_url,
        context_length, description, sort_weight,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      item.id,
      item.displayName,
      item.modelName,
      item.provider,
      item.interfaceType,
      item.defaultApiUrl,
      item.contextLength,
      item.description,
      item.sortWeight,
      now,
      now
    )
    return this.getById(item.id)!
  }

  /**
   * 更新模型条目
   */
  update(id: number, updates: Partial<ModelCatalogItem>): ModelCatalogItem | null {
    const existing = this.getById(id)
    if (!existing) return null

    const fields: string[] = []
    const values: unknown[] = []

    if (updates.displayName !== undefined) {
      fields.push('display_name = ?')
      values.push(updates.displayName)
    }
    if (updates.modelName !== undefined) {
      fields.push('model_name = ?')
      values.push(updates.modelName)
    }
    if (updates.provider !== undefined) {
      fields.push('provider = ?')
      values.push(updates.provider)
    }
    if (updates.interfaceType !== undefined) {
      fields.push('interface_type = ?')
      values.push(updates.interfaceType)
    }
    if (updates.defaultApiUrl !== undefined) {
      fields.push('default_api_url = ?')
      values.push(updates.defaultApiUrl)
    }
    if (updates.contextLength !== undefined) {
      fields.push('context_length = ?')
      values.push(updates.contextLength)
    }
    if (updates.description !== undefined) {
      fields.push('description = ?')
      values.push(updates.description)
    }
    if (updates.sortWeight !== undefined) {
      fields.push('sort_weight = ?')
      values.push(updates.sortWeight)
    }

    if (fields.length === 0) return existing

    fields.push("updated_at = strftime('%s', 'now')")
    values.push(id)

    const stmt = this.db.prepare(`UPDATE model_catalog SET ${fields.join(', ')} WHERE id = ?`)
    stmt.run(...values)

    return this.getById(id)
  }

  /**
   * 删除模型条目
   */
  delete(id: number): boolean {
    const stmt = this.db.prepare('DELETE FROM model_catalog WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }
}
