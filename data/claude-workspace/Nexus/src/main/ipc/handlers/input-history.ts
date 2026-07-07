/**
 * 输入历史 IPC 处理器
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { DatabaseService } from '../../services/database.service'

export function registerInputHistoryHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.INPUT_HISTORY_ADD, (_, text: string) => {
    DatabaseService.getInstance().getInputHistoryDAO().add(text)
  })

  ipcMain.handle(IPC_CHANNELS.INPUT_HISTORY_LIST, (_, limit?: number) => {
    return DatabaseService.getInstance().getInputHistoryDAO().list(limit)
  })

  ipcMain.handle(IPC_CHANNELS.INPUT_HISTORY_DELETE, (_, id: number) => {
    DatabaseService.getInstance().getInputHistoryDAO().delete(id)
  })

  ipcMain.handle(IPC_CHANNELS.INPUT_HISTORY_CLEAR, () => {
    DatabaseService.getInstance().getInputHistoryDAO().clear()
  })
}
