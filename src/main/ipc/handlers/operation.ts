/**
 * 操作记录读取 IPC 处理器
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { OperationReader } from '../../services/operation-reader'

export function registerOperationHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.OPERATION_GET_NEW, (_, sessionId: string, lastReadIndex: number) => {
    return OperationReader.getInstance().getNewOperations(sessionId, lastReadIndex)
  })

  ipcMain.handle(IPC_CHANNELS.OPERATION_QUERY, (_, sessionId: string, filter: { panelType?: string; panelId?: string; keyword?: string }) => {
    return OperationReader.getInstance().queryOperations(sessionId, filter)
  })

  ipcMain.handle(IPC_CHANNELS.OPERATION_GET_RECENT, (_, sessionId: string, count: number) => {
    return OperationReader.getInstance().getRecentOperations(sessionId, count)
  })
}
