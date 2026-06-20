/**
 * Task 管理器
 *
 * 职责：Task 发现、解析、缓存、CRUD 的统一编排器。
 * 扫描 ~/.Nexus/tasks/ 目录，解析 .md 文件，
 * 提供 tasks_list / task_view / task_manage 所需的底层能力。
 *
 * 与 SkillManager 的区别：
 * - 扁平目录结构：{TASKS_DIR}/{task-name}.md
 * - 无 YAML frontmatter，纯 Markdown 内容
 * - 无分类、无平台匹配、无关联文件
 * - 复用 skill-security.ts 进行安全扫描
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { logger } from '../../utils/logger'
import {
  TaskMeta,
  TaskContent,
  TaskManageResult,
} from '../../../core/types/task'
import {
  TASKS_DIR,
  TASK_NAME_REGEX,
  MAX_TASK_NAME_LENGTH,
  MAX_TASK_DESCRIPTION_LENGTH,
  MAX_TASK_MD_SIZE,
} from '../../../core/constants/task'
import { scanSkillContent } from '../skills/skill-security'

// ==================== TaskManager 类 ====================

export class TaskManager {
  private _tasksDir: string
  private cache: TaskMeta[] | null = null
  private cacheTimestamp: number = 0
  /** TaskContent 缓存：key 为 task name，value 为 {data, timestamp} */
  private contentCache: Map<string, { data: TaskContent; timestamp: number }> = new Map()
  /** 进程内写锁：正在被编辑的 task 名称集合 */
  private writeLocks: Set<string> = new Set()
  private readonly CACHE_TTL_MS = 30_000

  constructor(tasksDir?: string) {
    this._tasksDir = tasksDir || TASKS_DIR
    // 确保目录存在
    if (!fs.existsSync(this._tasksDir)) {
      fs.mkdirSync(this._tasksDir, { recursive: true })
    }
  }

  /** 获取 tasks 根目录路径 */
  get tasksDir(): string {
    return this._tasksDir
  }

  // ── 发现 ──

  /**
   * 列出所有可用 task 的元数据
   *
   * 扫描 tasks 目录，解析所有 .md 文件，使用 30s TTL 缓存。
   */
  listTasks(): TaskMeta[] {
    const now = Date.now()
    if (this.cache && now - this.cacheTimestamp < this.CACHE_TTL_MS) {
      return [...this.cache]
    }

    const tasks = this.scanTasksDirectory()
    this.cache = tasks
    this.cacheTimestamp = now
    return tasks
  }

  /**
   * 扫描 tasks 目录，解析所有 .md 文件
   */
  private scanTasksDirectory(): TaskMeta[] {
    if (!fs.existsSync(this._tasksDir)) {
      return []
    }

    const entries = fs.readdirSync(this._tasksDir, { withFileTypes: true })
    const results: TaskMeta[] = []

    for (const entry of entries) {
      // 跳过隐藏文件和目录
      if (entry.name.startsWith('.')) continue
      // 只处理 .md 文件
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue

      const taskName = entry.name.replace(/\.md$/, '')
      const taskPath = path.join(this._tasksDir, entry.name)

      try {
        const content = fs.readFileSync(taskPath, 'utf-8')
        const parsed = this.parseTaskMd(content)
        results.push({
          name: taskName,
          title: parsed.title,
          description: parsed.body,
        })
      } catch (error) {
        logger.warn(`[TaskManager] 解析 Task 文件失败 ${taskPath}: ${error}`)
      }
    }

    return results
  }

  // ── 解析 ──

  /**
   * 解析 Task .md 内容：提取标题 + body
   *
   * 标题从第一行的 "# {标题}" 提取，如果没有则从文件名推断。
   */
  parseTaskMd(content: string, taskName?: string): { title: string; body: string } {
    // 统一换行符
    const normalized = content.replace(/\r\n?/g, '\n').replace(/^\n+/, '')

    // 尝试从第一行提取 # 标题
    const titleMatch = normalized.match(/^#\s+(.+?)\n/)
    if (titleMatch) {
      const title = titleMatch[1].trim()
      const body = normalized.slice(titleMatch[0].length).trim()
      return { title, body }
    }

    // 没有 # 标题行，使用文件名作为标题，整个内容作为 body
    return {
      title: taskName || 'Untitled',
      body: normalized,
    }
  }

  // ── 内容读取 ──

  /**
   * 获取 task 完整内容（task_view 的核心逻辑）
   */
  getTaskContent(name: string): TaskContent {
    // 检查缓存
    const now = Date.now()
    const cached = this.contentCache.get(name)
    if (cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data
    }

    const taskPath = this.findTaskFile(name)
    if (!taskPath) {
      throw new Error(`Task 不存在: ${name}`)
    }

    const content = fs.readFileSync(taskPath, 'utf-8')
    const parsed = this.parseTaskMd(content, name)

    // 安全扫描
    const scanResult = scanSkillContent(content, taskPath)

    const result: TaskContent = {
      name,
      title: parsed.title,
      content,
    }
    this.contentCache.set(name, { data: result, timestamp: now })
    return result
  }

  // ── 安全辅助 ──

  /**
   * 尝试获取 task 写锁
   * @returns true 表示获取成功，false 表示已被其他会话编辑
   */
  private tryAcquireWriteLock(name: string): boolean {
    if (this.writeLocks.has(name)) return false
    this.writeLocks.add(name)
    return true
  }

  /**
   * 释放 task 写锁
   */
  private releaseWriteLock(name: string): void {
    this.writeLocks.delete(name)
  }

  // ── CRUD 操作 ──

  /**
   * 创建新 Task .md 文件
   */
  createTask(name: string, content: string): TaskManageResult {
    this._validateName(name)

    if (!this.tryAcquireWriteLock(name)) {
      return { success: false, message: `Task 正在被其他会话编辑: ${name}` }
    }

    try {
      const taskPath = path.join(this._tasksDir, `${name}.md`)
      if (fs.existsSync(taskPath)) {
        return { success: false, message: `Task 已存在: ${name}` }
      }

      // 大小检查
      if (content.length > MAX_TASK_MD_SIZE) {
        return { success: false, message: `Task 内容超过最大字符数 ${MAX_TASK_MD_SIZE}` }
      }

      // 安全扫描
      const scanResult = scanSkillContent(content, taskPath)
      if (scanResult.blocked) {
        return { success: false, message: `安全扫描阻止创建 task: ${scanResult.findings.join(', ')}` }
      }

      // 原子写入
      this.atomicWrite(taskPath, content)

      this.invalidateCache()

      const files = this.listFiles()
      return {
        success: true,
        message: `Task 创建成功: ${name}`,
        taskName: name,
        files,
      }
    } finally {
      this.releaseWriteLock(name)
    }
  }

  /**
   * 替换整个 Task .md 内容
   */
  editTask(name: string, newContent: string): TaskManageResult {
    if (!this.tryAcquireWriteLock(name)) {
      return { success: false, message: `Task 正在被其他会话编辑: ${name}` }
    }

    try {
      const taskPath = this.findTaskFile(name)
      if (!taskPath) {
        return { success: false, message: `Task 不存在: ${name}` }
      }

      // 大小检查
      if (newContent.length > MAX_TASK_MD_SIZE) {
        return { success: false, message: `Task 内容超过最大字符数 ${MAX_TASK_MD_SIZE}` }
      }

      // 安全扫描
      const scanResult = scanSkillContent(newContent, taskPath)
      if (scanResult.blocked) {
        return { success: false, message: `安全扫描阻止编辑 task: ${scanResult.findings.join(', ')}` }
      }

      this.atomicWrite(taskPath, newContent)
      this.invalidateCache()

      const files = this.listFiles()
      return { success: true, message: `Task 编辑成功: ${name}`, taskName: name, files }
    } finally {
      this.releaseWriteLock(name)
    }
  }

  /**
   * 删除 Task .md 文件
   */
  deleteTask(name: string): TaskManageResult {
    if (!this.tryAcquireWriteLock(name)) {
      return { success: false, message: `Task 正在被其他会话编辑: ${name}` }
    }

    try {
      const taskPath = this.findTaskFile(name)
      if (!taskPath) {
        return { success: false, message: `Task 不存在: ${name}` }
      }

      fs.unlinkSync(taskPath)
      this.invalidateCache()

      const files = this.listFiles()
      return { success: true, message: `Task 删除成功: ${name}`, taskName: name, files }
    } finally {
      this.releaseWriteLock(name)
    }
  }

  // ── 内部辅助方法 ──

  /**
   * 查找 task .md 文件的绝对路径
   */
  private findTaskFile(name: string): string | null {
    const taskPath = path.join(this._tasksDir, `${name}.md`)
    if (fs.existsSync(taskPath)) {
      return taskPath
    }
    return null
  }

  /**
   * 列出 tasks 目录下的所有 .md 文件名
   */
  private listFiles(): string[] {
    if (!fs.existsSync(this._tasksDir)) return []
    return fs.readdirSync(this._tasksDir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'))
      .map(e => e.name)
  }

  /**
   * 验证 task 名称
   */
  private _validateName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new Error('task name 不能为空')
    }
    if (name.length > MAX_TASK_NAME_LENGTH) {
      throw new Error(`task name 超过最大长度 ${MAX_TASK_NAME_LENGTH}`)
    }
    if (!TASK_NAME_REGEX.test(name)) {
      throw new Error(`task name 格式无效: ${name}`)
    }
  }

  /**
   * 原子写入：先写临时文件，再 rename 覆盖（崩溃安全）
   */
  private atomicWrite(filePath: string, content: string): void {
    const tmpPath = `${filePath}.tmp.${crypto.randomUUID()}`
    fs.writeFileSync(tmpPath, content, 'utf-8')
    fs.renameSync(tmpPath, filePath)
  }

  // ── 缓存 ──

  /**
   * 清除内存缓存（含 listTasks 和 getTaskContent 缓存）
   */
  invalidateCache(): void {
    this.cache = null
    this.cacheTimestamp = 0
    this.contentCache.clear()
  }
}
