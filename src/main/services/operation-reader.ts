/**
 * 终端操作记录读取器（主进程）
 *
 * 单例服务，解析按天的 Markdown 文件为结构化数据。
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { OperationFileWriter } from './operation-writer'

/** 单条记录 */
export interface OperationRecord {
  /** 序号 */
  index: number
  /** 时间戳字符串（如 "10:30:01"） */
  time: string
  /** 面板类型：T=终端, F=文件, B=浏览器 */
  panelType: string
  /** 面板 ID */
  panelId: string
  /** 文本内容 */
  text: string
  /** 原始行内容 */
  raw: string
}

export class OperationReader {
  private static instance: OperationReader | null = null

  static getInstance(): OperationReader {
    if (!OperationReader.instance) {
      OperationReader.instance = new OperationReader()
    }
    return OperationReader.instance
  }

  /**
   * 读取会话所有天的日志内容（合并）
   */
  private readAllFiles(sessionId: string): string {
    const writer = OperationFileWriter.getInstance()
    const userData = app.getPath('userData')
    const sessionDir = path.join(userData, 'memory', 'sessions', sessionId)

    if (!fs.existsSync(sessionDir)) return ''

    const files = fs.readdirSync(sessionDir)
      .filter(f => f.endsWith('.md'))
      .sort()

    const contents: string[] = []
    for (const f of files) {
      const content = fs.readFileSync(path.join(sessionDir, f), 'utf-8')
      contents.push(content)
    }
    return contents.join('\n')
  }

  /**
   * 解析文件为记录列表
   */
  parseOperations(content: string): OperationRecord[] {
    const lines = content.split('\n')
    const records: OperationRecord[] = []

    // 匹配行：序号 HH:MM:SS [T] [panel-xxx] 文本
    const lineRe = /^(\d+)\s+(\d{2}:\d{2}:\d{2})\s+\[(\w)\]\s+\[([^\]]+)\]\s+(.+)$/

    for (const line of lines) {
      const match = line.match(lineRe)
      if (match) {
        records.push({
          index: parseInt(match[1], 10),
          time: match[2],
          panelId: match[4],
          panelType: match[3],
          text: match[5],
          raw: line,
        })
      }
    }

    return records
  }

  /**
   * 获取自上次读取后的新记录
   */
  async getNewOperations(sessionId: string, lastReadIndex: number): Promise<OperationRecord[]> {
    const content = this.readAllFiles(sessionId)
    if (!content) return []
    const allOps = this.parseOperations(content)
    return allOps.filter(op => op.index > lastReadIndex)
  }

  /**
   * 按条件查询
   */
  async queryOperations(
    sessionId: string,
    filter: { panelType?: string; panelId?: string; keyword?: string }
  ): Promise<OperationRecord[]> {
    const content = this.readAllFiles(sessionId)
    if (!content) return []
    const allOps = this.parseOperations(content)
    return allOps.filter(op => {
      if (filter.panelType && op.panelType !== filter.panelType) return false
      if (filter.panelId && op.panelId !== filter.panelId) return false
      if (filter.keyword && !op.text.toLowerCase().includes(filter.keyword.toLowerCase())) return false
      return true
    })
  }

  /**
   * 获取最近 N 条
   */
  async getRecentOperations(sessionId: string, count: number): Promise<OperationRecord[]> {
    const content = this.readAllFiles(sessionId)
    if (!content) return []
    const allOps = this.parseOperations(content)
    return allOps.slice(-count)
  }
}
