/**
 * PTY 管理 IPC 处理器
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { PtyService } from '../../services/pty.service'
import { NexusConnectionManager } from '../../services/nexus-connection-manager'

export function registerPtyHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.PTY_CREATE,
    (_, params: { shell?: string; cwd?: string; cols?: number; rows?: number; panelId?: string; sessionId?: string }) => {
      return PtyService.getInstance().createPty(params)
    }
  )

  ipcMain.handle(IPC_CHANNELS.PTY_WRITE, (_, ptyId: string, data: string) => {
    PtyService.getInstance().writeToPty(ptyId, data)
  })

  ipcMain.handle(
    IPC_CHANNELS.PTY_RESIZE,
    (_, ptyId: string, cols: number, rows: number) => {
      PtyService.getInstance().resizePty(ptyId, cols, rows)
    }
  )

  ipcMain.handle(IPC_CHANNELS.PTY_KILL, (_, ptyId: string) => {
    // 通知 Nexus 连接管理器此 PTY 将被销毁
    NexusConnectionManager.getInstance().onPtyDestroyed(ptyId)
    PtyService.getInstance().killPty(ptyId)
  })
}
