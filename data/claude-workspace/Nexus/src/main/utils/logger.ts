/**
 * 日志工具
 */

import chalk from 'chalk'
import * as fs from 'fs'
import * as path from 'path'
import { getNexusDirName } from '../../core/utils/path-utils'

/**
 * 日志级别
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/** 日志文件路径（懒加载） */
let logFileStream: fs.WriteStream | null = null

/**
 * 获取日志文件写入流
 */
function getLogFileStream(): fs.WriteStream {
  if (logFileStream) return logFileStream

  const nexusDirName = getNexusDirName()
  const logDir = path.resolve(process.env.HOME || process.cwd(), nexusDirName, 'logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }

  const logFile = path.join(logDir, `nexus-${new Date().toISOString().slice(0, 10)}.log`)
  logFileStream = fs.createWriteStream(logFile, { flags: 'a' })
  return logFileStream
}

/**
 * 写入日志文件
 */
function writeToLogFile(message: string): void {
  const stream = getLogFileStream()
  stream.write(message + '\n')
}

/**
 * 日志工具类
 */
class Logger {
  private prefix: string

  constructor(prefix: string = '') {
    this.prefix = prefix
  }

  /**
   * 格式化日志消息
   */
  private format(level: LogLevel, ...args: any[]): string {
    const timestamp = new Date().toLocaleTimeString()
    const prefix = this.prefix ? `[${this.prefix}] ` : ''

    let levelStr = ''
    switch (level) {
      case LogLevel.DEBUG:
        levelStr = chalk.blue(level)
        break
      case LogLevel.INFO:
        levelStr = chalk.green(level)
        break
      case LogLevel.WARN:
        levelStr = chalk.yellow(level)
        break
      case LogLevel.ERROR:
        levelStr = chalk.red(level)
        break
    }

    return `[${timestamp}] ${levelStr} ${prefix}${args.join(' ')}`
  }

  /**
   * 纯文本格式（用于写入日志文件）
   */
  private formatPlain(level: LogLevel, ...args: any[]): string {
    const timestamp = new Date().toISOString()
    const prefix = this.prefix ? `[${this.prefix}] ` : ''
    return `[${timestamp}] [${level}] ${prefix}${args.join(' ')}`
  }

  debug(...args: any[]): void {
    const formatted = this.format(LogLevel.DEBUG, ...args)
    console.log(formatted)
    writeToLogFile(this.formatPlain(LogLevel.DEBUG, ...args))
  }

  info(...args: any[]): void {
    const formatted = this.format(LogLevel.INFO, ...args)
    console.log(formatted)
    writeToLogFile(this.formatPlain(LogLevel.INFO, ...args))
  }

  warn(...args: any[]): void {
    const formatted = this.format(LogLevel.WARN, ...args)
    console.warn(formatted)
    writeToLogFile(this.formatPlain(LogLevel.WARN, ...args))
  }

  error(...args: any[]): void {
    const formatted = this.format(LogLevel.ERROR, ...args)
    console.error(formatted)
    writeToLogFile(this.formatPlain(LogLevel.ERROR, ...args))
  }
}

/**
 * 关闭日志文件写入流
 */
export function shutdownLogger(): void {
  if (logFileStream) {
    logFileStream.end()
    logFileStream = null
  }
}

/**
 * 创建日志实例（内部使用）
 */
function createLogger(prefix: string): Logger {
  return new Logger(prefix)
}

/**
 * 默认日志实例
 */
export const logger = new Logger('Nexus')
