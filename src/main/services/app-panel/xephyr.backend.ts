/**
 * Xephyr 后端（Linux/X11）
 *
 * 每个应用面板 = 一个 Xephyr 虚拟显示器，两种嵌入模式（launch 时判定）：
 *
 * direct（现状）：
 *   1. 在宿主窗口面板区域创建"容器子窗口"（桥接 daemon 持有，持久不销毁）
 *   2. Xephyr -parent <容器> 嵌入，-screen 取宿主根窗口尺寸作上限
 *   3. 将 Xephyr 的输出窗口（容器的首个子窗口）缩放到面板尺寸，嵌套分辨率随面板变化
 *   4. DISPLAY=:N 启动目标程序，原生渲染/输入
 *
 * scale（面板小于虚拟分辨率下限时启用，"放大分辨率 + 缩放显示全貌"）：
 *   1. 容器子窗口仍按面板尺寸创建，但仅作"缩放画布"
 *   2. 屏外 scratch 顶层窗口作 Xephyr 父窗口，-screen 取 max(root, virtual) 上限
 *   3. Xephyr 输出窗口设为虚拟分辨率（≥1600x900，等比面板），应用按大分辨率正常布局
 *   4. daemon 将屏外画面经 Composite+XRender 缩放合成进容器，输入换算注入 :N
 *   5. 面板拉大超过当前 virtual 时只增不减地提升虚拟分辨率（RANDR 跟随输出窗口尺寸）
 *
 * 降级：scale 初始化失败 → 拆除并以 direct 整体重启该会话（防循环标志）。
 */

import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app as electronApp, BrowserWindow } from 'electron'
import { X11BridgeService } from './x11-bridge.service'
import { splitExec } from './exec-utils'
import type { AppPanelBackend, PanelBounds, EmbeddedApp, AppPanelStateListener } from './backend'

/** 虚拟分辨率下限：面板小于该尺寸时启用缩放模式 */
const MIN_VIRTUAL_W = 1600
const MIN_VIRTUAL_H = 900
/** 虚拟分辨率上限：极端宽高比超限回落直嵌，防帧缓冲爆炸 */
const MAX_VIRTUAL = 4096

/** 单个应用面板的嵌入会话 */
interface XephyrSession {
  panelId: string
  display: number
  containerXid: number
  /** Xephyr 输出窗口（父窗口的子窗口），用于同步分辨率 */
  xephyrWinXid: number | null
  xephyr: ChildProcess | null
  app: ChildProcess | null
  state: string
  /** 本次会话启动的程序命令（用于判断"更换应用"需要整体重启） */
  appExec: string
  /** 看门狗是否曾观察到虚拟显示器内的窗口（区分"launcher 脱管"与"程序真退出"） */
  seenWindow: boolean
  /** 启动进程已以 code=0 退出但窗口尚未出现（launcher 脱管候选），由看门狗宽限判定 */
  launcherExitPending: boolean
  /** 看门狗定时器：周期铺满主窗口 + 检测程序退出 */
  watchdogTimer?: NodeJS.Timeout
  /** 嵌入模式：direct=嵌套分辨率随面板（现状）；scale=大虚拟分辨率缩放显示 */
  mode: 'direct' | 'scale'
  /** scale 模式参数（虚拟分辨率只增不减；scratch 为屏外父窗口） */
  scale?: { virtualW: number; virtualH: number; scratchXid: number }
  /** scale 初始化失败降级 direct 重启的防循环标志 */
  scaleFallbackDone?: boolean
  /** running 状态是否已推送渲染进程（M-2：看门狗确认首帧并 map 容器后才推送） */
  runningAnnounced: boolean
}

export class XephyrBackend implements AppPanelBackend {
  private bridge = X11BridgeService.getInstance()
  private sessions = new Map<string, XephyrSession>()
  /** launch 防重入集合（React StrictMode 双挂载保护） */
  private launching = new Set<string>()
  private electronXid: number | null = null
  private mainWindow: BrowserWindow | null = null

