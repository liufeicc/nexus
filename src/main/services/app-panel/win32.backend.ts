/**
 * Win32 后端（Windows）—— direct 嵌入模式
 *
 * 每个应用面板 = 一个 WS_CHILD 容器窗口（桥接 daemon 持有，创建在 Electron
 * 主窗口内），应用主窗口经 SetParent 过继进来，原生渲染/输入：
 *
 *   1. spawn 目标程序（detached），记录 pid；
 *   2. 看门狗周期 find-window：遍历 pid 整个进程树找主窗口
 *      （等价解决 Linux "launcher 脱管"——真实窗口往往属于子进程）；
 *   3. attach-app：daemon 做样式修正 + SetParent 过继 + 铺满容器；
 *   4. map 容器 → 推送 running（首帧才推送，与启动转圈层无缝衔接）；
 *   5. 窗口消失 → exited；kill 两段式（WM_CLOSE → 进程树 TerminateProcess），
 *      且严格"先杀进程后毁容器"（卡死牵连保护，见 C++ 侧 cmd_destroy 注释）。
 *
 * 生命周期语义逐条对齐 xephyr.backend.ts（防重入、seenWindow、
 * launcherExitPending 宽限、runningAnnounced、M-1 catch 清理、M-2 首帧推送）。
 * scale 模式与放大镜在 P2/P3 实现（toggleLoupe 暂返回 null，渲染端 toast）。
 */

import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app as electronApp, BrowserWindow } from 'electron'
import { WinBridgeService } from './win-bridge.service'
import { splitExec } from './exec-utils'
import type { AppPanelBackend, PanelBounds, EmbeddedApp, AppPanelStateListener } from './backend'

/** 窗口发现的最小尺寸过滤（过滤 splash/启动小窗） */
const FIND_MIN_W = 200
const FIND_MIN_H = 150
/** 窗口发现重试周期与总超时（对齐 Linux 看门狗宽限语义） */
const FIND_RETRY_MS = 300
/** 看门狗周期（与 Linux 一致） */
const WATCHDOG_MS = 1500
/** launcher 脱管候选的宽限周期数（1.5s × 10 = 15s，覆盖慢启动应用首帧） */
const GRACE_MAX = 10

/** 单个应用面板的嵌入会话 */
interface Win32Session {
  panelId: string
  /** 容器窗口 HWND（daemon 持有；十进制串——x64 下可能超安全整数） */
  containerHwnd: string
  /** 应用进程（spawn 返回句柄；launcher 脱管后可能已退出） */
  app: ChildProcess | null
  /** spawn 的根进程 pid（find-window/kill 的进程树根） */
  appPid: number
  /** 已过继的应用主窗口 HWND */
  appHwnd: string | null
  state: string
  /** 本次会话启动的程序命令（判断"更换应用"需整体重启） */
  appExec: string
  /** 是否曾过继成功主窗口（区分 launcher 脱管与程序真退出） */
  seenWindow: boolean
  /** 启动进程已以 code=0 退出但窗口尚未出现（launcher 脱管候选） */
  launcherExitPending: boolean
  /** 看门狗定时器 */
  watchdogTimer?: NodeJS.Timeout
  /** running 是否已推送渲染进程（M-2：容器 map 后才推送） */
  runningAnnounced: boolean
  /** 最近一次面板几何（watchdog 兜底铺满用） */
  lastBounds: PanelBounds
}

export class Win32Backend implements AppPanelBackend {
  private bridge = WinBridgeService.getInstance()
  private sessions = new Map<string, Win32Session>()
  /** launch 防重入集合（React StrictMode 双挂载保护） */
  private launching = new Set<string>()
  /** Electron 主窗口 HWND（十进制串，缓存） */
  private electronHwnd: string | null = null
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

  /** Electron 主窗口 HWND。Windows x64 下句柄缓冲为 8 字节（BigUInt64LE），
   * 32 位为 4 字节；HWND 以十进制字符串形态在协议中流转（避免大整数精度问题） */
  private getElectronHwnd(): string {
    if (this.electronHwnd !== null) return this.electronHwnd
    if (!this.mainWindow) throw new Error('主窗口尚未初始化')
    const buf = this.mainWindow.getNativeWindowHandle()
    const hwnd = buf.length >= 8
      ? buf.readBigUInt64LE(0).toString()
      : String(buf.readUInt32LE(0))
    if (!hwnd || hwnd === '0') throw new Error('无法获取宿主窗口 HWND')
    this.electronHwnd = hwnd
    return hwnd
  }

