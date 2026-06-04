/**
 * 终端操作记录写入器（主进程）
 *
 * 单例服务，按天将终端输出追加写入文件。
 * 文件路径: {userData}/memory/sessions/session-{N}/YYYY-MM-DD.md
 * 每天一个文件，序号从 1 开始，系统重启后延续前一天的序号。
 * 线程安全：Node.js 单线程 + 写入队列。
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

interface WriteTask {
  sessionId: string
  content: string
  resolve: () => void
  reject: (error: Error) => void
}

/** 每天一个写入队列 */
interface DailyQueue {
  queue: WriteTask[]
  isWriting: boolean
}

export class OperationFileWriter {
  private static instance: OperationFileWriter | null = null
  private writeQueues = new Map<string, DailyQueue>()
  /** 每个会话的当前序号 */
  private sequenceNumbers = new Map<string, number>()

  static getInstance(): OperationFileWriter {
    if (!OperationFileWriter.instance) {
      OperationFileWriter.instance = new OperationFileWriter()
    }
    return OperationFileWriter.instance
  }

  /**
   * 获取今天的日期字符串 YYYY-MM-DD
   */
  private todayStr(): string {
    return new Date().toISOString().slice(0, 10)
  }

  /**
   * 获取会话日志文件的路径（按天）
   */
  getLogFilePath(sessionId: string, date: string): string {
    const userData = app.getPath('userData')
    const sessionDir = path.join(userData, 'memory', 'sessions', sessionId)
    return path.join(sessionDir, `${date}.md`)
  }

  /**
   * 确保文件存在，如果新建则写入头部
   */
  private ensureFile(sessionId: string, date: string): void {
    const filePath = this.getLogFilePath(sessionId, date)
    const dirPath = path.dirname(filePath)

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf-8')
    }
  }

  /**
   * 加载会话的序号（从已有文件中读取最后一行的序号 + 1，或从 1 开始）
   */
  private async loadSequenceNumber(sessionId: string, date: string): Promise<number> {
    const cacheKey = `${sessionId}_${date}`
    if (this.sequenceNumbers.has(cacheKey)) {
      return this.sequenceNumbers.get(cacheKey)!
    }

    const filePath = this.getLogFilePath(sessionId, date)
    if (!fs.existsSync(filePath)) {
      // 今天没有文件，检查是否有昨天的文件需要延续序号
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yStr = yesterday.toISOString().slice(0, 10)
      const yesterdayPath = this.getLogFilePath(sessionId, yStr)

      if (fs.existsSync(yesterdayPath)) {
        const content = await fs.promises.readFile(yesterdayPath, 'utf-8')
        const seq = this.getLastSequence(content)
        const next = seq > 0 ? seq + 1 : 1
        this.sequenceNumbers.set(cacheKey, next)
        return next
      }

      this.sequenceNumbers.set(cacheKey, 1)
      return 1
    }

    const content = await fs.promises.readFile(filePath, 'utf-8')
    const seq = this.getLastSequence(content)
    const next = seq + 1
    this.sequenceNumbers.set(cacheKey, next)
    return next
  }

  /**
   * 从文件内容中获取最后一行的序号
   */
  private getLastSequence(content: string): number {
    const lines = content.split('\n')
    // 从后往前找第一个带序号的行
    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].match(/^(\d+)\s/)
      if (match) {
        return parseInt(match[1], 10)
      }
    }
    return 0
  }

  /**
   * 获取队列 key
   */
  private queueKey(sessionId: string, date: string): string {
    return `${sessionId}_${date}`
  }

  /**
   * 将任务加入写入队列
   */
  private enqueueWrite(sessionId: string, date: string, content: string): Promise<void> {
    const key = this.queueKey(sessionId, date)
    if (!this.writeQueues.has(key)) {
      this.writeQueues.set(key, { queue: [], isWriting: false })
    }
    const daily = this.writeQueues.get(key)!
    return new Promise((resolve, reject) => {
      daily.queue.push({ sessionId, content, resolve, reject })
      this.processQueue(key, sessionId, date)
    })
  }

  /**
   * 处理写入队列
   */
  private async processQueue(key: string, sessionId: string, date: string): Promise<void> {
    const daily = this.writeQueues.get(key)
    if (!daily || daily.isWriting) return
    daily.isWriting = true

    while (daily.queue.length > 0) {
      const task = daily.queue[0]
      try {
        this.ensureFile(sessionId, date)
        const filePath = this.getLogFilePath(sessionId, date)
        await fs.promises.appendFile(filePath, task.content, 'utf-8')
        daily.queue.shift()
        task.resolve()
      } catch (error) {
        daily.queue.shift()
        task.reject(error as Error)
      }
    }

    daily.isWriting = false
  }

  /**
   * 追加一条终端输出记录
   * @param panelType - 面板类型：'T' = 终端, 'F' = 文件, 'B' = 浏览器
   */
  async appendTerminalEntry(data: {
    sessionId: string
    panelId: string
    panelType?: string
    type: 'input' | 'output'
    text: string
    time: string
  }): Promise<void> {
    const date = this.todayStr()
    const seq = await this.loadSequenceNumber(data.sessionId, date)

    // 递增序号
    const cacheKey = `${data.sessionId}_${date}`
    this.sequenceNumbers.set(cacheKey, seq + 1)

    const pt = data.panelType || 'T'
    const content = `${seq} ${data.time} [${pt}] [${data.panelId}] ${data.text}\n`
    return this.enqueueWrite(data.sessionId, date, content)
  }
}
