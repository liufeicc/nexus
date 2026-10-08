/**
 * 共享置顶弹层窗口 —— 通信协议
 *
 * 纯常量与类型定义，主进程与两个渲染进程（主窗口/overlay）共用。
 * 单写者约束：所有 store 变更只在主窗口执行；overlay 只渲染 + 发意图。
 *
 * 通道一览：
 *   hello              overlay→主      握手（重载/HMR 后重发），主进程回推快照
 *   snapshot           主→overlay      状态切片 {seq, slice}
 *   snapshot-push      主渲染→主       主进程转发为 snapshot
 *   visibility         主渲染→主       弹层显隐 {visible, mode}，驱动 overlay 窗口显隐/焦点
 *   action             overlay→主(invoke)  代理 action 调用 {reqId,name,args}
 *   action-request     主→主渲染       主进程转发，主渲染执行真实 action
 *   action-response    主渲染→主       执行结果 {reqId,ok,value?,error?}
 *   callback           overlay→主(invoke)  token 回调 {reqId,token,args}
 *   callback-request   主→主渲染       主进程转发，主渲染执行真实闭包
 *   callback-response  主渲染→主       回调结果
 *   callback-rev       主→overlay(invoke)  反向 token 回调（action 参数中的函数）
 *   callback-rev-request 主→overlay    overlay 执行本地闭包
 *   callback-rev-response overlay→主   回调结果
 *   event              双向            CustomEvent 白名单中继 {name,detail,from}
 *   push-now           主→主渲染       要求立即重推快照（hello/主窗口刷新后）
 *   main-ready         主渲染→主       主窗口桥接已就绪
 */

export const OVERLAY_CHANNELS = {
  HELLO: 'overlay:hello',
  SNAPSHOT: 'overlay:snapshot',
  SNAPSHOT_PUSH: 'overlay:snapshot-push',
  VISIBILITY: 'overlay:visibility',
  ACTION: 'overlay:action',
  ACTION_REQUEST: 'overlay:action-request',
  ACTION_RESPONSE: 'overlay:action-response',
  CALLBACK: 'overlay:callback',
  CALLBACK_REQUEST: 'overlay:callback-request',
  CALLBACK_RESPONSE: 'overlay:callback-response',
  CALLBACK_REV: 'overlay:callback-rev',
  CALLBACK_REV_REQUEST: 'overlay:callback-rev-request',
  CALLBACK_REV_RESPONSE: 'overlay:callback-rev-response',
  EVENT: 'overlay:event',
  PUSH_NOW: 'overlay:push-now',
  MAIN_READY: 'overlay:main-ready',
} as const

/** overlay 显隐状态：modal=抢焦点模态；menu=右键菜单（不抢焦点） */
export interface OverlayVisibility {
  visible: boolean
  mode: 'modal' | 'menu'
}

export interface OverlayActionRequest {
  reqId: string
  name: string
  args: unknown[]
}

export interface OverlayActionResponse {
  reqId: string
  ok: boolean
  value?: unknown
  error?: string
}

export interface OverlayCallbackRequest {
  reqId: string
  token: string
  args: unknown[]
}

export interface OverlayEventMessage {
  name: string
  detail?: unknown
  from: 'main' | 'overlay'
}

/** 函数回调 token 标记键：序列化切片时 fn → { [CB_TOKEN_KEY]: 'cb_n' } */
export const CB_TOKEN_KEY = '__cbToken'

/**
 * overlay 可调用的主窗口 action 白名单（12 个弹层组件用到的全部写动作）。
 * 单写者原则下，overlay 的任何状态变更都经此代理回主窗口执行。
 */
export const ACTION_WHITELIST: readonly string[] = [
  // 弹层显隐
  'hideConfirmModal', 'hideRenameModal', 'hidePathSelectorModal', 'hideFileRenameModal',
  'setSettingsModalVisible', 'setAboutModalVisible', 'setNexusProfileModalVisible',
  'hideApprovalModal', 'hideClarifyModal', 'hideContextMenu', 'setAppPickerVisible',
  'showToast', 'hideToast',
  // 弹层间互调
  'showConfirmModal', 'showAlertModal', 'showRenameModal', 'showPathSelectorModal', 'showFileRenameModal',
  // 会话/面板业务动作（ContextMenu/AppPicker/ReplacePanelIcons 使用）
  'setActiveSessionId', 'setSessionIds', 'deleteSessionCache',
  'splitPanelWithPty', 'closePanel', 'createPanel', 'createFilePanel', 'splitPanelWithFilePanel',
  'createBrowserPanel', 'splitPanelWithBrowserPanel', 'replacePanelInPlace',
  'setFileClipboard', 'saveSnapshot',
  'createAppPanel', 'splitPanelWithAppPanel',
  // 设置
  'setAgentEnabled',
] as const

/** 需跨窗口中继的 window CustomEvent 白名单（监听方与发送方分处两窗口） */
export const RELAY_EVENTS: readonly string[] = [
  'terminal-copy',
  'terminal-paste',
  'file-paste-request',
  'file-viewer-cut',
  'file-viewer-paste-text',
  'files-trashed',
  'sessions-change',
  'file-rename-completed',
  'panels-change',
  // 菜单打开期间右键菜单外：overlay 捕获层把坐标回传主窗口重新命中派发
  'overlay-ctx-redispatch',
] as const
