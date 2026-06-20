/**
 * 数据库服务
 * 统一管理数据库访问
 */

import { app } from 'electron'
import {
  initDatabase,
  closeDatabase,
  getDatabase,
} from '../db/database'
import { ConfigDAO } from '../db/config.dao'
import { SessionDAO } from '../db/session.dao'
import { SessionSnapshotDAO } from '../db/snapshot.dao'
import { BrowserHistoryDAO } from '../db/browser-history.dao'
import { BrowserBookmarkDAO } from '../db/browser-bookmark.dao'
import { MemoryDAO } from '../db/memory.dao'
import { AgentMessageDAO } from '../db/agent-message.dao'
import { InputHistoryDAO } from '../db/input-history.dao'
import { ModelCatalogDAO } from '../db/model-catalog.dao'

/**
 * 数据库服务类
 */
export class DatabaseService {
  private static instance: DatabaseService | null = null

  private configDAO: ConfigDAO | null = null
  private sessionDAO: SessionDAO | null = null
  private snapshotDAO: SessionSnapshotDAO | null = null
  private historyDAO: BrowserHistoryDAO | null = null
  private bookmarkDAO: BrowserBookmarkDAO | null = null
  private memoryDAO: MemoryDAO | null = null
  private agentMessageDAO: AgentMessageDAO | null = null
  private inputHistoryDAO: InputHistoryDAO | null = null
  private modelCatalogDAO: ModelCatalogDAO | null = null

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService()
    }
    return DatabaseService.instance
  }

  /**
   * 初始化数据库服务
   */
  async initialize(): Promise<void> {
    initDatabase()
    const db = getDatabase()

    this.configDAO = new ConfigDAO(db)
    this.memoryDAO = new MemoryDAO(db)
    this.agentMessageDAO = new AgentMessageDAO(db)
    this.sessionDAO = new SessionDAO(db, this.memoryDAO)
    this.snapshotDAO = new SessionSnapshotDAO(db)
    this.historyDAO = new BrowserHistoryDAO(db)
    this.bookmarkDAO = new BrowserBookmarkDAO(db)
    this.inputHistoryDAO = new InputHistoryDAO(db)
    this.modelCatalogDAO = new ModelCatalogDAO(db)
  }

  /**
   * 关闭数据库服务
   */
  close(): void {
    this.configDAO = null
    this.sessionDAO = null
    this.snapshotDAO = null
    this.historyDAO = null
    this.bookmarkDAO = null
    this.memoryDAO = null
    this.agentMessageDAO = null
    this.inputHistoryDAO = null
    this.modelCatalogDAO = null
    closeDatabase()
  }

  /**
   * 获取配置 DAO
   */
  getConfigDAO(): ConfigDAO {
    if (!this.configDAO) {
      throw new Error('数据库服务未初始化')
    }
    return this.configDAO
  }

  /**
   * 获取会话 DAO
   */
  getSessionDAO(): SessionDAO {
    if (!this.sessionDAO) {
      throw new Error('数据库服务未初始化')
    }
    return this.sessionDAO
  }

  /**
   * 获取快照 DAO
   */
  getSnapshotDAO(): SessionSnapshotDAO {
    if (!this.snapshotDAO) {
      throw new Error('数据库服务未初始化')
    }
    return this.snapshotDAO
  }

  /**
   * 获取浏览器历史 DAO
   */
  getHistoryDAO(): BrowserHistoryDAO {
    if (!this.historyDAO) {
      throw new Error('数据库服务未初始化')
    }
    return this.historyDAO
  }

  /**
   * 获取浏览器书签 DAO
   */
  getBookmarkDAO(): BrowserBookmarkDAO {
    if (!this.bookmarkDAO) {
      throw new Error('数据库服务未初始化')
    }
    return this.bookmarkDAO
  }

  /**
   * 获取记忆 DAO
   */
  getMemoryDAO(): MemoryDAO {
    if (!this.memoryDAO) {
      throw new Error('数据库服务未初始化')
    }
    return this.memoryDAO
  }

  /**
   * 获取对话历史消息 DAO
   */
  getAgentMessageDAO(): AgentMessageDAO {
    if (!this.agentMessageDAO) {
      throw new Error('数据库服务未初始化')
    }
    return this.agentMessageDAO
  }

  /**
   * 获取输入历史 DAO
   */
  getInputHistoryDAO(): InputHistoryDAO {
    if (!this.inputHistoryDAO) {
      throw new Error('数据库服务未初始化')
    }
    return this.inputHistoryDAO
  }

  /**
   * 获取模型目录 DAO
   */
  getModelCatalogDAO(): ModelCatalogDAO {
    if (!this.modelCatalogDAO) {
      throw new Error('数据库服务未初始化')
    }
    return this.modelCatalogDAO
  }
}
