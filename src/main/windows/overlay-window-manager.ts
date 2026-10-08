/**
 * 共享置顶弹层窗口管理器
 *
 * 职责：
 * 1. 创建透明无边框 overlay 窗口（parent=主窗口，bounds 始终等于主窗口 contentBounds）
 * 2. 跟随主窗口 move/resize/maximize/unmaximize（Linux 用 setBounds）
 * 3. 按渲染进程上报的 visibility 显隐：modal 模式抢焦点、menu 模式不抢；全关回焦主窗口
 * 4. 中继两渲染进程间的 overlay 协议（快照/action 代理/token 回调/事件中继）
 *
 * Linux/X11 说明：setIgnoreMouseEvents 的 forward 选项在 Linux 不可用，
 * 故右键菜单的"外点关闭"由 overlay 内全屏透明点击捕获实现（overlay 显示期间接管点击），
 * 本管理器不做命中测试穿透。
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import {
  OVERLAY_CHANNELS,
  type OverlayVisibility,
  type OverlayActionRequest,
  type OverlayCallbackRequest,
  type OverlayEventMessage,
} from '../../renderer/overlay/protocol'

/** action/callback 往返超时（毫秒） */
const REQUEST_TIMEOUT_MS = 15000

export class OverlayWindowManager {
  private overlayWindow: BrowserWindow | null = null
  private mainWindow: BrowserWindow | null = null
  /** 最近一次 visibility（overlay hello 时重放） */
  private lastVisibility: OverlayVisibility = { visible: false, mode: 'modal' }
  /** 回焦防抖定时器 */
  private refocusTimer: NodeJS.Timeout | null = null
  /** action/callback 往返的 pending 表 */
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

  getWindow(): BrowserWindow | null {
    return this.overlayWindow
  }

