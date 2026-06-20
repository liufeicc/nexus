/**
 * Nexus 连接管理器
 *
 * 职责：
 * 1. 管理面板的 Nexus 连接状态（双轨独立，浏览器与数据轨可同时连接）
 *    - 浏览器轨：独立，同一时间只能有一个浏览器面板连接
 *    - 数据轨：同一时间只能有一个终端或文件面板连接（两者互斥）
 * 2. 支持终端、浏览器、文件面板三种连接类型
 * 3. 终端连接：将智能体的终端命令路由到连接的 PTY 执行
 * 4. 浏览器连接：将智能体的浏览器操作路由到连接的 WebContentsView 执行
 *
 * 工作原理：
 * - 用户点击面板的"连接NEXUS"按钮后，此面板成为智能体命令执行目标
 * - 智能体调用 terminal/browser tool 时，命令被路由到连接的面板而非默认路径
 */

import { BrowserWindow } from 'electron'
import { PtyService } from './pty.service'
import { BrowserViewService } from './browser-view.service'
import { redactSensitiveText } from '../agent/utils/redact'
import { stripAnsi } from '../agent/utils/ansi-strip'

/**
 * 连接类型
 */
export type ConnectionType = 'terminal' | 'browser' | 'file-panel'

/**
 * 连接信息
 */
export interface ConnectionInfo {
  panelId: string
  type: ConnectionType
  ptyId?: string
  browserId?: string
  tabId?: string
}

/**
 * 命令执行结果
 */
interface CommandResult {
  success: boolean
  output: string
  data: {
    exitCode: number
    command: string
    cwd: string
  }
}

/**
 * PTY 输出监听器的 disposable（用于移除监听器）
 */
interface IDisposable {
  dispose(): void
}

/**
 * 当前连接中的命令信息
 */
interface PendingCommand {
  marker: string
  command: string
  cwd: string
  outputBuffer: string
  resolve: (result: CommandResult) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

/**
 * Nexus 连接管理器单例
 */
export class NexusConnectionManager {
  private static instance: NexusConnectionManager | null = null

  // ===== 浏览器轨（独立，与数据轨可同时连接） =====
  /** 当前连接的浏览器面板 ID */
  private browserPanelId: string | null = null

  // ===== 数据轨（终端和文件面板互斥，同一时间只能有一个） =====
  /** 当前连接的数据面板 ID（terminal 或 file-panel） */
  private dataPanelId: string | null = null
  /** 数据轨连接类型 */
  private dataConnectionType: 'terminal' | 'file-panel' | null = null
  /** 当前连接的 PTY ID（terminal 类型时使用） */
  private connectedPtyId: string | null = null

  /** 当前正在执行的命令 */
  private pendingCommand: PendingCommand | null = null

  /** PTY 输出监听器的 disposable（调用 dispose 可移除） */
  private outputDisposable: IDisposable | null = null

  /** 主窗口引用（用于广播事件） */
  private mainWindow: BrowserWindow | null = null

  private constructor() {}

  static getInstance(): NexusConnectionManager {
    if (!NexusConnectionManager.instance) {
      NexusConnectionManager.instance = new NexusConnectionManager()
    }
    return NexusConnectionManager.instance
  }

  /**
   * 设置主窗口引用
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * 获取浏览器轨连接信息
   * 动态读取当前活动标签（始终跟随用户正在查看的标签）
   */
  getBrowserConnection(): { panelId: string; browserId: string; tabId: string } | null {
    if (!this.browserPanelId) return null
    // 动态读取当前活动标签（始终跟随用户正在查看的标签）
    const activeTabId = BrowserViewService.getInstance().getActiveTabId(this.browserPanelId)
    if (!activeTabId) return null
    return {
      panelId: this.browserPanelId,
      browserId: this.browserPanelId,
      tabId: activeTabId,
    }
  }

  /**
   * 获取数据轨连接信息（terminal 或 file-panel）
   */
  getDataConnection(): ConnectionInfo | null {
    if (!this.dataPanelId || !this.dataConnectionType) return null
    const info: ConnectionInfo = {
      panelId: this.dataPanelId,
      type: this.dataConnectionType,
    }
    if (this.dataConnectionType === 'terminal' && this.connectedPtyId) {
      info.ptyId = this.connectedPtyId
    }
    return info
  }

