/**
 * Nexus 连接管理 + 灵动岛窗口控制 API
 * 提供终端/浏览器/文件面板的连接路由，以及灵动岛窗口的拖动/缩放
 */

import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'

export const nexus = {
  /**
   * 请求连接终端面板（将智能体命令路由到此面板的 PTY）
   */
  connect: (panelId: string, ptyId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NEXUS_CONNECT, panelId, ptyId),

  /**
   * 请求连接浏览器面板（将智能体操作路由到此浏览器面板）
   */
  connectBrowser: (panelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NEXUS_CONNECT_BROWSER, panelId),

  /**
   * 请求连接文件面板（将智能体文件操作关联到此文件面板）
   */
  connectFile: (panelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.NEXUS_CONNECT_FILE, panelId),

  /**
   * 请求断开 Nexus 连接（断开所有轨）
   */
  disconnect: () =>
    ipcRenderer.invoke(IPC_CHANNELS.NEXUS_DISCONNECT),

  /**
   * 仅断开浏览器轨连接
   */
  disconnectBrowser: () =>
    ipcRenderer.invoke(IPC_CHANNELS.NEXUS_DISCONNECT_BROWSER),

  /**
   * 仅断开数据轨连接
   */
  disconnectData: () =>
    ipcRenderer.invoke(IPC_CHANNELS.NEXUS_DISCONNECT_DATA),

  /**
   * 监听连接状态变化
   */
  onConnectionStateChanged: (callback: (data: { panelId: string | null; connected: boolean; track: 'browser' | 'data' }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { panelId: string | null; connected: boolean; track: 'browser' | 'data' }) =>
      callback(data)
    ipcRenderer.on(IPC_CHANNELS.NEXUS_CONNECTION_STATE_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.NEXUS_CONNECTION_STATE_CHANGED, listener)
  },
}

export const dynamicIsland = {
  /** 获取窗口位置和大小 */
  getBounds: () => ipcRenderer.invoke('dynamic-island:get-bounds'),
  /** 获取主窗口边界（用于约束拖动范围） */
  getMainBounds: () => ipcRenderer.invoke('dynamic-island:get-main-bounds'),
  /** 设置窗口位置 */
  setPosition: (position: { x: number; y: number }) =>
    ipcRenderer.invoke('dynamic-island:set-position', position),
  /** 设置窗口大小（展开/收起时调整） */
  setSize: (size: { width: number; height: number }) =>
    ipcRenderer.invoke('dynamic-island:set-size', size),
  /** 开始拖动（通知主进程拖动窗口） */
  startDrag: () => ipcRenderer.invoke('dynamic-island:start-drag'),
  /** 关闭窗口 */
  close: () => ipcRenderer.invoke('dynamic-island:close'),
}
