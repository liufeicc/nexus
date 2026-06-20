/**
 * PTY 终端管理 API
 * 提供终端的创建、写入、调整大小、销毁，以及数据/cwd 变化监听
 */

import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'

export const pty = {
  create: (params: {
    shell?: string
    cwd?: string
    cols?: number
    rows?: number
    panelId?: string
    sessionId?: string
  }) => ipcRenderer.invoke(IPC_CHANNELS.PTY_CREATE, params),
  write: (ptyId: string, data: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PTY_WRITE, ptyId, data),
  resize: (ptyId: string, cols: number, rows: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.PTY_RESIZE, ptyId, cols, rows),
  kill: (ptyId: string) => ipcRenderer.invoke(IPC_CHANNELS.PTY_KILL, ptyId),
  onData: (callback: (data: { ptyId: string; data: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { ptyId: string; data: string }) =>
      callback(data)
    ipcRenderer.on(IPC_CHANNELS.PTY_DATA, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PTY_DATA, listener)
  },
  /**
   * 监听终端 cwd 变化（通过 OSC 7 序列追踪）
   */
  onCwdChanged: (callback: (data: { ptyId: string; cwd: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { ptyId: string; cwd: string }) =>
      callback(data)
    ipcRenderer.on(IPC_CHANNELS.PTY_CWD_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PTY_CWD_CHANGED, listener)
  },
}
