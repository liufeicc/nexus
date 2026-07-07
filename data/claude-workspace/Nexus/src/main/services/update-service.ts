/**
 * 自动更新服务
 *
 * 基于 electron-updater 实现私有 HTTP 服务器的自动更新功能。
 * 支持检查更新、下载更新、安装并重启。
 * 启动时自动延迟检查，渲染进程可手动触发。
 */

import { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'
import { logger } from '../utils/logger'

/**
 * 更新状态
 */
export type UpdateState =
  | 'idle'            // 初始状态，等待操作
  | 'checking'        // 正在检查更新
  | 'available'       // 发现新版本
  | 'downloading'     // 正在下载
  | 'downloaded'      // 下载完成，等待安装
  | 'not-available'   // 已是最新版本
  | 'error'           // 更新出错

/**
 * 更新信息
 */
interface UpdateInfo {
  version?: string
  releaseNotes?: string
}

/**
 * 状态数据（发送给渲染进程）
 */
interface StatePayload {
  state: UpdateState
  version?: string
  progress?: number
  releaseNotes?: string
}

/**
 * 自动更新服务
 *
 * 单例模式，与 DatabaseService / PtyService 保持一致。
 */
export class UpdateService {
  private static instance: UpdateService | null = null

  private mainWindow: BrowserWindow | null = null
  private state: UpdateState = 'idle'
  private updateInfo: UpdateInfo | null = null
  private initialized = false

  private constructor() {
    this.bindAutoUpdaterEvents()
  }

  static getInstance(): UpdateService {
    if (!UpdateService.instance) {
      UpdateService.instance = new UpdateService()
    }
    return UpdateService.instance
  }

  /**
   * 设置主窗口引用
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * 初始化服务
   *
   * 延迟 5 秒启动静默检查，避免与启动竞争。
   */
  initialize(): void {
    if (this.initialized) {
      return
    }
    this.initialized = true

    logger.info('[UpdateService] 初始化完成，5 秒后开始静默检查更新')

    // 延迟 5 秒检查，避免与启动竞争
    setTimeout(() => {
      this.checkForUpdates({ silent: true })
    }, 5000)
  }

  /**
   * 检查更新
   *
   * @param options.silent - 静默模式，无更新时不显示提示（用于启动时自动检查）
   */
  async checkForUpdates(options: { silent?: boolean } = {}): Promise<{ success: boolean; error?: string }> {
    if (!this.mainWindow) {
      const error = '主窗口未初始化'
      logger.error(`[UpdateService] ${error}`)
      return { success: false, error }
    }

    try {
      logger.info('[UpdateService] 开始检查更新...')
      this.setState('checking')
      this.updateInfo = null

      // electron-updater 会自动从 electron-builder.json 中的 publish URL 获取
      const result = await autoUpdater.checkForUpdates()

      if (!result?.updateInfo) {
        // 理论上不会走到这里，因为 checkForUpdates 无更新时会抛出 UpdateNotAvailableError
        this.setState('not-available')
        return { success: true }
      }

      // 有可用更新，update-available 事件会被触发
      logger.info(`[UpdateService] 发现新版本: ${result.updateInfo.version}`)
      return { success: true }
    } catch (error: any) {
      const errorMessage = error?.message || String(error)

      // 如果错误是"无可用更新"，视为正常
      if (errorMessage.includes('No available updates') || errorMessage.includes('Update not available')) {
        logger.info('[UpdateService] 已是最新版本')
        this.setState('not-available')
        return { success: true }
      }

      logger.error('[UpdateService] 检查更新失败:', error)
      this.setState('error')
      this.sendError(errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * 下载更新
   */
  async downloadUpdate(): Promise<{ success: boolean; error?: string }> {
    if (!this.mainWindow) {
      const error = '主窗口未初始化'
      logger.error(`[UpdateService] ${error}`)
      return { success: false, error }
    }

    try {
      logger.info('[UpdateService] 开始下载更新...')
      this.setState('downloading')

      // electron-updater 的 downloadUpdate 会触发 download-progress 事件
      await autoUpdater.downloadUpdate()

      // 正常情况下 update-downloaded 事件会被触发，这里不需要额外处理
      return { success: true }
    } catch (error: any) {
      const errorMessage = error?.message || String(error)
      logger.error('[UpdateService] 下载更新失败:', error)
      this.setState('error')
      this.sendError(errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * 安装更新并重启应用
   */
  async installAndRestart(): Promise<void> {
    if (!this.mainWindow) {
      logger.error('[UpdateService] 主窗口未初始化，无法安装更新')
      return
    }

    logger.info('[UpdateService] 安装更新并重启...')
    autoUpdater.quitAndInstall()
  }

  /**
   * 获取当前状态（供 IPC 处理器调用）
   */
  getState(): { state: UpdateState; updateInfo: UpdateInfo | null } {
    return { state: this.state, updateInfo: this.updateInfo }
  }

  /**
   * 更新内部状态并通知渲染进程
   */
  private setState(state: UpdateState, info?: Partial<UpdateInfo>): void {
    this.state = state

    if (info) {
      this.updateInfo = { ...this.updateInfo, ...info }
    }

    this.sendStateToRenderer()
  }

  /**
   * 向渲染进程发送状态变更事件
   */
  private sendStateToRenderer(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return
    }

    const payload: StatePayload = {
      state: this.state,
    }

    if (this.updateInfo) {
      payload.version = this.updateInfo.version
      payload.releaseNotes = this.updateInfo.releaseNotes
    }

    this.mainWindow.webContents.send(IPC_CHANNELS.UPDATE_STATE, payload)
  }

  /**
   * 向渲染进程发送错误通知
   */
  private sendError(message: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return
    }

    this.mainWindow.webContents.send(IPC_CHANNELS.UPDATE_ERROR, { error: message })
  }

  /**
   * 绑定 electron-updater 事件
   */
  private bindAutoUpdaterEvents(): void {
    autoUpdater.on('checking-for-update', () => {
      logger.info('[UpdateService] 正在检查更新...')
      this.setState('checking')
    })

    autoUpdater.on('update-available', (info) => {
      logger.info(`[UpdateService] 发现新版本: ${info.version}`)
      this.setState('available', {
        version: info.version,
        releaseNotes: info.releaseNotes as string | undefined,
      })
    })

    autoUpdater.on('update-not-available', () => {
      logger.info('[UpdateService] 已是最新版本')
      this.setState('not-available')
    })

    autoUpdater.on('download-progress', (progressObj) => {
      const percent = Math.round(progressObj.percent)
      logger.debug(`[UpdateService] 下载进度: ${percent}%`)

      // 通知渲染进程当前正在下载
      if (this.state !== 'downloading') {
        this.setState('downloading')
      }

      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        return
      }

      this.mainWindow.webContents.send(IPC_CHANNELS.UPDATE_STATE, {
        state: 'downloading',
        progress: percent,
        version: this.updateInfo?.version,
        releaseNotes: this.updateInfo?.releaseNotes,
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`[UpdateService] 更新下载完成: ${info.version}`)
      this.setState('downloaded', {
        version: info.version,
        releaseNotes: info.releaseNotes as string | undefined,
      })
    })

    autoUpdater.on('error', (error) => {
      logger.error('[UpdateService] 更新错误:', error)
      this.setState('error')
      this.sendError(error.message)
    })
  }
}
