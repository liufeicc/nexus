/**
 * overlay 弹层桥接 —— 双窗口共用工具
 *
 * 主窗口与 overlay 窗口的组件都通过这里与"对面"交互：
 * - emitBridgeEvent：本地派发 CustomEvent + 经主进程中继到对面窗口（白名单）
 * - callMaybeCallback：兼容"真函数"（主窗口本地）与"token 对象"（overlay 侧，回主窗口执行闭包）
 */

import { CB_TOKEN_KEY } from './protocol'

let reqCounter = 0

/** 当前是否运行在 overlay 弹层窗口（bridge-client 启动时置位） */
export function isOverlayWindow(): boolean {
  return !!(window as unknown as { __NEXUS_OVERLAY__?: boolean }).__NEXUS_OVERLAY__
}

/**
 * 派发跨窗口 CustomEvent：
 * 本地 window 立即派发（本窗口监听方生效），同时经 IPC 中继到对面窗口派发。
 */
export function emitBridgeEvent(name: string, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail }))
  try {
    window.electronAPI?.overlay?.sendEvent({ name, detail, from: isOverlayWindow() ? 'overlay' : 'main' })
  } catch { /* preload 不可用时静默 */ }
}

/**
 * 调用"可能是 token 的回调"：
 * - 主窗口内 store 存的是真函数 → 直接调用；
 * - overlay 内切片序列化后是 { __cbToken } → 经 IPC 回主窗口执行真实闭包。
 */
export function callMaybeCallback(fn: unknown, ...args: unknown[]): unknown {
  if (typeof fn === 'function') {
    return (fn as (...a: unknown[]) => unknown)(...args)
  }
  if (fn && typeof fn === 'object' && (fn as Record<string, unknown>)[CB_TOKEN_KEY]) {
    const token = (fn as Record<string, string>)[CB_TOKEN_KEY]
    return window.electronAPI.overlay
      .callback({ reqId: `ovr-cb-${++reqCounter}`, token, args })
      .then(res => {
        if (!res.ok) console.error('[overlay] token 回调执行失败:', res.error)
        return res.value
      })
  }
}
