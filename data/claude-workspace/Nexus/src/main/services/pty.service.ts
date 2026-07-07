/**
 * PTY 服务
 * 管理伪终端进程的生命周期
 */

import { ipcMain, BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'
import { expandTilde } from '../utils/path'
import { TerminalIOTracker } from './terminal-io-tracker'

/**
 * PTY 会话信息
 */
export interface PtySession {
  pty: pty.IPty
  windowId: number
}

/**
 * PTY 服务类
 */
export class PtyService {
  private static instance: PtyService | null = null

  private ptyMap = new Map<string, PtySession>()
  private mainWindow: BrowserWindow | null = null

  /** 数据过滤器映射（ptyId → filter 函数），用于在发送到渲染进程前转换数据 */
  private filters = new Map<string, (data: string) => string>()

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): PtyService {
    if (!PtyService.instance) {
      PtyService.instance = new PtyService()
    }
    return PtyService.instance
  }

  /**
   * 设置主窗口
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * 创建 PTY 进程
   */
  createPty(params: {
    shell?: string
    cwd?: string
    cols?: number
    rows?: number
    panelId?: string
    sessionId?: string
  }): string {
    if (!this.mainWindow) {
      throw new Error('主窗口未设置')
    }

    const shell = params.shell || process.env.SHELL || '/bin/bash'
    // 展开 ~ 为用户主目录
    const rawCwd = params.cwd || process.env.HOME || process.env.USERPROFILE || ''
    const cwd = expandTilde(rawCwd)

    // 生成唯一 ID
    const ptyId = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    // 创建 PTY 进程
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: params.cols || 80,
      rows: params.rows || 24,
      cwd,
      env: process.env as Record<string, string>,
    })

    // 保存 PTY 会话
    this.ptyMap.set(ptyId, {
      pty: ptyProcess,
      windowId: this.mainWindow.id,
    })

    // 注册到 TerminalIOTracker（用于终端 I/O 记录）
    const panelId = params.panelId || ptyId
    const sessionId = params.sessionId || 'session-unknown'
    TerminalIOTracker.getInstance().registerPty(ptyId, sessionId, panelId, cwd, this.mainWindow)

    // 绑定数据转发（检查窗口是否已销毁）
    const onDataHandler = (data: string) => {
      // 截获 Shell 输出，送入 TerminalIOTracker
      TerminalIOTracker.getInstance().onOutput(ptyId, data)

      // 应用数据过滤器（如 Nexus 连接的 marker 过滤）
      const filter = this.filters.get(ptyId)
      const displayData = filter ? filter(data) : data

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, {
          ptyId,
          data: displayData,
        })
      }
    }
    ptyProcess.onData(onDataHandler)

    // 监听退出
    ptyProcess.onExit(({ exitCode, signal }) => {
      this.ptyMap.delete(ptyId)
      // 检查窗口是否已销毁
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, {
          ptyId,
          data: `\r\n[进程已退出，代码：${exitCode || signal}]\r\n`,
        })
      }
    })

    return ptyId
  }

  /**
   * 写入数据到 PTY
   */
  writeToPty(ptyId: string, data: string): void {
    const session = this.ptyMap.get(ptyId)
    if (session) {
      // 截获用户输入，送入 TerminalIOTracker
      TerminalIOTracker.getInstance().onInput(ptyId, data)
      session.pty.write(data)
    }
  }

  /**
   * 调整 PTY 大小
   */
  resizePty(ptyId: string, cols: number, rows: number): void {
    const session = this.ptyMap.get(ptyId)
    if (session) {
      session.pty.resize(cols, rows)
    }
  }

  /**
   * 销毁 PTY
   */
  killPty(ptyId: string): void {
    const session = this.ptyMap.get(ptyId)
    if (session) {
      session.pty.kill()
      this.ptyMap.delete(ptyId)
      // 从 TerminalIOTracker 移除
      TerminalIOTracker.getInstance().unregisterPty(ptyId)
    }
  }

  /**
   * 获取 PTY 信息
   */
  getPtyInfo(ptyId: string): {
    pid?: number
    cols?: number
    rows?: number
  } | null {
    const session = this.ptyMap.get(ptyId)
    if (!session) return null
    return {
      pid: session.pty.pid,
      cols: session.pty.cols,
      rows: session.pty.rows,
    }
  }

  /**
   * 获取 PTY 会话的 pty 实例（供 NexusConnectionManager 使用）
   */
  getPtySession(ptyId: string): PtySession | null {
    return this.ptyMap.get(ptyId) || null
  }

  /**
   * 设置 PTY 数据过滤器
   * 过滤器在 onData → renderer 链路中应用，用于转换数据后再发送给终端显示
   * 传入 null 等同于移除过滤器
   */
  setDataFilter(ptyId: string, filter: ((data: string) => string) | null): void {
    if (filter) {
      this.filters.set(ptyId, filter)
    } else {
      this.filters.delete(ptyId)
    }
  }

  /**
   * 移除 PTY 数据过滤器
   */
  removeDataFilter(ptyId: string): void {
    this.filters.delete(ptyId)
  }

  /**
   * 销毁所有 PTY
   */
  dispose(): void {
    for (const [ptyId, session] of this.ptyMap.entries()) {
      // 销毁 PTY 进程
      try {
        session.pty.kill()
      } catch (error) {
      }
    }
    this.ptyMap.clear()
  }
}