  /**
   * 创建 overlay 窗口并注册 IPC 中继
   */
  createOverlayWindow(mainWin: BrowserWindow): void {
    this.mainWindow = mainWin
    const bounds = mainWin.getContentBounds()
    console.log(`[Overlay] 创建弹层窗口 bounds=${JSON.stringify(bounds)}`)

    this.overlayWindow = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      // 透明无边框、不进任务栏；始终可聚焦（模态需要键盘输入/Enter/Esc）
      frame: false,
      transparent: true,
      skipTaskbar: true,
      focusable: true,
      show: false,
      // utility 类型 + 父子关系：GNOME 概览/切换器不把它列为独立窗口，
      // 避免用户误以为弹层是"另一个进程"（实测焦点/输入不受影响）
      type: 'utility',
      // 置顶保证浮在主窗口的原生层（Xephyr 容器/WebContentsView）之上
      alwaysOnTop: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(app.getAppPath(), 'dist/preload.js'),
      },
    })

    // 子窗口跟随父窗口 z-order 与生命周期
    this.overlayWindow.setParentWindow(mainWin)

    if (process.env.VITE_DEV_SERVER_URL) {
      this.overlayWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}overlay.html`)
    } else {
      this.overlayWindow.loadFile(path.join(app.getAppPath(), 'dist/renderer/overlay.html'))
    }
    this.overlayWindow.webContents.on('did-fail-load', (_e, code, desc) => {
      console.error(`[Overlay] 加载失败: ${code} ${desc}`)
    })
    console.log(`[Overlay] 弹层窗口已创建 id=${this.overlayWindow.id}`)

    // 跟随主窗口几何（Linux 下 setSize 可能无法缩小，统一 setBounds）
    const syncBounds = () => this.syncBounds()
    mainWin.on('move', syncBounds)
    mainWin.on('resize', syncBounds)
    mainWin.on('maximize', syncBounds)
    mainWin.on('unmaximize', syncBounds)
    mainWin.on('minimize', () => this.overlayWindow?.hide())
    mainWin.on('restore', () => {
      this.syncBounds()
      if (this.lastVisibility.visible) this.overlayWindow?.show()
    })
    mainWin.on('closed', () => {
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) this.overlayWindow.destroy()
      this.overlayWindow = null
    })

    this.registerIpcHandlers()
  }

  /** overlay bounds 始终与主窗口内容区 1:1（弹层坐标无需换算） */
  private syncBounds(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return
    this.overlayWindow.setBounds(this.mainWindow.getContentBounds())
  }

  /**
   * 应用渲染进程上报的弹层显隐：
   * - visible：显示窗口；modal 模式抢焦点（模态语义），menu 模式不抢
   * - hidden：隐藏窗口并防抖回焦主窗口
   */
  private applyVisibility(v: OverlayVisibility): void {
    this.lastVisibility = v
    const win = this.overlayWindow
    if (!win || win.isDestroyed()) return
    if (this.refocusTimer) {
      clearTimeout(this.refocusTimer)
      this.refocusTimer = null
    }
    if (v.visible) {
      this.syncBounds()
      if (v.mode === 'modal') {
        win.show()
        win.focus()
      } else {
        win.showInactive()
      }
    } else {
      win.hide()
      // 防抖回焦主窗口，避免连续开关弹层时焦点抖动
      this.refocusTimer = setTimeout(() => {
        if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.lastVisibility.visible) {
          this.mainWindow.focus()
        }
      }, 50)
    }
  }

  /** 向指定窗口发请求并等待其渲染进程响应（action/双向 callback 共用） */
  private forwardTo(win: BrowserWindow, channel: string, payload: { reqId: string }): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!win || win.isDestroyed()) {
        reject(new Error('目标窗口不可用'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(payload.reqId)
        reject(new Error(`overlay 请求超时: ${payload.reqId}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(payload.reqId, { resolve, reject, timer })
      win.webContents.send(channel, payload)
    })
  }

  private registerIpcHandlers(): void {
    // overlay 握手：要求主窗口立即重推快照（覆盖 overlay 重载/HMR 场景）
    ipcMain.on(OVERLAY_CHANNELS.HELLO, () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(OVERLAY_CHANNELS.PUSH_NOW)
      }
      // 重放最近显隐状态，避免 overlay 重载后窗口显隐失步
      this.applyVisibility(this.lastVisibility)
    })

    // 主窗口桥接就绪（overlay 未就绪期间的状态由后续 push 覆盖）
    ipcMain.on(OVERLAY_CHANNELS.MAIN_READY, () => {
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.webContents.send(OVERLAY_CHANNELS.PUSH_NOW)
      }
    })

    // 快照转发：主渲染 → overlay
    ipcMain.on(OVERLAY_CHANNELS.SNAPSHOT_PUSH, (_e, msg: { seq: number; slice: unknown }) => {
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.webContents.send(OVERLAY_CHANNELS.SNAPSHOT, msg)
      }
    })

    // 显隐上报：驱动 overlay 窗口显隐与焦点
    ipcMain.on(OVERLAY_CHANNELS.VISIBILITY, (_e, v: OverlayVisibility) => this.applyVisibility(v))

    // action 代理往返：overlay invoke → 主渲染执行 → 回 overlay
    ipcMain.handle(OVERLAY_CHANNELS.ACTION, async (_e, req: OverlayActionRequest) => {
      try {
        return await this.forwardTo(this.mainWindow!, OVERLAY_CHANNELS.ACTION_REQUEST, req)
      } catch (err) {
        return { reqId: req.reqId, ok: false, error: String(err) }
      }
    })

    // token 回调往返：overlay invoke → 主渲染执行真实闭包 → 回 overlay
    ipcMain.handle(OVERLAY_CHANNELS.CALLBACK, async (_e, req: OverlayCallbackRequest) => {
      try {
        return await this.forwardTo(this.mainWindow!, OVERLAY_CHANNELS.CALLBACK_REQUEST, req)
      } catch (err) {
        return { reqId: req.reqId, ok: false, error: String(err) }
      }
    })

    // 反向 token 回调：主渲染 invoke → overlay 执行本地闭包 → 回主渲染
    // （overlay 组件向 action 参数传的函数，经自动 token 化后由此通道回程）
    ipcMain.handle(OVERLAY_CHANNELS.CALLBACK_REV, async (_e, req: OverlayCallbackRequest) => {
      try {
        return await this.forwardTo(this.overlayWindow!, OVERLAY_CHANNELS.CALLBACK_REV_REQUEST, req)
      } catch (err) {
        return { reqId: req.reqId, ok: false, error: String(err) }
      }
    })

    // 执行结果回传（主渲染 → 主进程 resolve pending）
    const onResponse = (_e: Electron.IpcMainEvent, res: { reqId: string; ok: boolean; value?: unknown; error?: string }) => {
      const p = this.pending.get(res.reqId)
      if (!p) return
      this.pending.delete(res.reqId)
      clearTimeout(p.timer)
      p.resolve(res)
    }
    ipcMain.on(OVERLAY_CHANNELS.ACTION_RESPONSE, onResponse)
    ipcMain.on(OVERLAY_CHANNELS.CALLBACK_RESPONSE, onResponse)
    ipcMain.on(OVERLAY_CHANNELS.CALLBACK_REV_RESPONSE, onResponse)

    // CustomEvent 白名单中继：发给"对面"窗口
    ipcMain.on(OVERLAY_CHANNELS.EVENT, (e, msg: OverlayEventMessage) => {
      const fromOverlay = this.overlayWindow && e.sender.id === this.overlayWindow.webContents.id
      const target = fromOverlay ? this.mainWindow : this.overlayWindow
      if (target && !target.isDestroyed()) {
        target.webContents.send(OVERLAY_CHANNELS.EVENT, msg)
      }
    })
  }

  /** 注销 IPC（应用退出清理） */
  unregisterIpcHandlers(): void {
    ipcMain.removeAllListeners(OVERLAY_CHANNELS.HELLO)
    ipcMain.removeAllListeners(OVERLAY_CHANNELS.MAIN_READY)
    ipcMain.removeAllListeners(OVERLAY_CHANNELS.SNAPSHOT_PUSH)
    ipcMain.removeAllListeners(OVERLAY_CHANNELS.VISIBILITY)
    ipcMain.removeAllListeners(OVERLAY_CHANNELS.ACTION_RESPONSE)
    ipcMain.removeAllListeners(OVERLAY_CHANNELS.CALLBACK_RESPONSE)
    ipcMain.removeAllListeners(OVERLAY_CHANNELS.CALLBACK_REV_RESPONSE)
    ipcMain.removeAllListeners(OVERLAY_CHANNELS.EVENT)
    ipcMain.removeHandler(OVERLAY_CHANNELS.ACTION)
    ipcMain.removeHandler(OVERLAY_CHANNELS.CALLBACK)
    ipcMain.removeHandler(OVERLAY_CHANNELS.CALLBACK_REV)
  }

  destroy(): void {
    this.unregisterIpcHandlers()
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.destroy()
    }
    this.overlayWindow = null
  }
}
