/**
 * 数据库初始化
 */

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { MODEL_CATALOG } from '../../core/constants/model-catalog'

let db: Database.Database | null = null

/**
 * 获取数据库实例
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('数据库未初始化')
  }
  return db
}

/**
 * 初始化数据库
 * @returns Database 实例
 */
export function initDatabase(): Database.Database {
  // 确保数据目录存在
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'db.sqlite3')

  // 确保目录存在
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true })
  }

  db = new Database(dbPath)

  // 启用外键约束
  db.pragma('foreign_keys = ON')

  // 验证外键是否真正启用（防止旧版本数据库存在违反外键的脏数据）
  const foreignKeysEnabled = db.pragma('foreign_keys', { simple: true })
  if (!foreignKeysEnabled) {
    console.warn('[Database] 外键约束启用失败，尝试修复脏数据...')
    // 清理 session_snapshots 中引用不存在 session 的脏记录
    db.exec('DELETE FROM session_snapshots WHERE session_id NOT IN (SELECT id FROM sessions)')
  }

  // 检查并自动清理外键违规记录
  const fkViolations = db.pragma('foreign_key_check') as Array<{
    table: string
    rowid: number
    parent: string
  }>
  if (fkViolations.length > 0) {
    console.warn('[Database] 发现', fkViolations.length, '条违反外键约束的记录，正在清理...')
    // 按表分组清理，从 leaf 表到 parent 表顺序删除以避免级联冲突
    const byTable = new Map<string, number[]>()
    for (const v of fkViolations) {
      if (!byTable.has(v.table)) byTable.set(v.table, [])
      byTable.get(v.table)!.push(v.rowid)
    }
    for (const [table, rowids] of byTable) {
      const placeholders = rowids.map(() => '?').join(', ')
      db.prepare(`DELETE FROM ${table} WHERE rowid IN (${placeholders})`).run(rowids)
    }
    console.warn('[Database] 外键违规记录已清理')
  }

  // 创建表
  db.exec(`
    -- 配置表
    CREATE TABLE IF NOT EXISTS configs (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- 会话表
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      is_active INTEGER DEFAULT 0,
      last_used_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- 会话快照表
    CREATE TABLE IF NOT EXISTS session_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT,
      layout_data TEXT NOT NULL,
      active_panel_id TEXT,
      panel_states TEXT NOT NULL,
      saved_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- 创建索引
    CREATE INDEX IF NOT EXISTS idx_sessions_is_active ON sessions(is_active);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_used ON sessions(last_used_at);
    CREATE INDEX IF NOT EXISTS idx_snapshots_session_id ON session_snapshots(session_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_saved_at ON session_snapshots(saved_at);

    -- 浏览器历史表（所有浏览器面板共享）
    CREATE TABLE IF NOT EXISTS browser_history (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      title TEXT,
      visited_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_visited_at ON browser_history(visited_at);

    -- 书签表（所有浏览器面板共享）
    CREATE TABLE IF NOT EXISTS browser_bookmarks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bookmarks_sort_order ON browser_bookmarks(sort_order);

    -- 记忆条目表（统一管理 MEMORY/USER 记忆，按 nexus_session_id 隔离）
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      nexus_session_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'memory',   -- 'memory' | 'user'
      content TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (nexus_session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_session ON memory_entries(nexus_session_id);
    CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory_entries(nexus_session_id, scope);

    -- 记忆事实表（按 nexus_session_id 隔离的智能记忆）
    CREATE TABLE IF NOT EXISTS memory_facts (
      id TEXT PRIMARY KEY,
      nexus_session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT DEFAULT 'agent',
      scope TEXT NOT NULL DEFAULT 'memory',
      trust_score REAL DEFAULT 1.0,
      retrieval_count INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (nexus_session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_facts_session ON memory_facts(nexus_session_id);
    CREATE INDEX IF NOT EXISTS idx_facts_id ON memory_facts(id);
    CREATE INDEX IF NOT EXISTS idx_facts_trust_score ON memory_facts(trust_score);
    CREATE INDEX IF NOT EXISTS idx_facts_retrieval_count ON memory_facts(retrieval_count);
    CREATE INDEX IF NOT EXISTS idx_facts_created_at ON memory_facts(created_at);

    -- FTS5 全文搜索虚拟表
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_facts_fts USING fts5(content);

    -- FTS 同步触发器
    CREATE TRIGGER IF NOT EXISTS memory_facts_ai AFTER INSERT ON memory_facts BEGIN
      INSERT INTO memory_facts_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_facts_ad AFTER DELETE ON memory_facts BEGIN
      DELETE FROM memory_facts_fts WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS memory_facts_au AFTER UPDATE ON memory_facts BEGIN
      DELETE FROM memory_facts_fts WHERE rowid = old.rowid;
      INSERT INTO memory_facts_fts(rowid, content) VALUES (new.rowid, new.content);
    END;

    -- 对话历史消息表（按 topic_id 标识对话主题，按 nexus_session_id 标识工作区）
    CREATE TABLE IF NOT EXISTS agent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id TEXT NOT NULL,
      nexus_session_id TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_calls TEXT,
      tool_call_id TEXT,
      tool_name TEXT,
      is_complete INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (nexus_session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_topic ON agent_messages(topic_id, turn_index);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(nexus_session_id);

    -- 输入历史表（DynamicIsland 用户输入记录，最多保留 50 条）
    CREATE TABLE IF NOT EXISTS input_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_input_history_created_at ON input_history(created_at);

    -- 模型目录表（存储可选大模型元数据，支持运行时增删改）
    CREATE TABLE IF NOT EXISTS model_catalog (
      id INTEGER PRIMARY KEY,
      display_name TEXT NOT NULL,
      model_name TEXT NOT NULL,         -- API 请求中的模型名称标识符
      provider TEXT NOT NULL,
      interface_type TEXT NOT NULL,    -- 'openai' | 'anthropic'
      default_api_url TEXT NOT NULL,
      context_length INTEGER NOT NULL,
      description TEXT,
      sort_weight INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_catalog_sort_weight ON model_catalog(sort_weight);
  `)

  // 初始化模型目录种子数据（仅在表为空时执行）
  const catalogCount = db.prepare('SELECT COUNT(*) as count FROM model_catalog').get() as { count: number }
  if (catalogCount.count === 0) {
    console.log('[Database] 初始化模型目录种子数据...')
    const insert = db.prepare(`
      INSERT INTO model_catalog (id, display_name, model_name, provider, interface_type, default_api_url, context_length, description, sort_weight)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMany = db.transaction((entries) => {
      for (const entry of entries) {
        insert.run(
          entry.id,
          entry.displayName,
          entry.modelName,
          entry.provider,
          entry.interfaceType,
          entry.defaultApiUrl,
          entry.contextLength,
          entry.description || null,
          entry.sortWeight
        )
      }
    })
    insertMany(MODEL_CATALOG)
    console.log('[Database] 模型目录种子数据已初始化（', MODEL_CATALOG.length, '条）')
  }

  // 执行数据库迁移（新版本升级时自动执行）
  runMigrations(db)

  // 检查并修复 FTS5 索引完整性
  repairFTS5IfNeeded(db)

  return db
}

/**
 * 当前数据库 schema 版本号
 *
 * 每次修改表结构时递增此数字，并在 runMigrations 中添加对应的迁移逻辑。
 * 版本号存储在 configs 表中，key 为 'db_schema_version'。
 */
const CURRENT_DB_VERSION = 1

/**
 * 读取当前数据库版本号
 */
function getCurrentVersion(db: Database.Database): number {
  try {
    const row = db.prepare("SELECT value FROM configs WHERE key = 'db_schema_version'").get() as { value: string } | undefined
    return row ? parseInt(row.value, 10) : 0
  } catch {
    // configs 表可能不存在（首次初始化），返回 0
    return 0
  }
}

/**
 * 保存数据库版本号
 */
function setCurrentVersion(db: Database.Database, version: number): void {
  db.prepare(`
    INSERT INTO configs (id, key, value) VALUES ('db_schema_version', 'db_schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = strftime('%s', 'now')
  `).run(String(version), String(version))
}

/**
 * 执行数据库迁移
 *
 * 从当前版本升级到最新版本，按版本号顺序执行迁移逻辑。
 * 每个迁移在事务中执行，确保原子性。
 */
function runMigrations(db: Database.Database): void {
  const currentVersion = getCurrentVersion(db)

  if (currentVersion >= CURRENT_DB_VERSION) {
    return // 已是最新版本
  }

  console.log(`[Database] 数据库版本 ${currentVersion} -> ${CURRENT_DB_VERSION}，开始迁移...`)

  const migrate = db.transaction((targetVersion: number) => {
    // 迁移 1: 修复旧版本 FTS5 触发器 + 补齐缺失索引
    if (targetVersion >= 1) {
      console.log('[Database] 执行迁移 1: FTS5 触发器修复 + 索引补齐')

      // 修复旧版本 FTS5 触发器（从之前版本移过来的逻辑）
      const triggerCheck = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='memory_facts_ad'"
      ).get() as { sql: string } | undefined

      if (triggerCheck && (triggerCheck.sql.includes('old.content') || triggerCheck.sql.includes('memory_facts_fts, rowid'))) {
        db.exec('DROP TRIGGER IF EXISTS memory_facts_ad')
        db.exec('DROP TRIGGER IF EXISTS memory_facts_au')
        db.exec(`
          CREATE TRIGGER memory_facts_ad AFTER DELETE ON memory_facts BEGIN
            DELETE FROM memory_facts_fts WHERE rowid = old.rowid;
          END;
          CREATE TRIGGER memory_facts_au AFTER UPDATE ON memory_facts BEGIN
            DELETE FROM memory_facts_fts WHERE rowid = old.rowid;
            INSERT INTO memory_facts_fts(rowid, content) VALUES (new.rowid, new.content);
          END;
        `)
        console.log('[Database] FTS5 触发器已修复')
      }
    }

    // 未来新增迁移时，在此追加：
    // if (targetVersion >= 2) {
    //   console.log('[Database] 执行迁移 2: xxx')
    //   db.exec('CREATE TABLE ...')
    // }

    setCurrentVersion(db, targetVersion)
  })

  migrate(CURRENT_DB_VERSION)
  console.log('[Database] 迁移完成')
}

/**
 * 检查 FTS5 虚拟表完整性，损坏时自动重建
 *
 * 触发场景：手动操作数据库、异常关闭、FTS5 内部表损坏等。
 * 检测方式：尝试向 FTS5 表写入测试数据，失败则判定为损坏。
 * 修复策略：先尝试 DROP TABLE，失败则用 writable_schema 强制清除，最后重建。
 */
function repairFTS5IfNeeded(db: Database.Database): void {
  // 1. 检测 FTS5 是否可用
  try {
    const testRow = db.prepare("SELECT rowid FROM memory_facts_fts WHERE memory_facts_fts MATCH '__fts5_integrity_test__' LIMIT 1").get()
    void testRow // 查到或查不到都说明 FTS5 正常
    return
  } catch (err) {
    console.warn('[Database] FTS5 索引损坏，正在尝试修复...', err instanceof Error ? err.message : String(err))
  }

  // 2. 删除触发器（不依赖 FTS 表）
  db.exec('DROP TRIGGER IF EXISTS memory_facts_ai')
  db.exec('DROP TRIGGER IF EXISTS memory_facts_ad')
  db.exec('DROP TRIGGER IF EXISTS memory_facts_au')

  // 3. 尝试正常 DROP
  try {
    db.exec('DROP TABLE IF EXISTS memory_facts_fts')
  } catch {
    // 4. vtable 构造函数失败，用 writable_schema 强制清除 sqlite_master 中的记录
    console.warn('[Database] 常规 DROP 失败，使用 writable_schema 强制清除')
    db.pragma('writable_schema = ON')
    db.exec("DELETE FROM sqlite_master WHERE name LIKE 'memory_facts_fts%'")
    db.pragma('writable_schema = OFF')
  }

  // 5. 重建 FTS5 虚拟表和触发器
  db.exec(`
    CREATE VIRTUAL TABLE memory_facts_fts USING fts5(content);

    CREATE TRIGGER memory_facts_ai AFTER INSERT ON memory_facts BEGIN
      INSERT INTO memory_facts_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER memory_facts_ad AFTER DELETE ON memory_facts BEGIN
      DELETE FROM memory_facts_fts WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER memory_facts_au AFTER UPDATE ON memory_facts BEGIN
      DELETE FROM memory_facts_fts WHERE rowid = old.rowid;
      INSERT INTO memory_facts_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `)

  // 6. 从现有 memory_facts 数据重建索引
  try {
    db.exec("INSERT INTO memory_facts_fts(memory_facts_fts) VALUES('rebuild')")
    console.log('[Database] FTS5 索引修复完成')
  } catch (err) {
    console.error('[Database] FTS5 rebuild 失败:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * 关闭数据库连接
 */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
