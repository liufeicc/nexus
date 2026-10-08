/**
 * overlay 弹层桥接 —— 主窗口侧
 *
 * 单写者原则：主窗口 store 是唯一数据源。本模块负责：
 * 1. 订阅 store，构建纯 JSON 状态切片（函数回调转 token），rAF 合并且变更时推送给 overlay；
 * 2. 执行 overlay 代理过来的 action / token 回调 / 事件中继；
 * 3. 计算弹层显隐（visible + modal/menu 模式）上报主进程，驱动 overlay 窗口显隐与焦点。
 */

import { useAppStore } from '../store'
import type { AppState, PanelState } from '../store/types'
import { ACTION_WHITELIST, CB_TOKEN_KEY, type OverlayVisibility } from './protocol'

/** token → 真闭包（主窗口本地持有，永不跨窗口传输） */
const tokenMap = new Map<string, (...args: unknown[]) => unknown>()
const fnToToken = new Map<(...args: unknown[]) => unknown, string>()
let tokenCounter = 0
/** 上一轮切片中存活的 token（用于两轮宽限 GC） */
let prevLiveTokens = new Set<string>()

let seq = 0
let reqCounter = 0
let lastSliceJson = ''
let lastVisibilityJson = ''
let dirty = false
let rafPending = false

/** 函数回调转 token：同一函数复用同一 token */
function tokenFor(fn: (...args: unknown[]) => unknown): string {
  const existing = fnToToken.get(fn)
  if (existing) return existing
  const token = `cb_${++tokenCounter}`
  fnToToken.set(fn, token)
  tokenMap.set(token, fn)
  return token
}

/** 把对象中指定键的函数值替换为 token 标记 */
function stripFns(obj: Record<string, unknown> | null, keys: string[]): Record<string, unknown> | null {
  if (!obj) return obj
  const out: Record<string, unknown> = { ...obj }
  for (const k of keys) {
    if (typeof out[k] === 'function') {
      out[k] = { [CB_TOKEN_KEY]: tokenFor(out[k] as (...args: unknown[]) => unknown) }
    }
  }
  return out
}

/** panels 投影白名单（overlay 组件只读这些字段） */
function projectPanel(p: PanelState): Record<string, unknown> {
  const anyP = p as unknown as Record<string, unknown>
  return {
    id: p.id,
    panelType: p.panelType,
    title: p.title,
    ptyId: anyP.ptyId,
    cwd: anyP.cwd,
    currentPath: anyP.currentPath,
    activeFile: anyP.activeFile,
  }
}

/** 构建纯 JSON 切片（Map→Object、函数→token） */
function buildSlice(s: AppState): Record<string, unknown> {
  return {
    confirmModal: stripFns(s.confirmModal as unknown as Record<string, unknown> | null, ['onConfirm', 'onCancel']),
    renameModal: s.renameModal,
    pathSelectorModal: stripFns(s.pathSelectorModal as unknown as Record<string, unknown> | null, ['onConfirm']),
    fileRenameModal: s.fileRenameModal,
    settingsModalVisible: s.settingsModalVisible,
    aboutModalVisible: s.aboutModalVisible,
    nexusProfileModal: s.nexusProfileModal,
    approvalModal: s.approvalModal,
    clarifyModal: s.clarifyModal,
    toast: s.toast,
    appPicker: s.appPicker,
    contextMenu: s.contextMenu,
    ctx: {
      activePanelId: s.activePanelId,
      activeSessionId: s.activeSessionId,
      agentEnabled: s.agentEnabled,
      // 工具条分屏模式：应用选择器按此模式分屏（overlay 侧需同步）
      splitMode: s.splitMode,
      fileClipboard: s.fileClipboard,
      selectedFilePaths: s.selectedFilePaths instanceof Map
        ? Object.fromEntries(s.selectedFilePaths)
        : {},
      panels: s.panels.map(projectPanel),
    },
  }
}

/** 收集切片中存活的 token，两轮未出现即回收闭包 */
function gcTokens(slice: Record<string, unknown>): void {
  const live = new Set<string>()
  const cm = slice.confirmModal as Record<string, unknown> | null
  const ps = slice.pathSelectorModal as Record<string, unknown> | null
  for (const obj of [cm, ps]) {
    if (!obj) continue
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object' && typeof (v as Record<string, unknown>)[CB_TOKEN_KEY] === 'string') {
        live.add((v as Record<string, string>)[CB_TOKEN_KEY])
      }
    }
  }
  for (const [token, fn] of Array.from(tokenMap.entries())) {
    if (!live.has(token) && !prevLiveTokens.has(token)) {
      tokenMap.delete(token)
      fnToToken.delete(fn)
    }
  }
  prevLiveTokens = live
}