  constructor(private onState: AppPanelStateListener) {
    // daemon 意外退出 → 容器窗口必被销毁 → 中断全部会话
    this.bridge.onDaemonExit(() => this.handleBridgeExit())
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    return this.bridge.isAvailable()
  }

  private getElectronXid(): number {
    if (this.electronXid !== null) return this.electronXid
    if (!this.mainWindow) throw new Error('主窗口尚未初始化')
    const buf = this.mainWindow.getNativeWindowHandle()
    const xid = buf.readUInt32LE(0)
    if (!xid) throw new Error('无法获取宿主窗口 XID')
    this.electronXid = xid
    return xid
  }

  /** 分配空闲显示号（避开系统占用与自用） */
  private allocateDisplay(): number {
    const used = new Set(Array.from(this.sessions.values()).map(s => s.display))
    for (let n = 100; n < 200; n++) {
      if (used.has(n)) continue
      if (fs.existsSync(`/tmp/.X11-unix/X${n}`)) continue
      if (fs.existsSync(`/tmp/.X${n}-lock`)) continue
      return n
    }
    throw new Error('无可用显示号（:100-:199 均已占用）')
  }

  private async waitForDisplay(display: number, timeoutMs: number): Promise<void> {
    const socket = `/tmp/.X11-unix/X${display}`
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (fs.existsSync(socket)) return
      await new Promise(r => setTimeout(r, 100))
    }
    throw new Error(`等待 Xephyr 显示 :${display} 就绪超时`)
  }

  /** 轮询等待父窗口出现子窗口（Xephyr 输出窗口创建晚于 socket 就绪） */
  private async waitForChildren(parentXid: number, timeoutMs: number): Promise<number[]> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        const kids = await this.bridge.children(parentXid)
        if (kids.length > 0) return kids
      } catch { /* 桥接瞬时异常忽略，下轮重试 */ }
      if (Date.now() >= deadline) return []
      await new Promise(r => setTimeout(r, 200))
    }
  }

  async launch(
    panelId: string,
    app: EmbeddedApp,
    bounds: PanelBounds,
  ): Promise<{ success: boolean; error?: string }> {
    // 已有会话的处理：
    // - 同一程序且仍在启动/运行中（如 React StrictMode 双挂载）→ 仅同步几何，直接返回
    // - 更换了程序 / 旧会话已退出或失败 → 先彻底清理旧会话，再全新启动
    const existing = this.sessions.get(panelId)
    if (existing) {
      const sameApp = existing.appExec === app.exec
      const alive = existing.state === 'starting' || existing.state === 'running'
      if (sameApp && alive) {
        this.setBounds(panelId, bounds)
        return { success: true }
      }
      await this.kill(panelId)
    }
    return this.doLaunch(panelId, app, bounds, false)
  }

  /** 实际启动流程；forceDirect=true 表示 scale 初始化失败降级重启（防循环） */
  private async doLaunch(
    panelId: string,
    app: EmbeddedApp,
    bounds: PanelBounds,
    forceDirect: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    if (this.launching.has(panelId)) return { success: true }
    this.launching.add(panelId)

    try {
      // 命令分词前置（review 0.6.11 I-3）：在任何资源创建前完成，
      // 命令为空时直接失败返回，避免拉起 Xephyr 后才发现而泄漏
      const argv = splitExec(app.exec)
      if (argv.length === 0) return { success: false, error: '启动命令为空' }

      const support = await this.isAvailable()
      if (!support.available) return { success: false, error: support.reason }

      const electronXid = this.getElectronXid()
      const display = this.allocateDisplay()
      const width = Math.max(100, Math.round(bounds.width))
      const height = Math.max(100, Math.round(bounds.height))

      // 模式判定：面板小于虚拟下限、环境支持缩放、放大后不超上限 → scale
      let mode: 'direct' | 'scale' = 'direct'
      let virtualW = width
      let virtualH = height
      if (!forceDirect) {
        const caps = await this.bridge.caps().catch(() => ({ scale: false }))
        const scaleUp = Math.max(MIN_VIRTUAL_W / width, MIN_VIRTUAL_H / height, 1)
        if (caps.scale && scaleUp > 1) {
          const vw = Math.round(width * scaleUp)
          const vh = Math.round(height * scaleUp)
          if (vw <= MAX_VIRTUAL && vh <= MAX_VIRTUAL) {
            mode = 'scale'
            virtualW = vw
            virtualH = vh
          }
        }
      }
      console.log(`[AppPanel] launch panelId=${panelId} exec="${app.exec}" :${display} mode=${mode} bounds=${JSON.stringify(bounds)} virtual=${virtualW}x${virtualH}`)

      // 宿主根窗口尺寸作为 -screen 上限（RANDR 只允许不大于该值）；scale 模式并包纳 virtual
      let rootW = width
      let rootH = height
      try {
        const root = await this.bridge.rootGeometry()
        rootW = Math.max(rootW, root.width)
        rootH = Math.max(rootH, root.height)
      } catch { /* 取不到上限则退化为面板尺寸 */ }
      const ceilW = Math.max(rootW, virtualW)
      const ceilH = Math.max(rootH, virtualH)

      // 1) 容器子窗口（先隐藏，待程序就绪再显示，避免启动期间黑屏遮挡 DOM 状态层）
      const containerXid = await this.bridge.createChild(
        electronXid, Math.round(bounds.x), Math.round(bounds.y), width, height,
      )
      await this.bridge.unmap(containerXid)

      const session: XephyrSession = {
        panelId, display, containerXid, xephyrWinXid: null,
        xephyr: null, app: null, state: 'starting',
        appExec: app.exec, seenWindow: false, launcherExitPending: false,
        mode,
        scale: mode === 'scale' ? { virtualW, virtualH, scratchXid: 0 } : undefined,
        scaleFallbackDone: forceDirect,
        runningAnnounced: false,
      }
      this.sessions.set(panelId, session)

      try {
        // 2) scale 模式先建屏外 scratch 作 Xephyr 父窗口；direct 模式沿用容器嵌入
        let parentXid = containerXid
        if (mode === 'scale' && session.scale) {
          session.scale.scratchXid = await this.bridge.createTop(ceilW, ceilH)
          parentXid = session.scale.scratchXid
        }

        const xephyr = spawn('Xephyr', [
          `:${display}`,
          '-parent', String(parentXid),
          '-screen', `${ceilW}x${ceilH}`,
          '-no-host-grab',
        ], { detached: true, stdio: 'ignore', env: { ...process.env } })
        session.xephyr = xephyr
        xephyr.on('exit', (code) => {
          console.warn(`[AppPanel] Xephyr 退出 :${display} code=${code} state=${session.state}`)
          this.stopWatchdog(session)
          if (session.state === 'starting') {
            session.state = 'error'
            this.onState(panelId, 'error', `Xephyr 异常退出（code=${code}）`)
          } else if (session.state === 'running') {
            session.state = 'exited'
            this.onState(panelId, 'exited')
          }
          this.hideContainer(session)
        })

        await this.waitForDisplay(display, 8000)

        // 3) 定位 Xephyr 输出窗口（父窗口的首个子窗口，轮询重试）并设目标分辨率：
        //    scale=虚拟分辨率（嵌套 RANDR 跟随输出窗口尺寸）；direct=面板尺寸
        const kids = await this.waitForChildren(parentXid, 3000)
        if (kids.length > 0) {
          session.xephyrWinXid = kids[0]
          await this.bridge.moveResize(kids[0], 0, 0, virtualW, virtualH)
        } else {
          console.warn('[AppPanel] 未定位到 Xephyr 输出窗口（交由看门狗兜底）')
        }

        // 3.5) scale 模式注册缩放会话（合成+输入转发）；失败抛错由下方降级处理
        if (mode === 'scale' && session.xephyrWinXid) {
          await this.bridge.scaleStart(containerXid, session.xephyrWinXid, `:${display}`)
        }
      } catch (e) {
        if (mode === 'scale') {
          // scale 初始化失败：拆除本次会话并以 direct 整体重启（此时应用尚未首帧，代价低）
          console.warn(`[AppPanel] scale 初始化失败，降级直嵌 :${display}:`, e)
          this.stopWatchdog(session)
          this.killProcessGroup(session)
          this.sessions.delete(panelId)
          this.launching.delete(panelId) // 解除重入保护，允许降级重启
          this.bridge.scaleStop(containerXid).catch(() => {})
          if (session.scale) this.bridge.destroy(session.scale.scratchXid).catch(() => {})
          this.bridge.destroy(containerXid).catch(() => {})
          return this.doLaunch(panelId, app, bounds, true)
        }
        throw e
      }

      // 4) 启动目标程序
      //    切断会话 D-Bus：gedit 等单实例应用靠 session bus 把二次启动
      //    转发给已有进程（新窗口开进旧虚拟显示器），禁用后每个面板独立实例
      //    浏览器另靠 profile 目录锁单实例：为每个面板分配独立 profile，
      //    否则新窗口会被宿主机已有浏览器进程开走
      const [cmd, ...args] = argv
      const lower = cmd.toLowerCase()
      if (/chrome|chromium|firefox|edge/.test(lower)) {
        const profileDir = path.join(electronApp.getPath('userData'), 'app-panel-profiles', String(display))
        fs.mkdirSync(profileDir, { recursive: true })
        if (lower.includes('firefox')) args.push('-profile', profileDir)
        else args.push(`--user-data-dir=${profileDir}`)
      }
      const child = spawn(cmd, args, {
        detached: true, stdio: 'ignore',
        env: { ...process.env, DISPLAY: `:${display}`, DBUS_SESSION_BUS_ADDRESS: 'disabled:' },
      })
      session.app = child
      child.on('error', (err) => {
        console.error(`[AppPanel] 程序启动失败 :${display}:`, err)
        session.state = 'error'
        this.onState(panelId, 'error', `程序启动失败: ${err.message}`)
        this.hideContainer(session)
      })
      child.on('exit', (code) => {
        // 注意：dbeaver 等程序的启动脚本会 fork 出真实进程后立即退出（脱管），
        // 且脚本退出往往早于真实进程首帧出现，因此：
        // - 窗口已出现过 → 纯脱管退出，真实退出交由看门狗判定；
        // - 窗口未出现且 code=0 → launcher 脱管候选，挂起交由看门狗宽限判定；
        // - 窗口未出现且 code!=0 → 程序启动即崩溃，直接报错。
        console.log(`[AppPanel] 程序进程退出 :${display} code=${code} seenWindow=${session.seenWindow}`)
        if (session.seenWindow) return
        if (session.state === 'error') return
        if (code === 0) {
          session.launcherExitPending = true
          return
        }
        session.state = 'error'
        this.onState(panelId, 'error', `程序异常退出（code=${code}）`)
        this.hideContainer(session)
      })

      session.state = 'running'
      console.log(`[AppPanel] launch 完成 :${display} appPid=${child.pid} xephyrPid=${session.xephyr?.pid}`)
      // M-2：此处不向渲染进程推送 running——容器窗口要等看门狗确认程序首帧
      // （最长 1.5s）才 map，提前推送会让"启动中"转圈层先消失，面板出现
      // 一段空白。running 通知改由看门狗首帧处发出（map 后推送，转圈层与画面无缝衔接）

      // 看门狗：周期铺满主窗口（无 WM 替代，兼顾慢启动/后出现的窗口），
      // 并在"曾出现窗口后又消失"时判定程序真实退出
      this.startWatchdog(session)

      return { success: true }
    } catch (e) {
      console.error(`[AppPanel] launch 失败 panelId=${panelId}:`, e)
      const session = this.sessions.get(panelId)
      if (session) {
        this.sessions.delete(panelId)
        this.stopWatchdog(session)
        // M-1：Xephyr/应用进程可能已 spawn（如 waitForDisplay 超时但进程仍活着），
        // 必须杀进程组，否则留下孤儿 Xephyr 且显示号持续占用
        this.killProcessGroup(session)
        this.bridge.destroy(session.containerXid).catch(() => {})
        if (session.scale) this.bridge.destroy(session.scale.scratchXid).catch(() => {})
      }
      return { success: false, error: String(e) }
    } finally {
      this.launching.delete(panelId)
    }
  }

  setBounds(panelId: string, bounds: PanelBounds): void {
    const session = this.sessions.get(panelId)
    if (!session) return
    const x = Math.round(bounds.x)
    const y = Math.round(bounds.y)
    const w = Math.max(1, Math.round(bounds.width))
    const h = Math.max(1, Math.round(bounds.height))

    if (session.mode === 'scale' && session.scale) {
      // scale 模式：容器跟随面板；面板超过当前虚拟分辨率时只增不减地提升
      this.bridge.moveResize(session.containerXid, x, y, w, h).catch(() => {})
      if (w > session.scale.virtualW || h > session.scale.virtualH) {
        session.scale.virtualW = Math.max(session.scale.virtualW, w)
        session.scale.virtualH = Math.max(session.scale.virtualH, h)
        if (session.xephyrWinXid) {
          // 嵌套 RANDR 跟随输出窗口尺寸（与直嵌同一已验证机制）
          this.bridge.moveResize(session.xephyrWinXid, 0, 0, session.scale.virtualW, session.scale.virtualH).catch(() => {})
        }
      }
      this.bridge.scaleUpdate(session.containerXid, w, h).catch(() => {})
      // 缩放后让主窗口重新铺满虚拟屏
      this.bridge.fillWindow(`:${session.display}`).catch(() => {})
      return
    }

    // direct 模式（现状）：容器与 Xephyr 输出窗口同步缩放
    this.bridge.moveResize(session.containerXid, x, y, w, h).catch(() => {})
    if (session.xephyrWinXid) {
      this.bridge.moveResize(session.xephyrWinXid, 0, 0, w, h).catch(() => {})
    }
    // 缩放后让主窗口重新铺满
    this.bridge.fillWindow(`:${session.display}`).catch(() => {})
  }

  /**
   * 看门狗：每 1.5s 对虚拟显示器执行一次"铺满主窗口"，
   * 兼做无 WM 环境的窗口管理（慢启动窗口、后弹出的主窗口都会被铺满）；
   * 同时记录"是否曾出现窗口"，一旦曾出现又消失 → 判定程序真实退出。
   */
  private startWatchdog(session: XephyrSession): void {
    this.stopWatchdog(session)
    // launcher 脱管候选的宽限周期数（1.5s × 10 = 15s，覆盖慢启动应用首帧）
    let graceTicks = 0
    const GRACE_MAX = 10
    session.watchdogTimer = setInterval(async () => {
      if (session.state !== 'running' && session.state !== 'starting') return
      try {
        const xid = await this.bridge.fillWindow(`:${session.display}`)
        if (xid > 0) {
          if (!session.seenWindow) {
            // 程序首帧就绪：显示容器窗口（此前保持隐藏，让 DOM 启动层可见）
            session.seenWindow = true
            session.launcherExitPending = false
            this.bridge.map(session.containerXid).catch(() => {})
            this.bridge.raise(session.containerXid).catch(() => {})
            // M-2：首帧就绪且容器 map 后才推送 running（与启动转圈层无缝衔接；
            // launcher 脱管型程序的真实进程首帧晚于启动进程退出，同样在此刻才转运行态）
            if (!session.runningAnnounced) {
              session.runningAnnounced = true
              this.onState(session.panelId, 'running')
            }
          }
        } else if (session.seenWindow) {
          // 主窗口消失 → 程序已退出（含 launcher 脱管型程序的最终退出）
          console.log(`[AppPanel] 看门狗判定程序退出 :${session.display}`)
          session.state = 'exited'
          this.onState(session.panelId, 'exited')
          this.hideContainer(session)
          this.stopWatchdog(session)
        } else if (session.launcherExitPending) {
          // 启动进程已正常退出但窗口始终未出现：宽限期满判定为已退出
          graceTicks++
          if (graceTicks >= GRACE_MAX) {
            console.log(`[AppPanel] 看门狗宽限期满，判定程序退出 :${session.display}`)
            session.state = 'exited'
            this.onState(session.panelId, 'exited')
            this.hideContainer(session)
            this.stopWatchdog(session)
          }
        }
      } catch { /* 桥接瞬时异常忽略，下个周期重试 */ }
    }, 1500)
  }

  private stopWatchdog(session: XephyrSession): void {
    if (session.watchdogTimer) {
      clearInterval(session.watchdogTimer)
      session.watchdogTimer = undefined
    }
  }

  /** 隐藏容器窗口（让渲染进程 DOM 状态层可见：启动中/已退出/失败） */
  private hideContainer(session: XephyrSession): void {
    this.bridge.unmap(session.containerXid).catch(() => {})
  }

  setVisible(panelId: string, visible: boolean): void {
    const session = this.sessions.get(panelId)
    if (!session) return
    if (visible) {
      // 程序首帧未就绪前保持隐藏（让渲染进程 DOM 启动层可见），由看门狗负责首次显示
      if (!session.seenWindow) return
      this.bridge.map(session.containerXid).catch(() => {})
      this.bridge.raise(session.containerXid).catch(() => {})
    } else {
      this.bridge.unmap(session.containerXid).catch(() => {})
    }
  }

  /** 杀进程组（app + Xephyr），SIGTERM 后 1s SIGKILL 兜底 */
  private killProcessGroup(session: XephyrSession): void {
    const killGroup = (child: ChildProcess | null) => {
      if (!child || !child.pid) return
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* 已退出 */ }
      const pid = child.pid
      setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL') } catch { /* 已退出 */ }
      }, 1000)
    }
    killGroup(session.app)
    killGroup(session.xephyr)
  }

  async kill(panelId: string): Promise<void> {
    const session = this.sessions.get(panelId)
    if (!session) return
    console.log(`[AppPanel] kill :${session.display} appPid=${session.app?.pid} xephyrPid=${session.xephyr?.pid}`)
    this.sessions.delete(panelId)
    this.stopWatchdog(session)

    // 杀进程组；对 launcher 脱管型程序（如 dbeaver），杀 Xephyr 后
    // 真实进程因 X 连接断开而自行退出，从而彻底释放单实例锁
    this.killProcessGroup(session)

    // scale 模式先摘缩放会话（配平 redirect 引用计数），再销毁容器与 scratch
    if (session.mode === 'scale') {
      try { await this.bridge.scaleStop(session.containerXid) } catch { /* 会话可能未建成 */ }
    }
    try { await this.bridge.destroy(session.containerXid) } catch { /* 已销毁 */ }
    if (session.scale) {
      try { await this.bridge.destroy(session.scale.scratchXid) } catch { /* 已销毁 */ }
    }
  }

  dispose(): void {
    for (const [, session] of Array.from(this.sessions.entries())) {
      this.stopWatchdog(session)
      this.killProcessGroup(session)
    }
    this.sessions.clear()
    this.bridge.dispose()
  }

  /** 切换放大镜（scale 模式专属：直嵌模式本就 1:1 无需放大，返回 null）。
   * M-3：返回三态数值（0=关 1=跟随 2=固定），与 daemon loupe=0|1|2 协议一致 */
  async toggleLoupe(panelId: string): Promise<number | null> {
    const session = this.sessions.get(panelId)
    if (!session || session.mode !== 'scale') return null
    return this.bridge.scaleLoupe(session.containerXid)
  }

  /** daemon 退出 → 容器窗口已毁 → 清理会话并提示 */
  private handleBridgeExit(): void {
    for (const [panelId, session] of Array.from(this.sessions.entries())) {
      this.sessions.delete(panelId)
      this.stopWatchdog(session)
      this.killProcessGroup(session)
      session.state = 'error'
      this.onState(panelId, 'error', '嵌入会话已中断（桥接进程退出），请关闭后重试')
    }
  }
}