  /**
   * 获取当前连接信息（兼容旧接口，返回数据轨连接）
   * @deprecated 使用 getDataConnection 或 getBrowserConnection 代替
   */
  getConnection(): ConnectionInfo | null {
    return this.getDataConnection()
  }

  /**
   * 获取数据轨连接类型
   */
  getConnectionType(): ConnectionType | null {
    return this.dataConnectionType
  }

  /**
   * 判断数据轨是否有面板处于连接状态
   */
  isConnected(): boolean {
    return this.dataPanelId !== null
  }

  /**
   * 判断浏览器轨是否有面板处于连接状态
   */
  isBrowserConnected(): boolean {
    return this.browserPanelId !== null
  }

  /**
   * 获取浏览器轨连接的面板 ID
   */
  getBrowserPanelId(): string | null {
    return this.browserPanelId
  }

  /**
   * 获取数据轨连接的面板 ID
   */
  getDataPanelId(): string | null {
    return this.dataPanelId
  }

  /**
   * 连接终端面板（仅影响数据轨，不影响浏览器轨）
   */
  connect(panelId: string, ptyId: string): { success: boolean; error?: string } {
    const ptyService = PtyService.getInstance()
    const session = ptyService.getPtySession(ptyId)
    if (!session) {
      return { success: false, error: 'PTY 会话不存在' }
    }

    // 断开旧的数据轨连接（不影响浏览器轨）
    if (this.dataPanelId && this.dataPanelId !== panelId) {
      this.disconnectData()
    }

    this.dataPanelId = panelId
    this.connectedPtyId = ptyId
    this.dataConnectionType = 'terminal'

    // 注册 PTY 数据过滤器：去掉 shell echo 行中的 marker 机制文本
    const filterPattern = /;\s*printf\s+"\\033\]0;NXDONE_[^"]*%d\\007"\s+"\$\?"/g
    ptyService.setDataFilter(ptyId, (data) => data.replace(filterPattern, ''))

    // 通知渲染进程连接状态变化
    this.notifyConnectionState(panelId, true, 'data')

    return { success: true }
  }

  /**
   * 断开数据轨连接（终端或文件面板）
   */
  disconnectData(): { success: boolean; error?: string } {
    const oldPanelId = this.dataPanelId
    const oldPtyId = this.connectedPtyId
    const oldType = this.dataConnectionType

    // 如果有正在执行的命令，先取消
    if (this.pendingCommand) {
      clearTimeout(this.pendingCommand.timeout)
      this.pendingCommand.reject(new Error('连接已断开'))
      this.pendingCommand = null
    }

    // 移除 PTY 输出监听器
    this.outputDisposable?.dispose()
    this.outputDisposable = null

    this.dataPanelId = null
    this.connectedPtyId = null
    this.dataConnectionType = null

    // 移除 PTY 数据过滤器（仅 terminal 类型）
    if (oldType === 'terminal' && oldPtyId) {
      PtyService.getInstance().removeDataFilter(oldPtyId)
    }

    if (oldPanelId) {
      this.notifyConnectionState(oldPanelId, false, 'data')
    }

    return { success: true }
  }

  /**
   * 断开浏览器轨连接
   */
  disconnectBrowser(): { success: boolean; error?: string } {
    const oldPanelId = this.browserPanelId
    this.browserPanelId = null
    if (oldPanelId) {
      this.notifyConnectionState(oldPanelId, false, 'browser')
    }
    return { success: true }
  }

  /**
   * 断开所有连接（数据轨 + 浏览器轨）
   */
  disconnect(): { success: boolean; error?: string } {
    this.disconnectData()
    this.disconnectBrowser()
    return { success: true }
  }

  /**
   * 连接浏览器面板（仅影响浏览器轨，不影响数据轨）
   * 只需 panelId，标签跟随通过 getBrowserConnection() 动态获取活动标签实现
   */
  connectBrowser(panelId: string): { success: boolean; error?: string } {
    // 断开旧的浏览器轨连接（不影响数据轨）
    if (this.browserPanelId && this.browserPanelId !== panelId) {
      this.disconnectBrowser()
    }
    this.browserPanelId = panelId
    // 通知渲染进程连接状态变化
    this.notifyConnectionState(panelId, true, 'browser')
    return { success: true }
  }