/** 计算 overlay 窗口显隐与模式：真模态抢焦点；菜单/Toast 不抢 */
function computeVisibility(slice: Record<string, unknown>): OverlayVisibility {
  const get = (k: string) => slice[k] as { visible?: boolean } | undefined
  const anyModal = !!(
    get('confirmModal')?.visible || get('renameModal')?.visible || get('pathSelectorModal')?.visible ||
    get('fileRenameModal')?.visible || slice.settingsModalVisible || slice.aboutModalVisible ||
    get('nexusProfileModal')?.visible || get('approvalModal')?.visible || get('clarifyModal')?.visible ||
    get('appPicker')?.visible
  )
  const visible = anyModal || !!get('contextMenu')?.visible || !!get('toast')?.visible
  return { visible, mode: anyModal ? 'modal' : 'menu' }
}

/** 构建并推送切片（JSON 比对去重），同时上报显隐 */
function pushNow(): void {
  const slice = buildSlice(useAppStore.getState())
  gcTokens(slice)
  const json = JSON.stringify(slice)
  if (json !== lastSliceJson) {
    lastSliceJson = json
    window.electronAPI.overlay.pushSnapshot({ seq: ++seq, slice })
  }
  const visibility = computeVisibility(slice)
  const vJson = JSON.stringify(visibility)
  if (vJson !== lastVisibilityJson) {
    lastVisibilityJson = vJson
    window.electronAPI.overlay.setVisibility(visibility)
  }
}

/** store 变更合并到每帧最多一次推送 */
function schedule(): void {
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(() => {
    rafPending = false
    if (dirty) {
      dirty = false
      pushNow()
    }
  })
}

let inited = false

/** 主窗口桥接初始化（index.tsx 调用一次；HMR 重入安全） */
export function initOverlayBridge(): void {
  if (inited) return
  inited = true
  const api = window.electronAPI.overlay

  // 执行 overlay 代理过来的 action（白名单校验，单写者落地）
  api.onActionRequest(async (req) => {
    const res: { reqId: string; ok: boolean; value?: unknown; error?: string } = { reqId: req.reqId, ok: true }
    try {
      if (!(ACTION_WHITELIST as readonly string[]).includes(req.name)) {
        throw new Error(`action 不在白名单: ${req.name}`)
      }
      const fn = (useAppStore.getState() as unknown as Record<string, unknown>)[req.name]
      if (typeof fn !== 'function') throw new Error(`action 不存在: ${req.name}`)
      // 参数中的 ovr-fn token 复活为"回程代理函数"：调用时回 overlay 执行本地闭包
      const args = req.args.map(a => {
        if (a && typeof a === 'object' && typeof (a as Record<string, unknown>)[CB_TOKEN_KEY] === 'string') {
          const token = (a as Record<string, string>)[CB_TOKEN_KEY]
          return (...cbArgs: unknown[]) =>
            api.callbackRev({ reqId: `main-rev-${++reqCounter}`, token, args: cbArgs }).then(r => {
              if (!r.ok) console.error('[overlay] 反向回调失败:', r.error)
              return r.value
            })
        }
        return a
      })
      res.value = await (fn as (...a: unknown[]) => unknown)(...args)
    } catch (e) {
      res.ok = false
      res.error = String(e)
    }
    api.actionResponse(res)
  })

  // 执行 overlay 触发的 token 回调（真实闭包在主窗口）
  api.onCallbackRequest(async (req) => {
    const res: { reqId: string; ok: boolean; value?: unknown; error?: string } = { reqId: req.reqId, ok: true }
    try {
      const fn = tokenMap.get(req.token)
      if (!fn) throw new Error(`回调 token 已失效: ${req.token}`)
      res.value = await fn(...req.args)
    } catch (e) {
      res.ok = false
      res.error = String(e)
    }
    api.callbackResponse(res)
  })

  // overlay 发来的白名单事件 → 主窗口本地派发
  api.onEvent((msg) => {
    window.dispatchEvent(new CustomEvent(msg.name, { detail: msg.detail }))
  })

  // 菜单打开期间 overlay 捕获层收到菜单外右键：坐标 1:1 直接命中本窗口元素，
  // 重新派发 contextmenu 让原面板逻辑在新位置重开菜单；无 handler 接住则关闭旧菜单
  window.addEventListener('overlay-ctx-redispatch', (e) => {
    const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail ?? { x: 0, y: 0 }
    const target = document.elementFromPoint(x, y)
    let handled = false
    if (target) {
      const ev = new MouseEvent('contextmenu', {
        clientX: x, clientY: y, bubbles: true, cancelable: true,
      })
      target.dispatchEvent(ev)
      handled = ev.defaultPrevented
    }
    if (!handled) useAppStore.getState().hideContextMenu()
  })

  // overlay 握手/主进程要求重推 → 立即推送
  api.onPushNow(() => pushNow())

  useAppStore.subscribe(() => {
    dirty = true
    schedule()
  })

  api.mainReady()
  pushNow()
}
