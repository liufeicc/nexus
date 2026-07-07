/**
 * 会话管理 IPC 处理器
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { DatabaseService } from '../../services/database.service'

export function registerSessionHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SESSION_CREATE, (_, name?: string) => {
    return DatabaseService.getInstance().getSessionDAO().create(name)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_LIST, () => {
    return DatabaseService.getInstance().getSessionDAO().list()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_GET, (_, id: string) => {
    return DatabaseService.getInstance().getSessionDAO().getById(id)
  })

  ipcMain.handle(
    IPC_CHANNELS.SESSION_UPDATE,
    (_, id: string, name: string) => {
      DatabaseService.getInstance().getSessionDAO().updateName(id, name)
    }
  )

  ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, (_, id: string) => {
    DatabaseService.getInstance().getSessionDAO().delete(id)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_SET_ACTIVE, (_, id: string) => {
    DatabaseService.getInstance().getSessionDAO().setActive(id)
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_ACTIVE, () => {
    return DatabaseService.getInstance().getSessionDAO().getActive()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_RECENT, (_, limit?: number) => {
    return DatabaseService.getInstance().getSessionDAO().getRecent(limit)
  })
}