  /**
   * 连接文件面板（仅影响数据轨，不影响浏览器轨）
   * 文件面板不需要 PTY 或 BrowserView，仅记录连接状态
   */
  connectFilePanel(panelId: string): { success: boolean; error?: string } {
    // 断开旧的数据轨连接（不影响浏览器轨）
    if (this.dataPanelId && this.dataPanelId !== panelId) {
      this.disconnectData()
    }

    this.dataPanelId = panelId
    this.dataConnectionType = 'file-panel'

    // 通知渲染进程连接状态变化
    this.notifyConnectionState(panelId, true, 'data')

    return { success: true }
  }

  /**
   * 处理 PTY 被销毁的情况（面板被关闭）
   */
  onPtyDestroyed(ptyId: string): void {
    if (this.dataConnectionType === 'terminal' && this.connectedPtyId === ptyId) {
      if (this.pendingCommand) {
        clearTimeout(this.pendingCommand.timeout)
        this.pendingCommand.reject(new Error('终端面板已关闭'))
        this.pendingCommand = null
      }
      // 移除 PTY 输出监听器
      this.outputDisposable?.dispose()
      this.outputDisposable = null
      const panelId = this.dataPanelId
      this.dataPanelId = null
      this.connectedPtyId = null
      // 移除数据过滤器
      PtyService.getInstance().removeDataFilter(ptyId)
      if (panelId) {
        this.notifyConnectionState(panelId, false, 'data')
      }
    }
  }

  /**
   * 中断当前正在执行的命令
   * 当用户点击停止按钮时调用，向 PTY 发送 Ctrl+C 并取消等待中的 Promise
   */
  interruptCommand(): void {
    if (!this.pendingCommand || !this.connectedPtyId) return

    // 向 PTY 发送 Ctrl+C 终止正在运行的进程
    const ptyService = PtyService.getInstance()
    const session = ptyService.getPtySession(this.connectedPtyId)
    if (session) {
      session.pty.write('\x03')
    }

    // 取消等待中的 Promise
    clearTimeout(this.pendingCommand.timeout)
    this.pendingCommand.reject(new Error('命令已被中断'))
    this.pendingCommand = null
  }

  /**
   * 在连接的 PTY 上执行命令
   *
   * 工作流程：
   * 1. 将命令和 marker 一起写入 PTY
   * 2. 监听 PTY 输出，累积到 buffer 并通过 onUpdate 回调推送
   * 3. 检测到 marker 后认为命令完成，提取退出码
   * 4. 超时保护（默认 30 秒），超时后发送 Ctrl+C 尝试中断
   *
   * @param command - 要执行的命令
   * @param cwd - 工作目录（用于 cd 前缀）
   * @param onUpdate - 流式输出回调
   * @returns 命令执行结果
   */
  async executeCommand(
    command: string,
    cwd: string,
    onUpdate?: (chunk: string) => void
  ): Promise<CommandResult> {
    if (!this.connectedPtyId) {
      throw new Error('Nexus 未连接任何终端面板')
    }

    if (this.dataConnectionType !== 'terminal') {
      throw new Error('当前连接不是终端面板')
    }

    // 检查是否有命令正在执行
    if (this.pendingCommand) {
      throw new Error('上一个命令仍在执行中')
    }

    const ptyService = PtyService.getInstance()
    const session = ptyService.getPtySession(this.connectedPtyId)
    if (!session) {
      throw new Error('PTY 会话已消失')
    }

    // 生成唯一 marker（包含随机字符防止冲突）
    const random = Math.random().toString(36).slice(2, 8)
    const marker = `NXDONE_${Date.now()}_${random}`

    // 构建命令：
    // - 用子 shell (cd ... && cmd) 隔离 cd，避免改变终端 CWD
    // - printf 输出 OSC 序列 \033]0;NXDONE_xxx_N\007，xterm.js 消费 OSC 不显示
    const cmdBody = cwd
      ? `(cd "${cwd}" 2>/dev/null && ${command})`
      : command
    const writeData = `${cmdBody}; printf "\\033]0;${marker}%d\\007" "$?"\n`

    return new Promise<CommandResult>((resolve, reject) => {
      // 设置超时保护（60 秒）
      const timeout = setTimeout(() => {
        // 发送 Ctrl+C 尝试中断
        session.pty.write('\x03')
        // 再等 3 秒
        setTimeout(() => {
          if (this.pendingCommand?.marker === marker) {
            const result = this.finishCommand(
              '[命令超时，已尝试中断]\n',
              -1,
              false
            )
            if (result) resolve(result)
          }
        }, 3000)
      }, 60000)

      this.pendingCommand = {
        marker,
        command,
        cwd,
        outputBuffer: '',
        resolve,
        reject,
        timeout,
      }

      // 注册临时输出监听
      this.setupOutputListener(session.pty, marker, onUpdate)

      // 写入命令到 PTY
      session.pty.write(writeData)
    })
  }

