/**
 * 共享置顶弹层窗口 API（preload 暴露）
 *
 * 主窗口与 overlay 窗口共用同一 preload，因此两侧都能拿到整套 API；
 * 各通道的发送/接收方约定见 ./overlay/protocol.ts 头部注释。
 */

import { ipcRenderer } from 'electron'
import {
  OVERLAY_CHANNELS,
  type OverlayVisibility,
  type OverlayActionRequest,
  type OverlayActionResponse,
  type OverlayCallbackRequest,
  type OverlayEventMessage,
} from '../../renderer/overlay/protocol'

export const overlay = {
  /** overlay 启动握手：主进程收到后要求主窗口重推快照 */
  hello: () => ipcRenderer.send(OVERLAY_CHANNELS.HELLO),

  /** overlay 订阅状态切片 */
  onSnapshot: (cb: (msg: { seq: number; slice: unknown }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: { seq: number; slice: unknown }) => cb(msg)
    ipcRenderer.on(OVERLAY_CHANNELS.SNAPSHOT, listener)
    return () => { ipcRenderer.removeListener(OVERLAY_CHANNELS.SNAPSHOT, listener) }
  },

  /** 主窗口推送切片（主进程中转为 snapshot 发给 overlay） */
  pushSnapshot: (msg: { seq: number; slice: unknown }) => ipcRenderer.send(OVERLAY_CHANNELS.SNAPSHOT_PUSH, msg),

  /** 主窗口上报弹层显隐，驱动 overlay 窗口显隐/焦点 */
  setVisibility: (v: OverlayVisibility) => ipcRenderer.send(OVERLAY_CHANNELS.VISIBILITY, v),

  /** 主窗口桥接就绪通知 */
  mainReady: () => ipcRenderer.send(OVERLAY_CHANNELS.MAIN_READY),

  /** 主窗口订阅"立即重推快照"要求（hello/overlay 重载后） */
  onPushNow: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on(OVERLAY_CHANNELS.PUSH_NOW, listener)
    return () => { ipcRenderer.removeListener(OVERLAY_CHANNELS.PUSH_NOW, listener) }
  },

  /** overlay 调用主窗口 action（代理，Promise 往返） */
  action: (req: OverlayActionRequest) => ipcRenderer.invoke(OVERLAY_CHANNELS.ACTION, req) as Promise<OverlayActionResponse>,

  /** 主窗口订阅 action 执行请求 */
  onActionRequest: (cb: (req: OverlayActionRequest) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, req: OverlayActionRequest) => cb(req)
    ipcRenderer.on(OVERLAY_CHANNELS.ACTION_REQUEST, listener)
    return () => { ipcRenderer.removeListener(OVERLAY_CHANNELS.ACTION_REQUEST, listener) }
  },

  /** 主窗口回传 action 执行结果 */
  actionResponse: (res: OverlayActionResponse) => ipcRenderer.send(OVERLAY_CHANNELS.ACTION_RESPONSE, res),

  /** overlay 触发 token 回调（主窗口执行真实闭包） */
  callback: (req: OverlayCallbackRequest) => ipcRenderer.invoke(OVERLAY_CHANNELS.CALLBACK, req) as Promise<OverlayActionResponse>,

  /** 主窗口订阅 token 回调请求 */
  onCallbackRequest: (cb: (req: OverlayCallbackRequest) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, req: OverlayCallbackRequest) => cb(req)
    ipcRenderer.on(OVERLAY_CHANNELS.CALLBACK_REQUEST, listener)
    return () => { ipcRenderer.removeListener(OVERLAY_CHANNELS.CALLBACK_REQUEST, listener) }
  },

  /** 主窗口回传 token 回调结果 */
  callbackResponse: (res: OverlayActionResponse) => ipcRenderer.send(OVERLAY_CHANNELS.CALLBACK_RESPONSE, res),

  /** 主窗口调用 overlay 本地闭包（action 参数函数的反向回调） */
  callbackRev: (req: OverlayCallbackRequest) => ipcRenderer.invoke(OVERLAY_CHANNELS.CALLBACK_REV, req) as Promise<OverlayActionResponse>,

  /** overlay 订阅反向回调请求 */
  onCallbackRevRequest: (cb: (req: OverlayCallbackRequest) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, req: OverlayCallbackRequest) => cb(req)
    ipcRenderer.on(OVERLAY_CHANNELS.CALLBACK_REV_REQUEST, listener)
    return () => { ipcRenderer.removeListener(OVERLAY_CHANNELS.CALLBACK_REV_REQUEST, listener) }
  },

  /** overlay 回传反向回调结果 */
  callbackRevResponse: (res: OverlayActionResponse) => ipcRenderer.send(OVERLAY_CHANNELS.CALLBACK_REV_RESPONSE, res),

  /** 发送白名单 CustomEvent 中继 */
  sendEvent: (msg: OverlayEventMessage) => ipcRenderer.send(OVERLAY_CHANNELS.EVENT, msg),

  /** 订阅白名单 CustomEvent 中继 */
  onEvent: (cb: (msg: OverlayEventMessage) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, msg: OverlayEventMessage) => cb(msg)
    ipcRenderer.on(OVERLAY_CHANNELS.EVENT, listener)
    return () => { ipcRenderer.removeListener(OVERLAY_CHANNELS.EVENT, listener) }
  },
}
