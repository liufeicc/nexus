/**
 * Windows 面板桥接服务（daemon 管理版）
 *
 * 负责 nexus-win-panel.exe C++ daemon 的定位、拉起与行协议通信。
 * 与 x11-bridge.service.ts 同构（行协议、串行化 Promise 链、超时配对语义），
 * 两处关键差异：
 * 1. 无运行时编译：Windows 用户机器不要求编译器，exe 预编译随包下发
 *    （resources/win-panel/，extraResources 整拷），改为内嵌版本号校验
 *    （version 命令与 EXPECTED_HELPER_VERSION 比对，单一事实源在 exe 内）；
 * 2. 平台闸门：仅 win32 可用。
 *
 * I-1 不变式（review 0.6.11，从 x11-bridge 继承）：命令超时【不】移除 pending
 * 条目——daemon 侧命令未取消，迟到响应必须与旧条目配对，否则此后所有响应错位。
 */

import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import readline from 'readline'

const EXE_NAME = 'nexus-win-panel.exe'
/** 期望的 daemon 内嵌版本（与 C++ 侧 NEXUS_WIN_PANEL_VERSION 一致，
 * 源码改动重新编译时必须同步递增，见 resources/win-panel/build.sh 铁律） */
const EXPECTED_HELPER_VERSION = '1.0.0'
/** 单条命令超时（毫秒） */
const REQUEST_TIMEOUT_MS = 5000

interface PendingRequest {
  resolve: (line: string) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export class WinBridgeService {
  private static instance: WinBridgeService | null = null

  private child: ChildProcess | null = null
  private rl: readline.Interface | null = null
  /** 待响应的请求队列（按发送顺序与响应一一配对） */
  private pending: PendingRequest[] = []
  /** 串行化链：保证命令与响应按序对应 */
  private chain: Promise<unknown> = Promise.resolve()
  /** daemon 退出监听器（容器窗口随 daemon 进程销毁，上层需清理会话） */
  private exitHandlers = new Set<() => void>()

  static getInstance(): WinBridgeService {
    if (!WinBridgeService.instance) {
      WinBridgeService.instance = new WinBridgeService()
    }
    return WinBridgeService.instance
  }

  /** 注册 daemon 退出回调，返回取消函数 */
  onDaemonExit(cb: () => void): () => void {
    this.exitHandlers.add(cb)
    return () => {
      this.exitHandlers.delete(cb)
    }
  }

  /** 定位 exe（开发态 resources/win-panel/ 下，打包后 extraResources） */
  private resolveExePath(): string {
    const candidates = [
      path.join(app.getAppPath(), 'resources', 'win-panel', EXE_NAME),
      path.join(process.resourcesPath || '', 'win-panel', EXE_NAME),
      path.join(process.resourcesPath || '', EXE_NAME),
    ]
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p
    }
    throw new Error(`找不到面板桥接程序: ${candidates.join(' | ')}`)
  }