  /** 宿主窗口 CSS 尺寸（DPI 换算由 daemon 用 GetClientRect 实测完成，
   * 本侧只负责附带 CSS 侧的"尺子"） */
  private getHostCssSize(): { w: number; h: number } {
    if (!this.mainWindow) return { w: 1280, h: 800 }
    const [w, h] = this.mainWindow.getSize()
    return { w: Math.max(1, w), h: Math.max(1, h) }
  }

  async launch(
    panelId: string,
    app: EmbeddedApp,
    bounds: PanelBounds,
  ): Promise<{ success: boolean; error?: string }> {
    // 已有会话的处理（对齐 xephyr.backend.ts）：
    // - 同一程序且仍在启动/运行中（如 React StrictMode 双挂载）→ 仅同步几何
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
    return this.doLaunch(panelId, app, bounds)
  }

  /** 实际启动流程（P1 仅 direct 模式；P2 在此加 scale 判定与降级） */
  private async doLaunch(
    panelId: string,
    app: EmbeddedApp,
    bounds: PanelBounds,
  ): Promise<{ success: boolean; error?: string }> {
    if (this.launching.has(panelId)) return { success: true }
    this.launching.add(panelId)

    try {
      // 命令分词前置（对齐 Linux）：命令为空时直接失败，避免创建容器后才发现而泄漏
      const argv = splitExec(app.exec)
      if (argv.length === 0) return { success: false, error: '启动命令为空' }

      const support = await this.isAvailable()
      if (!support.available) return { success: false, error: support.reason }

      const parentHwnd = this.getElectronHwnd()
      const hostCss = this.getHostCssSize()
      const width = Math.max(100, Math.round(bounds.width))
      const height = Math.max(100, Math.round(bounds.height))

      console.log(`[AppPanel][win] launch panelId=${panelId} exec="${app.exec}" bounds=${JSON.stringify(bounds)}`)

      // 1) 容器子窗口（创建即隐藏，待看门狗确认首帧再 map，避免黑屏遮挡 DOM 状态层）
      const containerHwnd = await this.bridge.createContainer(
        parentHwnd, Math.round(bounds.x), Math.round(bounds.y), width, height, hostCss.w, hostCss.h,
      )

      const session: Win32Session = {
        panelId, containerHwnd, app: null, appPid: 0, appHwnd: null,
        state: 'starting', appExec: app.exec,
        seenWindow: false, launcherExitPending: false,
        runningAnnounced: false, lastBounds: bounds,
      }
      this.sessions.set(panelId, session)

      try {
        // 2) 启动目标程序
        //    浏览器单实例隔离（对齐 Linux）：每个面板独立 profile 目录，
        //    否则新窗口会被宿主机已有浏览器进程吸走。
        //    Windows 无 D-Bus 转发通道，profile 目录即单实例锁的全部载体。
        const [cmd, ...args] = argv
        const lower = cmd.toLowerCase()
        if (/chrome|chromium|msedge|edge|firefox/.test(lower)) {
          const profileDir = path.join(electronApp.getPath('userData'), 'app-panel-profiles', panelId)
          fs.mkdirSync(profileDir, { recursive: true })
          if (lower.includes('firefox')) args.push('-profile', profileDir)
          else args.push(`--user-data-dir=${profileDir}`)
        }
        const child = spawn(cmd, args, {
          detached: true, // Windows 上 = CREATE_NEW_PROCESS_GROUP；杀进程走 daemon 进程树，不依赖进程组
          stdio: 'ignore',
          env: { ...process.env },
        })
        session.app = child
        session.appPid = child.pid || 0
        if (!session.appPid) throw new Error('程序启动失败（无 pid）')

        child.on('error', (err) => {
          console.error(`[AppPanel][win] 程序启动失败 panelId=${panelId}:`, err)
          session.state = 'error'
          this.onState(panelId, 'error', `程序启动失败: ${err.message}`)
          this.hideContainer(session)
        })
        child.on('exit', (code) => {
          // 对齐 xephyr.backend.ts 三分支：
          // - 窗口已出现过 → 纯脱管退出，真实退出交由看门狗判定；
          // - 窗口未出现且 code=0 → launcher 脱管候选，挂起交宽限判定；
          // - 窗口未出现且 code≠0 → 启动即崩溃，直接报错。
          console.log(`[AppPanel][win] 程序进程退出 panelId=${panelId} code=${code} seenWindow=${session.seenWindow}`)
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
        console.log(`[AppPanel][win] launch 完成 panelId=${panelId} appPid=${session.appPid}`)
        // M-2：不在此推送 running——容器要等看门狗确认主窗口过继后才 map，
        // running 通知由看门狗首帧处发出（转圈层与画面无缝衔接）

        this.startWatchdog(session)
        return { success: true }
      } catch (e) {
        // 启动阶段失败：拆除容器防泄漏（对齐 Linux M-1：进程可能已 spawn）
        if (session.appPid) this.bridge.killTree(session.appPid).catch(() => {})
        this.bridge.destroy(containerHwnd).catch(() => {})
        throw e
      }
    } catch (e) {
      console.error(`[AppPanel][win] launch 失败 panelId=${panelId}:`, e)
      const session = this.sessions.get(panelId)
      if (session) {
        this.sessions.delete(panelId)
        this.stopWatchdog(session)
        if (session.appPid) this.bridge.killTree(session.appPid).catch(() => {})
        this.bridge.destroy(session.containerHwnd).catch(() => {})
      }
      return { success: false, error: String(e) }
    } finally {
      this.launching.delete(panelId)
    }
  }

  setBounds(panelId: string, bounds: PanelBounds): void {
    const session = this.sessions.get(panelId)
    if (!session) return
    session.lastBounds = bounds
    const hostCss = this.getHostCssSize()
    this.bridge.setBounds(
      session.containerHwnd,
      Math.round(bounds.x), Math.round(bounds.y),
      Math.max(1, Math.round(bounds.width)), Math.max(1, Math.round(bounds.height)),
      hostCss.w, hostCss.h,
    ).catch(() => {})
  }

  /**
   * 看门狗（逐条对齐 xephyr.backend.ts startWatchdog 语义）：
   * - 未见窗口：find-window 找主窗口 → attach 过继 → map 容器 → 推 running；
   * - 已见窗口：window-alive 判存活；窗口消失先重找一次（splash 销毁后真窗口
   *   才出现的场景），找不到 → exited；
   * - launcherExitPending 宽限 15s 期满仍无窗口 → exited；
   * - 每 tick 兜底 set-bounds 铺满（兜底自行改尺寸的应用，等价 Linux fill-window）
   *   并 raise 容器防遮挡。
   */
  private startWatchdog(session: Win32Session): void {
    this.stopWatchdog(session)
    let graceTicks = 0
    session.watchdogTimer = setInterval(async () => {
      if (session.state !== 'running' && session.state !== 'starting') return
      try {
        if (!session.seenWindow) {
          const hwnd = await this.bridge.findWindow(session.appPid, FIND_MIN_W, FIND_MIN_H)
          if (hwnd !== '0') {
            try {
              await this.bridge.attachApp(session.containerHwnd, hwnd)
            } catch (e) {
              // SetParent 失败 = 拒嵌应用（自绘窗口/安全软件拦截等）：
              // 止损于明确报错，不做并排兜底（P1 决策，见方案风险表）
              console.warn(`[AppPanel][win] 过继失败 panelId=${session.panelId}:`, e)
              session.state = 'error'
              this.onState(session.panelId, 'error', '该应用可能不支持嵌入，请更换应用')
              this.hideContainer(session)
              this.stopWatchdog(session)
              return
            }
            // 程序首帧就绪：显示容器（此前保持隐藏，让 DOM 启动层可见）
            session.appHwnd = hwnd
            session.seenWindow = true
            session.launcherExitPending = false
            this.bridge.map(session.containerHwnd).catch(() => {})
            this.bridge.raise(session.containerHwnd).catch(() => {})
            // M-2：首帧就绪且容器 map 后才推送 running
            if (!session.runningAnnounced) {
              session.runningAnnounced = true
              this.onState(session.panelId, 'running')
            }
          } else if (session.launcherExitPending) {
            // 启动进程已正常退出但窗口始终未出现：宽限期满判定为已退出
            graceTicks++
            if (graceTicks >= GRACE_MAX) {
              console.log(`[AppPanel][win] 看门狗宽限期满，判定程序退出 panelId=${session.panelId}`)
              session.state = 'exited'
              this.onState(session.panelId, 'exited')
              this.hideContainer(session)
              this.stopWatchdog(session)
            }
          }
        } else {
          const alive = session.appHwnd ? await this.bridge.windowAlive(session.appHwnd) : false
          if (!alive) {
            // 主窗口消失：先重找一次（splash 销毁后真窗口才出现的场景），
            // 找不到才判定退出——比 Linux 版更宽容，减少误判
            const hwnd = await this.bridge.findWindow(session.appPid, FIND_MIN_W, FIND_MIN_H).catch(() => '0')
            if (hwnd !== '0') {
              try {
                await this.bridge.attachApp(session.containerHwnd, hwnd)
                session.appHwnd = hwnd
                this.bridge.raise(session.containerHwnd).catch(() => {})
                return
              } catch { /* 过继失败走下方退出判定 */ }
            }
            console.log(`[AppPanel][win] 看门狗判定程序退出 panelId=${session.panelId}`)
            session.state = 'exited'
            this.onState(session.panelId, 'exited')
            this.hideContainer(session)
            this.stopWatchdog(session)
          } else {
            // 兜底铺满 + 防遮挡（对齐 Linux 每 tick fill-window）
            this.setBounds(session.panelId, session.lastBounds)
            this.bridge.raise(session.containerHwnd).catch(() => {})
          }
        }
      } catch { /* 桥接瞬时异常忽略，下个周期重试 */ }
    }, WATCHDOG_MS)
  }

  private stopWatchdog(session: Win32Session): void {
    if (session.watchdogTimer) {
      clearInterval(session.watchdogTimer)
      session.watchdogTimer = undefined
    }
  }

  /** 隐藏容器窗口（让渲染进程 DOM 状态层可见：启动中/已退出/失败） */
  private hideContainer(session: Win32Session): void {
    this.bridge.unmap(session.containerHwnd).catch(() => {})
  }

  setVisible(panelId: string, visible: boolean): void {
    const session = this.sessions.get(panelId)
    if (!session) return
    if (visible) {
      // 主窗口未过继前保持隐藏（让 DOM 启动层可见），由看门狗负责首次显示
      if (!session.seenWindow) return
      this.bridge.map(session.containerHwnd).catch(() => {})
      this.bridge.raise(session.containerHwnd).catch(() => {})
    } else {
      this.bridge.unmap(session.containerHwnd).catch(() => {})
    }
  }

  /**
   * 关闭面板。顺序是卡死牵连保护的核心（对齐 Linux "先杀资源后毁窗口"）：
   * 1. kill-app：WM_CLOSE → 宽限 → 进程树 TerminateProcess（daemon 内一步做完）；
   * 2. 进程确认死亡后再 destroy 容器——若容器内还有存活的跨进程子窗口，
   *    DestroyWindow 的 WM_DESTROY 同步消息会挂死 daemon。
   */
  async kill(panelId: string): Promise<void> {
    const session = this.sessions.get(panelId)
    if (!session) return
    console.log(`[AppPanel][win] kill panelId=${panelId} appPid=${session.appPid} appHwnd=${session.appHwnd}`)
    this.sessions.delete(panelId)
    this.stopWatchdog(session)

    if (session.appPid) {
      try {
        await this.bridge.killApp(session.appHwnd || '0', session.appPid)
      } catch { /* daemon 异常时兜底再杀一次树 */ }
      this.bridge.killTree(session.appPid).catch(() => {})
    }
    this.bridge.destroy(session.containerHwnd).catch(() => {})
  }

  /** 放大镜（P3 实现；P1/P2 阶段 direct 模式返回 null，渲染端 toast 提示） */
  async toggleLoupe(_panelId: string): Promise<number | null> {
    return null
  }

  dispose(): void {
    for (const [, session] of Array.from(this.sessions.entries())) {
      this.stopWatchdog(session)
      if (session.appPid) this.bridge.killTree(session.appPid).catch(() => {})
    }
    this.sessions.clear()
    this.bridge.dispose()
  }

  /** daemon 退出 → 容器窗口已毁 → 清理会话并提示（对齐 Linux handleBridgeExit） */
  private handleBridgeExit(): void {
    for (const [panelId, session] of Array.from(this.sessions.entries())) {
      this.sessions.delete(panelId)
      this.stopWatchdog(session)
      // 容器销毁时应用子窗口一并被销毁，进程一般随之退出；兜底杀树
      if (session.appPid) this.bridge.killTree(session.appPid).catch(() => {})
      session.state = 'error'
      this.onState(panelId, 'error', '嵌入会话已中断（桥接进程退出），请关闭后重试')
    }
  }
}

/** find-window 重试周期常量导出说明：watchdog 每 WATCHDOG_MS 查询一次，
 * 等效重试间隔即 WATCHDOG_MS；FIND_RETRY_MS 保留供 P2 启动期密集轮询使用 */
export const WIN_FIND_RETRY_MS = FIND_RETRY_MS
