/**
 * X11 桥接服务（daemon 管理版）
 *
 * 负责 nexus-x11-bridge C daemon 的惰性编译、拉起与行协议通信。
 * daemon 常驻持有 X 连接，保证其创建的容器子窗口不被销毁；
 * Node 侧通过 stdin/stdout 行协议逐条收发命令（串行化保证一一对应）。
 */

import { execFile, spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import readline from 'readline'

const SOURCE_NAME = 'nexus_x11_bridge.c'
const SCALE_SOURCE_NAME = 'nexus_x11_bridge_scale.c'
const SCALE_HEADER_NAME = 'nexus_x11_bridge_scale.h'
const BINARY_NAME = 'nexus-x11-bridge'
/** 单条命令超时（毫秒） */
const REQUEST_TIMEOUT_MS = 5000

interface PendingRequest {
  resolve: (line: string) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export class X11BridgeService {
  private static instance: X11BridgeService | null = null

  private binaryPath: string | null = null
  private child: ChildProcess | null = null
  private rl: readline.Interface | null = null
  /** 待响应的请求队列（按发送顺序与响应一一配对） */
  private pending: PendingRequest[] = []
  /** 串行化链：保证命令与响应按序对应 */
  private chain: Promise<unknown> = Promise.resolve()
  /** daemon 退出监听器（容器窗口随 daemon 连接关闭而销毁，上层需清理会话） */
  private exitHandlers = new Set<() => void>()

  static getInstance(): X11BridgeService {
    if (!X11BridgeService.instance) {
      X11BridgeService.instance = new X11BridgeService()
    }
    return X11BridgeService.instance
  }

  /** 注册 daemon 退出回调，返回取消函数 */
  onDaemonExit(cb: () => void): () => void {
    this.exitHandlers.add(cb)
    return () => {
      this.exitHandlers.delete(cb)
    }
  }

  /** 当前环境是否可用（Linux + DISPLAY + 可编译 + daemon ping 通过） */
  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    if (process.platform !== 'linux') {
      return { available: false, reason: '仅支持 Linux' }
    }
    if (!process.env.DISPLAY) {
      return { available: false, reason: '无 DISPLAY 环境变量（Wayland 或无图形环境）' }
    }
    try {
      await this.ensureCompiled()
    } catch (e) {
      return { available: false, reason: `桥接程序编译失败: ${e}` }
    }
    try {
      const out = await this.request('ping')
      if (out !== 'ok') return { available: false, reason: `桥接 ping 异常: ${out}` }
    } catch (e) {
      return { available: false, reason: `无法连接 X 服务器: ${e}` }
    }
    return { available: true }
  }

  /** 定位 C 源文件（开发态 resources/ 下，打包后 extraResources） */
  private resolveSourcePath(): string {
    const candidates = [
      path.join(app.getAppPath(), 'resources', 'x11-bridge', SOURCE_NAME),
      path.join(process.resourcesPath || '', 'x11-bridge', SOURCE_NAME),
      path.join(process.resourcesPath || '', SOURCE_NAME),
    ]
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p
    }
    throw new Error(`找不到桥接程序源文件: ${candidates.join(' | ')}`)
  }

  /** 二进制输出目录（复用 AGENT_ENV_DIR，即 userData/env） */
  private getEnvDir(): string {
    return process.env.NEXUS_AGENT_ENV_DIR || path.join(app.getPath('userData'), 'env')
  }

  /** 惰性两级编译：
   * - full：主文件 + scale 模块，链接 Xcomposite/Xrender/Xtst，具备缩放能力；
   * - lite：仅主文件（-DNEXUS_NO_SCALE），缺头文件/库时保留全部直嵌能力。
   * 二进制旁 .variant 标记记录本次编译变体；variant=lite 时每次调用机会性
   * 重试 full 编译（避免装了头文件后被 mtime 缓存卡死在 lite）。
   */
  async ensureCompiled(): Promise<string> {
    const sourceDir = path.dirname(this.resolveSourcePath())
    const sourceMain = path.join(sourceDir, SOURCE_NAME)
    const sourceScale = path.join(sourceDir, SCALE_SOURCE_NAME)
    const headerScale = path.join(sourceDir, SCALE_HEADER_NAME)
    const envDir = this.getEnvDir()
    if (!fs.existsSync(envDir)) fs.mkdirSync(envDir, { recursive: true })
    const binary = path.join(envDir, BINARY_NAME)
    const variantFile = `${binary}.variant`

    // 任一源文件新于二进制即视为过期
    const maxSrcMtime = Math.max(
      fs.statSync(sourceMain).mtimeMs,
      fs.statSync(sourceScale).mtimeMs,
      fs.statSync(headerScale).mtimeMs,
    )
    const binFresh = fs.existsSync(binary) && fs.statSync(binary).mtimeMs >= maxSrcMtime
    const variant = fs.existsSync(variantFile) ? fs.readFileSync(variantFile, 'utf8').trim() : ''
    if (binFresh && variant === 'full') {
      this.binaryPath = binary
      return binary
    }

    const fullArgs = ['-O2', '-o', binary, sourceMain, sourceScale,
      '-lX11', '-lXrandr', '-lXcomposite', '-lXrender', '-lXtst', '-lm']
    const liteArgs = ['-O2', '-DNEXUS_NO_SCALE', '-o', binary, sourceMain, '-lX11', '-lXrandr']

    try {
      await this.runGcc(fullArgs)
      fs.writeFileSync(variantFile, 'full')
    } catch (fullErr) {
      // full 失败（缺 Xcomposite/Xtst 头文件等）→ 降级 lite；lite 二进制新鲜则直接复用
      if (binFresh && variant === 'lite') {
        this.binaryPath = binary
        return binary
      }
      try {
        await this.runGcc(liteArgs)
        fs.writeFileSync(variantFile, 'lite')
        console.warn('[AppPanel] 缩放扩展不可编译，降级 lite（无缩放能力）:', String(fullErr).split('\n')[0])
      } catch {
        throw fullErr // 两级都失败：报 full 的错误（信息更全）
      }
    }
    this.binaryPath = binary
    return binary
  }

  /** 执行一次 gcc 编译 */
  private runGcc(args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      execFile('gcc', args, { timeout: 30000 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr || String(err)))
        else resolve()
      })
    })
  }

  /** 确保 daemon 正在运行；退出时会自动清空 pending 并允许下次重启 */
  private async ensureRunning(): Promise<void> {
    if (this.child && this.child.exitCode === null) return
    const binary = this.binaryPath || (await this.ensureCompiled())

    console.log('[AppPanel] 启动 X11 桥接 daemon:', binary)
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child

    this.rl = readline.createInterface({ input: child.stdout! })
    this.rl.on('line', (line) => this.handleLine(line))

    // stderr 透传到主进程日志，便于排查 C 侧错误
    child.stderr?.on('data', (data: Buffer) => {
      console.warn('[AppPanel][bridge stderr]', data.toString().trim())
    })

    child.on('exit', (code, signal) => {
      console.warn(`[AppPanel] X11 桥接 daemon 退出 code=${code} signal=${signal}`)
      // daemon 退出：拒绝所有未完成请求，置空以便下次自动重启
      const pend = this.pending.splice(0)
      for (const p of pend) {
        clearTimeout(p.timer)
        p.reject(new Error('X11 桥接 daemon 已退出'))
      }
      if (this.child === child) {
        this.child = null
        this.rl = null
      }
      // 通知上层清理依赖该 daemon 的会话（容器窗口已随连接销毁）
      for (const h of this.exitHandlers) {
        try { h() } catch { /* 忽略回调异常 */ }
      }
    })
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
    const child = this.child
    const stdin = child?.stdin
    if (!child || !stdin) throw new Error('X11 桥接 daemon 未运行')

    // 高频命令不打日志，避免刷屏（fill-window 由看门狗每 1.5s 调一次，scale-update 面板拖拽时高频）
    const verbose = !cmd.startsWith('moveresize') && !cmd.startsWith('map') && !cmd.startsWith('unmap') && !cmd.startsWith('fill-window') && !cmd.startsWith('scale-update')
    if (verbose) console.log('[AppPanel][bridge →]', cmd)

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        // 超时仅 reject 调用方，【不】把该条目从 pending 移除（review 0.6.11 I-1）：
        // daemon 侧命令并未取消，迟到的响应行仍会到达；若超时时移除条目，
        // 该行会与下一条请求错误配对，此后所有响应整体错位一位，
        // 面板桥接功能持续瘫痪直到 daemon 重启（而超时本身不触发重启）。
        // 保留条目后，迟到响应与已 reject 的 promise 配对，resolve 为 no-op，
        // 后续命令的配对保持对齐；daemon 真退出时 exit 处理器统一清空 pending。
        console.error('[AppPanel][bridge] 命令超时（保留配对条目等待迟到响应）:', cmd)
        reject(new Error(`桥接命令超时: ${cmd}`))
      }, REQUEST_TIMEOUT_MS)

      this.pending.push({
        resolve: (line) => {
          if (verbose) console.log('[AppPanel][bridge ←]', line)
          resolve(line)
        },
        reject,
        timer,
      })
      stdin.write(cmd + '\n')
    })
  }

  /** 解析 "ok <xid>" 形式的响应，返回 XID */
  private parseXid(line: string): number {
    const parts = line.split(/\s+/)
    if (parts[0] !== 'ok' || !parts[1]) throw new Error(`桥接响应异常: ${line}`)
    const xid = parseInt(parts[1], 10)
    if (!xid) throw new Error(`桥接 XID 解析失败: ${line}`)
    return xid
  }

  /** 确保响应为 ok，否则抛错 */
  private assertOk(line: string): void {
    if (!line.startsWith('ok')) throw new Error(`桥接命令失败: ${line}`)
  }

  /** 在 parent 窗口下创建并映射容器子窗口，返回其 XID */
  async createChild(parentXid: number, x: number, y: number, w: number, h: number): Promise<number> {
    const line = await this.request(`create ${parentXid} ${x} ${y} ${w} ${h}`)
    return this.parseXid(line)
  }

  /** 列出窗口的子窗口 XID（用于定位嵌入容器的 Xephyr 屏幕窗口） */
  async children(xid: number): Promise<number[]> {
    const line = await this.request(`children ${xid}`)
    const parts = line.split(/\s+/).slice(1)
    return parts.map(p => parseInt(p, 10)).filter(n => Number.isFinite(n) && n > 0)
  }

  /** 移动并缩放窗口 */
  async moveResize(xid: number, x: number, y: number, w: number, h: number): Promise<void> {
    this.assertOk(await this.request(`moveresize ${xid} ${x} ${y} ${w} ${h}`))
  }

  /** 显示窗口 */
  async map(xid: number): Promise<void> {
    this.assertOk(await this.request(`map ${xid}`))
  }

  /** 隐藏窗口 */
  async unmap(xid: number): Promise<void> {
    this.assertOk(await this.request(`unmap ${xid}`))
  }

  /** 置顶窗口 */
  async raise(xid: number): Promise<void> {
    this.assertOk(await this.request(`raise ${xid}`))
  }

  /** 聚焦窗口 */
  async focus(xid: number): Promise<void> {
    this.assertOk(await this.request(`focus ${xid}`))
  }

  /** 销毁窗口 */
  async destroy(xid: number): Promise<void> {
    this.assertOk(await this.request(`destroy ${xid}`))
  }

  /** 主显示根窗口尺寸（作为虚拟显示器 -screen 的上限） */
  async rootGeometry(): Promise<{ width: number; height: number }> {
    const line = await this.request('root-geometry')
    const parts = line.split(/\s+/)
    if (parts[0] !== 'ok' || !parts[1] || !parts[2]) throw new Error(`root-geometry 响应异常: ${line}`)
    return { width: parseInt(parts[1], 10), height: parseInt(parts[2], 10) }
  }

  /** 用 RANDR 调整虚拟显示器分辨率（display 形如 ":100"） */
  async screenResize(display: string, width: number, height: number): Promise<void> {
    this.assertOk(await this.request(`screen-resize ${display} ${Math.max(1, Math.round(width))} ${Math.max(1, Math.round(height))}`))
  }

  /**
   * 将虚拟显示器内首个程序主窗口铺满屏幕（无 WM 环境的替代方案）。
   * @returns 被铺满的窗口 XID（0 表示暂无可见窗口）
   */
  async fillWindow(display: string): Promise<number> {
    const line = await this.request(`fill-window ${display}`)
    const parts = line.split(/\s+/)
    if (parts[0] !== 'ok') throw new Error(`fill-window 响应异常: ${line}`)
    return parseInt(parts[1] || '0', 10)
  }

  /** 缩放能力（每次 launch 现查，不缓存：daemon 自动重启后能力可能变化） */
  async caps(): Promise<{ scale: boolean }> {
    const line = await this.request('caps')
    return { scale: line.startsWith('ok') && line.includes('features=scale') }
  }

  /** 创建屏外顶层 scratch 窗口（override_redirect、创建即 map），返回 XID */
  async createTop(w: number, h: number): Promise<number> {
    const line = await this.request(`create-top ${Math.max(1, Math.round(w))} ${Math.max(1, Math.round(h))}`)
    return this.parseXid(line)
  }

  /** 注册缩放会话：重定向源窗口 + 容器合成 + 输入转发 */
  async scaleStart(containerXid: number, srcXid: number, display: string): Promise<void> {
    this.assertOk(await this.request(`scale-start ${containerXid} ${srcXid} ${display}`))
  }

  /** 面板尺寸变化，下 tick 按新 letterbox 合成 */
  async scaleUpdate(containerXid: number, panelW: number, panelH: number): Promise<void> {
    this.assertOk(await this.request(`scale-update ${containerXid} ${Math.max(1, Math.round(panelW))} ${Math.max(1, Math.round(panelH))}`))
  }

  /** 销毁缩放会话（幂等） */
  async scaleStop(containerXid: number): Promise<void> {
    await this.request(`scale-stop ${containerXid}`)
  }

  /** 切换放大镜（与面板内中键等效，供标题栏按钮调用）。
   * M-3：返回三态数值（0=关 1=跟随 2=固定），与 daemon loupe=0|1|2 协议一致；
   * 旧实现按 includes('loupe=1') 返回布尔，固定态（loupe=2）会被误判为关 */
  async scaleLoupe(containerXid: number): Promise<number> {
    const line = await this.request(`scale-loupe ${containerXid}`)
    const m = line.match(/^ok\s+loupe=([0-2])/)
    if (!m) throw new Error(`切换放大镜失败: ${line}`)
    return parseInt(m[1], 10)
  }

  /** 关闭 daemon（应用退出时） */
  dispose(): void {
    const child = this.child
    if (child && child.exitCode === null) {
      try { child.stdin?.write('quit\n') } catch { /* 忽略 */ }
      setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* 已退出 */ }
      }, 500)
    }
    // M-4：显式关闭 readline 接口，不依赖子进程退出（SIGKILL 兜底前可能 lingering）自然结束
    try { this.rl?.close() } catch { /* 已关闭 */ }
    this.child = null
    this.rl = null
  }
}
