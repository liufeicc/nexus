/**
 * 浏览器历史与书签管理 IPC 处理器
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { DatabaseService } from '../../services/database.service'

export function registerBrowserDataHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.BROWSER_HISTORY_SAVE, (_, url: string, title?: string) => {
    DatabaseService.getInstance().getHistoryDAO().save(url, title)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_HISTORY_LIST, (_, limit?: number) => {
    return DatabaseService.getInstance().getHistoryDAO().list(limit)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_HISTORY_DELETE, (_, id: string) => {
    DatabaseService.getInstance().getHistoryDAO().delete(id)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_HISTORY_CLEAR, () => {
    DatabaseService.getInstance().getHistoryDAO().clear()
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_BOOKMARK_ADD, (_, url: string, title?: string) => {
    DatabaseService.getInstance().getBookmarkDAO().add(url, title || url)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_BOOKMARK_LIST, () => {
    return DatabaseService.getInstance().getBookmarkDAO().list()
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_BOOKMARK_DELETE, (_, id: string) => {
    DatabaseService.getInstance().getBookmarkDAO().delete(id)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_BOOKMARK_REORDER, (_, bookmarks: { id: string; sortOrder: number }[]) => {
    DatabaseService.getInstance().getBookmarkDAO().reorderAll(bookmarks)
  })
}
