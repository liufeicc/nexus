/**
 * 智能体会话状态
 *
 * 职责：持有每个 AIAgent 实例的会话级状态，防止跨会话污染。
 * 包含：TodoStore、文件读取去重缓存、搜索循环检测、文件时间戳。
 *
 * 每个 AIAgent 实例拥有独立的 SessionState。
 */

import { TodoStore } from './tools/todo-store'

/** 读取去重缓存条目 */
interface ReadEntry {
  mtime: number
  count: number
}

/**
 * 会话级状态
 *
 * 所有原本使用模块级全局变量的状态都移到这里。
 */
export class AgentSessionState {
  // TodoStore
  readonly todoStore: TodoStore

  // 文件读取去重缓存
  private readCache: Map<string, ReadEntry> = new Map()
  private lastReadKey: string | null = null
  private readConsecutiveCount = 0

  // 搜索循环检测
  private lastSearchKey: string | null = null
  private searchConsecutiveCount = 0

  // 文件时间戳（用于 staleness 检测）
  private readTimestamps: Map<string, number> = new Map()

  // 当前模型名（用于判断是否支持图片识别）
  private currentModel: string = ''

  constructor() {
    this.todoStore = new TodoStore()
  }

  // ==================== TodoStore ====================

  // 直接通过 this.todoStore 访问，无需额外方法

  // ==================== 文件读取去重 ====================

  getReadCache(): Map<string, ReadEntry> {
    return this.readCache
  }

  getReadTrackerState(): { lastKey: string | null; count: number } {
    return { lastKey: this.lastReadKey, count: this.readConsecutiveCount }
  }

  setReadTrackerState(lastKey: string | null, count: number): void {
    this.lastReadKey = lastKey
    this.readConsecutiveCount = count
  }

  resetReadTracker(): void {
    this.lastReadKey = null
    this.readConsecutiveCount = 0
  }

  // ==================== 搜索循环检测 ====================

  getSearchTrackerState(): { lastKey: string | null; count: number } {
    return { lastKey: this.lastSearchKey, count: this.searchConsecutiveCount }
  }

  setSearchTrackerState(lastKey: string | null, count: number): void {
    this.lastSearchKey = lastKey
    this.searchConsecutiveCount = count
  }

  resetSearchTracker(): void {
    this.lastSearchKey = null
    this.searchConsecutiveCount = 0
    this.resetReadTracker()
  }

  // ==================== 文件时间戳 ====================

  getReadTimestamps(): Map<string, number> {
    return this.readTimestamps
  }

  // ==================== 当前模型 ====================

  getCurrentModel(): string {
    return this.currentModel
  }

  setCurrentModel(model: string): void {
    this.currentModel = model
  }

  // ==================== 重置 ====================

  /**
   * 重置所有状态（新会话开始时调用）
   */
  reset(): void {
    this.todoStore.write([], false)
    this.readCache = new Map()
    this.readTimestamps = new Map()
    this.resetSearchTracker()
  }
}