  /** 当前环境是否可用（win32 + exe 存在 + 版本匹配 + daemon ping 通过） */
  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    if (process.platform !== 'win32') {
      return { available: false, reason: '当前平台不支持 Windows 应用面板' }
    }
    try {
      this.resolveExePath()
    } catch (e) {
      return { available: false, reason: String(e instanceof Error ? e.message : e) }
    }
    try {
      const out = await this.request('ping')
      if (out !== 'ok') return { available: false, reason: `桥接 ping 异常: ${out}` }
    } catch (e) {
      return { available: false, reason: `桥接进程启动失败: ${e}` }
    }
    return { available: true }
  }

  /** 确保 daemon 正在运行；首次拉起时执行 version 握手。
   * 注意：本方法仅在 request 串行链内调用，握手与后续命令天然无并发 */
  private async ensureRunning(): Promise<void> {
    if (this.child && this.child.exitCode === null) return
    const exe = this.resolveExePath()

    console.log('[AppPanel][win] 启动面板桥接 daemon:', exe)
    // windowsHide：GUI 子系统 exe 本就无控制台，此参数仅防御性保留
    const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child

    this.rl = readline.createInterface({ input: child.stdout! })
    this.rl.on('line', (line) => this.handleLine(line))

    // stderr 透传到主进程日志，便于排查 C++ 侧错误
    child.stderr?.on('data', (data: Buffer) => {
      console.warn('[AppPanel][win stderr]', data.toString().trim())
    })

    child.on('exit', (code, signal) => {
      console.warn(`[AppPanel][win] 面板桥接 daemon 退出 code=${code} signal=${signal}`)
      // daemon 退出：拒绝所有未完成请求，置空以便下次自动重启
      const pend = this.pending.splice(0)
      for (const p of pend) {
        clearTimeout(p.timer)
        p.reject(new Error('面板桥接 daemon 已退出'))
      }
      if (this.child === child) {
        this.child = null
        this.rl = null
      }
      // 通知上层清理依赖该 daemon 的会话（容器窗口已随进程销毁）
      for (const h of this.exitHandlers) {
        try { h() } catch { /* 忽略回调异常 */ }
      }
    })

    // 版本握手：exe 与 TS 期望不一致说明安装包过旧/资源损坏，拒绝使用
    const ver = await this.rawRequest('version')
    if (ver !== `ok ${EXPECTED_HELPER_VERSION}`) {
      const bad = this.child
      this.child = null
      try { bad?.kill() } catch { /* 忽略 */ }
      throw new Error(`面板桥接版本不匹配（期望 ${EXPECTED_HELPER_VERSION}，实际 "${ver}"），请重新安装`)
    }
  }

  /** 处理 daemon 返回的一行响应：与最早的 pending 配对 */
  private handleLine(line: string): void {
    const p = this.pending.shift()
    if (!p) return
    clearTimeout(p.timer)
    p.resolve(line)
  }

  /**
   * 发送一条命令并等待响应（串行化）。
   * @returns 响应行原文（如 "ok" / "ok 12345" / "err xxx"）
   */
  request(cmd: string): Promise<string> {
    const task = this.chain.then(() => this.doRequest(cmd))
    // 链路不因单次失败中断
    this.chain = task.catch(() => undefined)
    return task
  }

  private async doRequest(cmd: string): Promise<string> {
    await this.ensureRunning()
    return this.rawRequest(cmd)
  }

  /** 实际的"写一行 + 等一行"（不做 ensureRunning，供握手与常规命令共用） */
  private rawRequest(cmd: string): Promise<string> {
    const child = this.child
    const stdin = child?.stdin
    if (!child || !stdin) return Promise.reject(new Error('面板桥接 daemon 未运行'))

    // 高频命令不打日志，避免刷屏（set-bounds/find-window/raise 由看门狗每 1.5s 调用）
    const verbose = !cmd.startsWith('set-bounds') && !cmd.startsWith('map') &&
      !cmd.startsWith('unmap') && !cmd.startsWith('raise') && !cmd.startsWith('find-window')
    if (verbose) console.log('[AppPanel][win →]', cmd.length > 120 ? cmd.slice(0, 120) + '…' : cmd)

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        // I-1（继承 x11-bridge）：超时仅 reject 调用方，【不】移除 pending 条目。
        // daemon 侧命令并未取消，迟到响应仍会到达；保留条目使迟到响应与已 reject
        // 的 promise 配对（resolve 为 no-op），后续命令配对保持对齐
        console.error('[AppPanel][win] 命令超时（保留配对条目等待迟到响应）:', cmd)
        reject(new Error(`桥接命令超时: ${cmd}`))
      }, REQUEST_TIMEOUT_MS)

      this.pending.push({
        resolve: (line) => {
          if (verbose) console.log('[AppPanel][win ←]', line.length > 120 ? line.slice(0, 120) + '…' : line)
          resolve(line)
        },
        reject,
        timer,
      })
      stdin.write(cmd + '\n')
    })
  }

  /** 解析 "ok <hwnd>"，HWND 以十进制字符串返回（x64 下可能超安全整数，不做数值化） */
  private parseHwnd(line: string): string {
    const parts = line.split(/\s+/)
    if (parts[0] !== 'ok' || !parts[1]) throw new Error(`桥接响应异常: ${line}`)
    return parts[1]
  }

  /** 确保响应为 ok，否则抛错 */
  private assertOk(line: string): void {
    if (!line.startsWith('ok')) throw new Error(`桥接命令失败: ${line}`)
  }

  /* ---------- 类型化命令封装 ---------- */

  /** 在 Electron 主窗口内创建隐藏容器，返回容器 HWND（十进制串）。
   * hostCssW/H 为宿主窗口 CSS 尺寸，daemon 用 GetClientRect 实测 DPI 换算系数 */
  async createContainer(parentHwnd: string, x: number, y: number, w: number, h: number,
    hostCssW: number, hostCssH: number): Promise<string> {
    const line = await this.request(
      `create-container ${parentHwnd} ${x} ${y} ${w} ${h} ${hostCssW} ${hostCssH}`)
    return this.parseHwnd(line)
  }

  /** 移动/缩放容器（联动铺满内部应用窗口） */
  async setBounds(hwnd: string, x: number, y: number, w: number, h: number,
    hostCssW: number, hostCssH: number): Promise<void> {
    this.assertOk(await this.request(`set-bounds ${hwnd} ${x} ${y} ${w} ${h} ${hostCssW} ${hostCssH}`))
  }

  async map(hwnd: string): Promise<void> { this.assertOk(await this.request(`map ${hwnd}`)) }
  async unmap(hwnd: string): Promise<void> { this.assertOk(await this.request(`unmap ${hwnd}`)) }
  async raise(hwnd: string): Promise<void> { this.assertOk(await this.request(`raise ${hwnd}`)) }
  async focus(hwnd: string): Promise<void> { this.assertOk(await this.request(`focus ${hwnd}`)) }
  async destroy(hwnd: string): Promise<void> { this.assertOk(await this.request(`destroy ${hwnd}`)) }

  /** 样式修正 + SetParent 过继。失败（拒嵌应用）抛错由上层转 error */
  async attachApp(container: string, appHwnd: string): Promise<void> {
    this.assertOk(await this.request(`attach-app ${container} ${appHwnd}`))
  }

  /** 遍历进程树查找主窗口。返回 HWND 十进制串，"0" 表示暂无 */
  async findWindow(rootPid: number, minW: number, minH: number): Promise<string> {
    const line = await this.request(`find-window ${rootPid} ${minW} ${minH}`)
    return this.parseHwnd(line)
  }

  /** 窗口是否存活（看门狗判定"窗口消失=程序退出"） */
  async windowAlive(hwnd: string): Promise<boolean> {
    const line = await this.request(`window-alive ${hwnd}`)
    return /^ok\s+1/.test(line)
  }

  /** 两段式杀应用：WM_CLOSE → 宽限 → 进程树 TerminateProcess（daemon 内一步做完） */
  async killApp(hwnd: string, pid: number): Promise<void> {
    this.assertOk(await this.request(`kill-app ${hwnd} ${pid}`))
  }

  /** 进程树全部终止（dispose 兜底用） */
  async killTree(pid: number): Promise<void> {
    this.assertOk(await this.request(`kill-tree ${pid}`))
  }

  /** 缩放能力（P2 起生效；P1 daemon 恒报 features=none） */
  async caps(): Promise<{ scale: boolean }> {
    const line = await this.request('caps')
    return { scale: line.startsWith('ok') && line.includes('features=scale') }
  }

  /** 开始菜单应用列表：daemon 返回 base64(JSON)，此处解码为对象数组 */
  async listApps(): Promise<Array<{ appId: string; name: string; exec: string }>> {
    const line = await this.request('list-apps')
    const parts = line.split(/\s+/)
    if (parts[0] !== 'ok' || !parts[1]) throw new Error(`list-apps 响应异常: ${line.slice(0, 80)}`)
    const json = Buffer.from(parts[1], 'base64').toString('utf8')
    const data = JSON.parse(json) as { apps?: Array<{ appId: string; name: string; exec: string }> }
    return data.apps || []
  }

  /** 按 lnk 全路径取图标。返回 base64(PNG)；无图标返回 null */
  async getIconPngBase64(lnkPath: string): Promise<string | null> {
    const b64Path = Buffer.from(lnkPath, 'utf8').toString('base64')
    const line = await this.request(`get-icon ${b64Path}`)
    const parts = line.split(/\s+/)
    if (parts[0] !== 'ok' || !parts[1]) return null
    return parts[1]
  }

  /** 关闭 daemon（应用退出时） */
  dispose(): void {
    const child = this.child
    if (child && child.exitCode === null) {
      try { child.stdin?.write('quit\n') } catch { /* 忽略 */ }
      setTimeout(() => {
        try { child.kill() } catch { /* 已退出 */ }
      }, 500)
    }
    try { this.rl?.close() } catch { /* 已关闭 */ }
    this.child = null
    this.rl = null
  }
}
