/**
 * Nexus 连接管理 IPC 处理器
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { NexusConnectionManager } from '../../services/nexus-connection-manager'

export function registerNexusHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.NEXUS_CONNECT,
    (_event, panelId: string, ptyId: string) => {
      return NexusConnectionManager.getInstance().connect(panelId, ptyId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.NEXUS_DISCONNECT,
    () => {
      return NexusConnectionManager.getInstance().disconnect()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.NEXUS_DISCONNECT_BROWSER,
    () => {
      return NexusConnectionManager.getInstance().disconnectBrowser()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.NEXUS_DISCONNECT_DATA,
    () => {
      return NexusConnectionManager.getInstance().disconnectData()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.NEXUS_CONNECT_BROWSER,
    (_event, panelId: string) => {
      return NexusConnectionManager.getInstance().connectBrowser(panelId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.NEXUS_CONNECT_FILE,
    (_event, panelId: string) => {
      return NexusConnectionManager.getInstance().connectFilePanel(panelId)
    }
  )
}
