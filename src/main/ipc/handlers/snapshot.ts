/**
 * 快照管理 IPC 处理器
 */

import { ipcMain } from 'electron'
import type { SnapshotData } from '../../../core/types/snapshot'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { DatabaseService } from '../../services/database.service'

export function registerSnapshotHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.SNAPSHOT_SAVE,
    (
      _,
      sessionId: string,
      data: SnapshotData
    ) => {
      return DatabaseService.getInstance()
        .getSnapshotDAO()
        .save(sessionId, data)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.SNAPSHOT_LIST,
    (_, sessionId: string) => {
      return DatabaseService.getInstance()
        .getSnapshotDAO()
        .listBySession(sessionId)
    }
  )

  ipcMain.handle(IPC_CHANNELS.SNAPSHOT_GET, (_, id: string) => {
    return DatabaseService.getInstance().getSnapshotDAO().getById(id)
  })

  ipcMain.handle(IPC_CHANNELS.SNAPSHOT_DELETE, (_, id: string) => {
    DatabaseService.getInstance().getSnapshotDAO().delete(id)
  })

  ipcMain.handle(
    IPC_CHANNELS.SNAPSHOT_GET_LATEST,
    (_, sessionId: string) => {
      return DatabaseService.getInstance()
        .getSnapshotDAO()
        .getLatestBySession(sessionId)
    }
  )
}
