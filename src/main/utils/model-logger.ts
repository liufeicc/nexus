/**
 * 模型日志工具
 *
 * 记录每次与大模型交互的请求和响应，每天一个日志文件。
 * 文件命名：model-YYYY-MM-DD.log
 * 存放路径：~/.Nexus_dev/logs/（开发）或 ~/.Nexus/logs/（生产）
 */

import * as fs from 'fs'
import * as path from 'path'
import { getNexusDirName } from '../../core/utils/path-utils'

/** 当前日期的日志文件写入流（懒加载 + 按天切换） */
let currentStream: fs.WriteStream | null = null
let currentDateKey = ''

/**
 * 获取 Nexus 根目录（与 task.ts / skill.ts 保持一致）
 */
function getNexusDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ''
  return path.join(homeDir, getNexusDirName())
}

/**
 * 获取日志文件写入流
 * 如果日期变化了，自动关闭旧流并创建新流
 */
function getLogFileStream(): fs.WriteStream {
  const dateKey = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  // 日期变化或首次使用，关闭旧流
  if (dateKey !== currentDateKey && currentStream) {
    currentStream.end()
    currentStream = null
  }

  if (currentStream) return currentStream

  currentDateKey = dateKey

  const logDir = path.join(getNexusDir(), 'logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }

  const logFile = path.join(logDir, `model-${dateKey}.log`)
  currentStream = fs.createWriteStream(logFile, { flags: 'a' })
  return currentStream
}

/**
 * 写入模型日志
 * @param direction 'request' | 'response'
 * @param data 请求或响应数据
 */
function logModel(direction: 'request' | 'response', data: unknown): void {
  try {
    const stream = getLogFileStream()
    const timestamp = new Date().toISOString()
    const separator = '='.repeat(80)

    const content =
      `${separator}\n` +
      `[${timestamp}] ${direction.toUpperCase()}\n` +
      `${separator}\n` +
      formatData(data) +
      '\n\n'

    stream.write(content)
  } catch {
    // 日志写入失败不抛异常，静默忽略
  }
}

/**
 * 格式化数据为可读字符串
 */
function formatData(data: unknown): string {
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

/**
 * 记录发送给大模型的请求
 */
export function logModelRequest(messages: unknown, options?: unknown): void {
  const requestData: Record<string, unknown> = {
    messages,
  }
  if (options) {
    requestData.options = options
  }
  logModel('request', requestData)
}

/**
 * 记录大模型的响应
 */
export function logModelResponse(response: unknown): void {
  logModel('response', response)
}

/**
 * 关闭日志文件写入流（应用退出时调用）
 */
export function shutdownModelLogger(): void {
  if (currentStream) {
    currentStream.end()
    currentStream = null
    currentDateKey = ''
  }
}
