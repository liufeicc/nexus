/**
 * 终端 I/O 追踪器（主进程）
 *
 * 只记录终端输出，按行记录。
 * 每条记录标记时间和面板 ID。
 */

import { BrowserWindow } from 'electron'
import { OperationFileWriter } from './operation-writer'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'

/** 每个 PTY 的追踪状态 */
interface PtyState {
  sessionId: string
  panelId: string
  /** 输出累积缓冲区（遇到 \n 时才按行记录） */
  outputAccum: string
  /** 最后已知工作目录（通过 OSC 7 序列追踪） */
  lastCwd: string
  /** 主窗口引用，用于向渲染进程发送 cwd 变化事件 */
  mainWindow: BrowserWindow | null
  /** OSC 7 序列累积缓冲区（处理跨数据块的分片序列） */
  osc7Buffer: string
}

/** ANSI 转义序列过滤正则 */
const ANSI_ESCAPE_RE = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g
const OSC_ESCAPE_RE = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g
/** 其他单字符转义: \x1b 后跟单个非打印字符 */
const SINGLE_ESCAPE_RE = /\x1b[\x20-\x2f]/g

function stripAnsi(text: string): string {
  return text
    .replace(OSC_ESCAPE_RE, '')
    .replace(ANSI_ESCAPE_RE, '')
    .replace(SINGLE_ESCAPE_RE, '')
}

export class TerminalIOTracker {
  private static instance: TerminalIOTracker | null = null
  private ptyStates = new Map<string, PtyState>()
  private writer = OperationFileWriter.getInstance()

  static getInstance(): TerminalIOTracker {
    if (!TerminalIOTracker.instance) {
      TerminalIOTracker.instance = new TerminalIOTracker()
    }
    return TerminalIOTracker.instance
  }

  registerPty(ptyId: string, sessionId: string, panelId: string, cwd: string, mainWindow: BrowserWindow | null): void {
    this.ptyStates.set(ptyId, { sessionId, panelId, outputAccum: '', lastCwd: cwd, mainWindow, osc7Buffer: '' })
  }

  unregisterPty(ptyId: string): void {
    const state = this.ptyStates.get(ptyId)
    if (state && state.outputAccum.length > 0) {
      // 将缓冲区剩余内容刷新到日志
      this.flushOutput(ptyId)
    }
    this.ptyStates.delete(ptyId)
  }

  onInput(ptyId: string, data: string): void {
    // 不记录输入
  }

  onOutput(ptyId: string, data: string): void {
    const state = this.ptyStates.get(ptyId)
    if (!state) return

    // OSC 7 序列累积检测（处理跨数据块分片）
    // 将新数据追加到缓冲区，然后扫描完整序列
    state.osc7Buffer += data

    // 限制缓冲区大小，避免内存泄漏（保留最近 2KB）
    const MAX_OSC7_BUF = 2048
    if (state.osc7Buffer.length > MAX_OSC7_BUF) {
      state.osc7Buffer = state.osc7Buffer.slice(-MAX_OSC7_BUF)
    }

    // 在累积缓冲区中查找所有完整的 OSC 7 序列，取最后一个（最新的 cwd）
    const osc7Regex = /\x1b]7;file:\/\/[^\/]*([^\x07\x1b]*)\x07/g
    let osc7Match: RegExpExecArray | null
    let lastCwd: string | null = null
    let lastEndIndex = 0
    let matchCount = 0
    while ((osc7Match = osc7Regex.exec(state.osc7Buffer)) !== null) {
      const rawPath = osc7Match[1]
      lastCwd = decodeURIComponent(rawPath)
      lastEndIndex = osc7Regex.lastIndex
      matchCount++
    }

    // 如果找到了完整的 OSC 7 序列，处理 cwd 变化
    if (lastCwd) {
      // 只清除已匹配的部分，保留缓冲区中可能存在的后续数据
      // 例如：OSC 7 后面紧跟的数据，或下一个未完成的 OSC 7 序列
      state.osc7Buffer = state.osc7Buffer.slice(lastEndIndex)

      if (lastCwd && lastCwd !== state.lastCwd) {
        state.lastCwd = lastCwd
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send(IPC_CHANNELS.PTY_CWD_CHANGED, {
            ptyId,
            cwd: lastCwd,
          })
        }
      }
    }

    const cleaned = stripAnsi(data)
    state.outputAccum += cleaned

    // 遇到换行符时，将已累积的内容按行刷新
    if (cleaned.includes('\n')) {
      this.flushOutput(ptyId)
    }
  }

  /**
   * 将输出缓冲区按行刷新到日志
   */
  private flushOutput(ptyId: string): void {
    const state = this.ptyStates.get(ptyId)
    if (!state || state.outputAccum.length === 0) return

    const lines = state.outputAccum.split('\n')
    // 最后一行可能不完整，保留在缓冲区
    const lastLine = lines.pop() || ''

    const now = new Date()
    const time = now.toLocaleTimeString('zh-CN', { hour12: false })

    for (const line of lines) {
      const trimmed = line.replace(/[\r\t ]+$/g, '').replace(/^[\r\t ]+/g, '')
      if (trimmed.length > 0) {
        this.writer.appendTerminalEntry({
          sessionId: state.sessionId,
          panelId: state.panelId,
          panelType: 'T',
          type: 'output',
          text: trimmed,
          time,
        })
      }
    }

    state.outputAccum = lastLine.replace(/[\r\t ]+$/g, '')
  }
}