  /**
   * 设置 PTY 输出监听器
   */
  private setupOutputListener(
    ptyProcess: { onData: (cb: (data: string) => void) => IDisposable },
    marker: string,
    onUpdate?: (chunk: string) => void
  ): void {
    // 先清理旧的监听器
    this.outputDisposable?.dispose()
    this.outputDisposable = null

    const commandMarker = marker
    let done = false

    const handler = (data: string) => {
      if (done || !this.pendingCommand) return
      if (this.pendingCommand.marker !== commandMarker) return

      // 累积输出
      this.pendingCommand.outputBuffer += data

      // 通过 onUpdate 回调推送流式输出（仅推送 marker 之前的部分）
      if (onUpdate) {
        onUpdate(data)
      }

      // 检测 OSC marker：\x1b]0;NXDONE_xxx_N\x07
      const oscPattern = new RegExp(`\\x1b\\]0;${this.pendingCommand.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\\x07`)
      const oscMatch = this.pendingCommand.outputBuffer.match(oscPattern)
      if (oscMatch && oscMatch.index !== undefined) {
        done = true
        clearTimeout(this.pendingCommand.timeout)

        const exitCode = parseInt(oscMatch[1], 10)

        // 只取 marker 之前的输出（不含 marker 本身）
        const cleanOutput = this.pendingCommand.outputBuffer.slice(0, oscMatch.index).trimEnd()

        const result = this.finishCommand(cleanOutput, exitCode, exitCode === 0)
        if (result) this.pendingCommand.resolve(result)

        this.pendingCommand = null
        // 命令完成后移除监听器
        this.outputDisposable?.dispose()
        this.outputDisposable = null
      }
    }

    // 注册监听器并保存 disposable，可随时通过 dispose() 移除
    this.outputDisposable = ptyProcess.onData(handler)
  }

  /**
   * 完成命令执行，清理输出并返回结果
   */
  private finishCommand(
    output: string,
    exitCode: number,
    success: boolean
  ): CommandResult {
    // 清理 ANSI 转义序列
    let cleanOutput = stripAnsi(output)

    // 截断过长的输出（50000 字符）
    const MAX_OUTPUT_CHARS = 50000
    if (cleanOutput.length > MAX_OUTPUT_CHARS) {
      const headLen = Math.floor(MAX_OUTPUT_CHARS * 0.4)
      const tailLen = MAX_OUTPUT_CHARS - headLen
      cleanOutput = cleanOutput.slice(0, headLen)
        + '\n\n... [输出已截断，共 ' + output.length + ' 字符] ...\n\n'
        + cleanOutput.slice(-tailLen)
    }

    // 脱敏
    cleanOutput = redactSensitiveText(cleanOutput.trim())

    return {
      success,
      output: cleanOutput,
      data: {
        exitCode,
        command: this.pendingCommand?.command || '',
        cwd: this.pendingCommand?.cwd || '',
      },
    }
  }

  /**
   * 通知渲染进程连接状态变化
   * @param track - 轨道类型：'browser'（浏览器轨）或 'data'（数据轨）
   */
  private notifyConnectionState(panelId: string, connected: boolean, track: 'browser' | 'data'): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('nexus:connection-state-changed', {
        panelId,
        connected,
        track,
      })
    }
  }
}
