/**
 * 窗口控制 IPC 处理器
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'

export function registerWindowHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    const win = getMainWindow()
    if (win) win.minimize()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    const win = getMainWindow()
    if (win) win.maximize()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_UNMAXIMIZE, () => {
    const win = getMainWindow()
    if (win) win.unmaximize()
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, () => {
    const win = getMainWindow()
    return win?.isMaximized() || false
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    const win = getMainWindow()
    if (win) win.close()
  })
}
