/**
 * 应用面板服务（门面层）
 *
 * 职责：选择当前平台的后端实现（linux→XephyrBackend，win32→Win32Backend），
 * 持有主窗口引用并向渲染进程推送状态事件。
 * 具体嵌入逻辑见 xephyr.backend.ts / win32.backend.ts；跨平台接口见 backend.ts。
 */

import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import type { AppPanelBackend, PanelBounds, EmbeddedApp } from './backend'
import { XephyrBackend } from './xephyr.backend'
import { Win32Backend } from './win32.backend'
import { listInstalledApps } from './app-catalog'

// 重导出供 handler / 其他模块使用
export type { PanelBounds, EmbeddedApp, AppPanelRunState } from './backend'

export class AppPanelService {
  private static instance: AppPanelService | null = null

  private mainWindow: BrowserWindow | null = null
  private backend: AppPanelBackend

  private constructor() {
    // 按平台路由后端：win32→SetParent 过继（Win32Backend），其余→Xephyr
    const onState = (panelId: string, state: string, detail?: string) => this.emit(panelId, state, detail)
    this.backend = process.platform === 'win32'
      ? new Win32Backend(onState)
      : new XephyrBackend(onState)
  }

  static getInstance(): AppPanelService {
    if (!AppPanelService.instance) {
      AppPanelService.instance = new AppPanelService()
    }
    return AppPanelService.instance
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
    this.backend.setMainWindow(window)
  }

  /** 向渲染进程推送面板状态 */
  private emit(panelId: string, state: string, detail?: string): void {
    this.mainWindow?.webContents.send(IPC_CHANNELS.APP_PANEL_STATE_CHANGED, { panelId, state, detail })
  }

  /** 当前环境是否支持应用面板 */
  supported(): Promise<{ available: boolean; reason?: string }> {
    return this.backend.isAvailable()
  }

  /**
   * exec 白名单校验（review 0.6.11 I-2）：
   * launch 的 exec 在创建时来自应用扫描，但快照恢复/重拉起时来自快照 JSON，
   * 而快照可被渲染进程侧攻击（如 XSS）污染并持久化。此处将可启动的命令收敛为
   * "与当前平台应用扫描结果完全一致"，阻断任意命令执行通道。
   * 归一化规则与 cleanExec/exec 拼串输出形态一致：空白折叠为单空格 + 去首尾空白。
   * 扫描结果带 5 分钟缓存，本校验无额外 IO 成本；应用变更导致旧快照失配时，
   * 面板进入 error 态提示重新选择应用（安全优先的可接受代价）。
   * 注：Windows 侧扫描经桥接 daemon 异步完成，故本方法为 async（launch 本就 async）。
   */
  private async isExecAllowed(exec: string): Promise<boolean> {
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim()
    const target = normalize(exec || '')
    if (!target) return false
    const apps = await listInstalledApps()
    return apps.some(a => normalize(a.exec) === target)
  }

  /** 启动虚拟显示器并运行程序 */
  async launch(panelId: string, app: EmbeddedApp, bounds: PanelBounds): Promise<{ success: boolean; error?: string }> {
    if (!(await this.isExecAllowed(app.exec))) {
      console.warn(`[AppPanel] 拒绝启动白名单外的命令: "${app.exec}"`)
      return {
        success: false,
        error: '该应用命令不在允许列表中（可能来自损坏的快照），请关闭面板后重新选择应用',
      }
    }
    return this.backend.launch(panelId, app, bounds)
  }

  /** 同步面板几何 */
  setBounds(panelId: string, bounds: PanelBounds): void {
    this.backend.setBounds(panelId, bounds)
  }

  /** 显示/隐藏面板 */
  setVisible(panelId: string, visible: boolean): void {
    this.backend.setVisible(panelId, visible)
  }

  /** 关闭面板 */
  kill(panelId: string): Promise<void> {
    return this.backend.kill(panelId)
  }

  /** 切换放大镜（与面板内中键等效）。
   * 返回三态数值：0=关 1=跟随 2=固定；直嵌/无会话返回 null */
  toggleLoupe(panelId: string): Promise<number | null> {
    return this.backend.toggleLoupe(panelId)
  }

  /** 应用退出清理 */
  dispose(): void {
    this.backend.dispose()
  }
}
