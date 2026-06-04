/**
 * 会话与快照管理 API
 * 提供会话的创建/查询/切换，以及快照的保存/恢复功能
 */

import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'
import type { LayoutTree } from '../../core/types/layout'
import type { SnapshotPanelState } from '../../core/types/snapshot'

export const session = {
  create: (name?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_CREATE, name),
  list: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST),
  get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET, id),
  update: (id: string, name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_UPDATE, id, name),
  delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_DELETE, id),
  setActive: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_SET_ACTIVE, id),
  getActive: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET_ACTIVE),
  getRecent: (limit?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET_RECENT, limit),
}

export const snapshot = {
  save: (
    sessionId: string,
    data: {
      name?: string
      layoutData: LayoutTree | null
      activePanelId?: string
      panelStates: SnapshotPanelState[]
    }
  ) => ipcRenderer.invoke(IPC_CHANNELS.SNAPSHOT_SAVE, sessionId, data),
  list: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SNAPSHOT_LIST, sessionId),
  get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SNAPSHOT_GET, id),
  delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SNAPSHOT_DELETE, id),
  getLatest: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SNAPSHOT_GET_LATEST, sessionId),
}

/** 退出前保存快照事件监听 */
export const onSaveOnExit = (callback: () => void) => {
  const listener = (_event: Electron.IpcRendererEvent) => callback()
  ipcRenderer.on(IPC_CHANNELS.SNAPSHOT_SAVE_ON_EXIT, listener)
  return () => ipcRenderer.removeListener(IPC_CHANNELS.SNAPSHOT_SAVE_ON_EXIT, listener)
}
