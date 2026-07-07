/**
 * 测试基础设施 - 提供内存中的 SQLite 数据库实例
 */

import Database from 'better-sqlite3'

/**
 * 创建内存中的 SQLite 数据库并初始化表结构
 */
export function createTestDatabase(): Database.Database {
  const db = new Database(':memory:')

  // 启用外键约束
  db.pragma('foreign_keys = ON')

  // 创建表结构
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

    -- 浏览器历史表
    CREATE TABLE IF NOT EXISTS browser_history (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      title TEXT,
      visited_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_visited_at ON browser_history(visited_at);

    -- 书签表
    CREATE TABLE IF NOT EXISTS browser_bookmarks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bookmarks_sort_order ON browser_bookmarks(sort_order);

    -- 记忆条目表
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      nexus_session_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'memory',
      content TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (nexus_session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_session ON memory_entries(nexus_session_id);
    CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory_entries(nexus_session_id, scope);

    -- 记忆事实表
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

    -- 对话历史消息表
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

    -- 输入历史表
    CREATE TABLE IF NOT EXISTS input_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_input_history_created_at ON input_history(created_at);

    -- 模型目录表
    CREATE TABLE IF NOT EXISTS model_catalog (
      id INTEGER PRIMARY KEY,
      display_name TEXT NOT NULL,
      model_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      interface_type TEXT NOT NULL,
      default_api_url TEXT NOT NULL,
      context_length INTEGER NOT NULL,
      description TEXT,
      sort_weight INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_catalog_sort_weight ON model_catalog(sort_weight);
  `)

  return db
}

/**
 * 清理数据库（在每个测试后调用）
 */
export function cleanupDatabase(db: Database.Database): void {
  db.close()
}
