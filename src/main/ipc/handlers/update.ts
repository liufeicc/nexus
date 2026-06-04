/**
 * 自动更新 IPC 处理器
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { UpdateService } from '../../services/update-service'

/**
 * 注册自动更新 IPC 处理器
 */
export function registerUpdateHandlers(): void {
  const updateService = UpdateService.getInstance()

  // 检查更新
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    const result = await updateService.checkForUpdates()
    return result
  })

  // 下载更新
  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, async () => {
    const result = await updateService.downloadUpdate()
    return result
  })

  // 安装并重启
  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, async () => {
    await updateService.installAndRestart()
  })
}
