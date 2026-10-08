/**
 * overlay 弹层桥接 —— overlay 窗口侧
 *
 * overlay 的 store 是同模块的独立实例，本模块启动时"打补丁"：
 * 1. 白名单 actions 逐个替换为 IPC 代理（真实执行在主窗口，单写者）；
 * 2. 订阅主窗口推送的状态切片并合并进本地 store；
 * 3. 白名单事件中继本地派发；hello 握手触发主窗口重推。
 */

import { useAppStore } from '../store'
import { ACTION_WHITELIST, CB_TOKEN_KEY } from './protocol'

let reqCounter = 0
let ready = false
const readyListeners = new Set<() => void>()

/** overlay 本地闭包注册表：action 参数中的函数 → token，主窗口回程调用时执行 */
const localFnMap = new Map<string, (...args: unknown[]) => unknown>()
let localFnCounter = 0

/** 把 action 参数中的函数替换为 token（跨窗口可序列化） */
function tokenizeArgs(args: unknown[]): unknown[] {
  return args.map(a => {
    if (typeof a === 'function') {
      const token = `ovr-fn-${++localFnCounter}`
      localFnMap.set(token, a as (...args: unknown[]) => unknown)
      return { [CB_TOKEN_KEY]: token }
    }
    return a
  })
}

/** overlay 是否已收到首帧快照（入口据此门控渲染，避免空 store 闪烁） */
export function onOverlayReady(cb: () => void): () => void {
  if (ready) {
    cb()
    return () => {}
  }
  readyListeners.add(cb)
  return () => { readyListeners.delete(cb) }
}

let inited = false

export function initOverlayClient(): void {
  if (inited) return
  inited = true
  ;(window as unknown as { __NEXUS_OVERLAY__?: boolean }).__NEXUS_OVERLAY__ = true
  const api = window.electronAPI.overlay

  // 白名单 action → IPC 代理：调用即回主窗口执行，返回值经 Promise 带回；
  // 参数中的函数自动 token 化，主窗口可回程调用（见 onCallbackRevRequest）
  const patch: Record<string, unknown> = {}
  for (const name of ACTION_WHITELIST) {
    patch[name] = (...args: unknown[]) =>
      api.action({ reqId: `ovr-act-${++reqCounter}`, name, args: tokenizeArgs(args) }).then(res => {
        if (!res.ok) {
          console.error(`[overlay] action 执行失败: ${name}`, res.error)
          throw new Error(res.error || name)
        }
        return res.value
      })
  }
  useAppStore.setState(patch)

  // 主窗口回程调用 overlay 本地闭包（action 参数函数的反向回调）
  api.onCallbackRevRequest(async (req) => {
    const res: { reqId: string; ok: boolean; value?: unknown; error?: string } = { reqId: req.reqId, ok: true }
    try {
      const fn = localFnMap.get(req.token)
      if (!fn) throw new Error(`overlay 本地回调已失效: ${req.token}`)
      res.value = await fn(...req.args)
    } catch (e) {
      res.ok = false
      res.error = String(e)
    }
    api.callbackRevResponse(res)
  })

  // 主窗口切片 → 本地 store（ctx 拍平到顶层；selectedFilePaths 还原为 Map）
  api.onSnapshot(({ slice }) => {
    const { ctx, ...modals } = slice as {
      ctx?: Record<string, unknown>
      [k: string]: unknown
    }
    useAppStore.setState({
      ...modals,
      ...(ctx ?? {}),
      selectedFilePaths: new Map(Object.entries(
        (ctx?.selectedFilePaths as Record<string, string[]>) ?? {},
      )),
    } as Partial<Parameters<typeof useAppStore.setState>[0] & object>)
    if (!ready) {
      ready = true
      readyListeners.forEach(cb => cb())
      readyListeners.clear()
    }
  })

  // 主窗口发来的白名单事件 → 本地派发
  api.onEvent((msg) => {
    window.dispatchEvent(new CustomEvent(msg.name, { detail: msg.detail }))
  })

  // 握手：主进程收到后要求主窗口重推最新快照
  api.hello()
}
