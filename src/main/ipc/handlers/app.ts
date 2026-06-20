/**
 * 应用管理 + 路径操作 IPC 处理器
 */

import { ipcMain, app } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { expandTilde, splitPathForAutocomplete } from '../../utils/path'
import * as fs from 'fs'
import * as path from 'path'

export function registerAppHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.APP_GET_PATH, (_, name: string) => {
    return app.getPath(name as any)
  })

  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => {
    return app.getVersion()
  })

  ipcMain.handle('app:get-resource-path', (_event, filename: string) => {
    const devPath = path.join(__dirname, '../../../resources', filename)
    if (fs.existsSync(devPath)) return devPath
    const prodPath = path.join(process.resourcesPath, 'resources', filename)
    if (fs.existsSync(prodPath)) return prodPath
    const extraPath = path.join(process.resourcesPath, filename)
    if (fs.existsSync(extraPath)) return extraPath
    return null
  })

  /** 获取操作系统 locale，用于初始语言检测 */
  ipcMain.handle('app:get-locale', () => {
    return app.getLocale()
  })
}

export function registerPathHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PATH_EXISTS, async (_, path: string) => {
    try {
      let fullPath = expandTilde(path)
      const exists = await fs.promises.access(fullPath).then(() => true).catch(() => false)
      return { exists, path: fullPath }
    } catch (error) {
      console.error('[IPC] 路径检查失败:', error)
      return { exists: false, path, error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PATH_AUTOCOMPLETE, async (_, input: string) => {
    try {
      const { basePath, prefix } = splitPathForAutocomplete(input)

      const exists = await fs.promises.access(basePath).then(() => true).catch(() => false)
      if (!exists) {
        return { suggestions: [] }
      }

      const entries = await fs.promises.readdir(basePath, { withFileTypes: true })

      const suggestions = entries
        .filter((entry) => {
          if (!entry.isDirectory()) return false
          const name = entry.name
          if (name.startsWith('.') && name !== '.' && name !== '..') return false
          if (prefix && !name.toLowerCase().startsWith(prefix.toLowerCase())) return false
          return true
        })
        .map((entry) => ({
          name: entry.name,
          path: input.endsWith('/') ? input + entry.name : basePath === '/' ? '/' + entry.name : basePath + '/' + entry.name,
          isDirectory: entry.isDirectory(),
        }))

      suggestions.sort((a, b) => a.name.localeCompare(b.name))

      return { suggestions: suggestions.slice(0, 50) }
    } catch (error) {
      console.error('[IPC] 路径自动补全失败:', error)
      return { suggestions: [], error: (error as Error).message }
    }
  })
}
