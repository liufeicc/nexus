/**
 * 文件/目录监听 IPC 处理器
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { expandTilde } from '../../utils/path'
import * as fs from 'fs'
import * as path from 'path'

/** 已注册的目录监听器 */
const dirWatchers = new Map<string, ReturnType<typeof fs.watch>>()

/** 已注册的文件监听器 */
const fileWatchers = new Map<string, ReturnType<typeof fs.watch>>()

/** 是否正在退出（防止退出后发送 IPC 消息） */
let isQuitting = false

/**
 * 标记应用正在退出，后续 IPC 消息将跳过
 */
export function markQuitting(): void {
  isQuitting = true
}

/**
 * 安全发送 IPC 消息（退出期间跳过，避免 "Object has been destroyed"）
 */
const safeSend = (mainWindow: BrowserWindow | null, channel: string, payload: unknown): void => {
  if (isQuitting) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

/**
 * 监听文件变化（内部方法，支持递归上限）
 */
const watchFileInternal = (fullPath: string, getMainWindow: () => BrowserWindow | null, depth = 0): void => {
  if (depth > 10) return

  if (fileWatchers.has(fullPath)) return

  const watcher = fs.watch(fullPath, { persistent: false }, (eventType) => {
    if (eventType === 'change') {
      safeSend(getMainWindow(), IPC_CHANNELS.FS_FILE_CHANGED, {
        filePath: fullPath,
        eventType: 'change',
      })
    } else if (eventType === 'rename') {
      if (fs.existsSync(fullPath)) {
        setTimeout(() => {
          fileWatchers.delete(fullPath)
          watchFileInternal(fullPath, getMainWindow, depth + 1)
          safeSend(getMainWindow(), IPC_CHANNELS.FS_FILE_CHANGED, {
            filePath: fullPath,
            eventType: 'change',
          })
        }, 50)
      } else {
        setTimeout(() => {
          fileWatchers.delete(fullPath)

          const dirPath = path.dirname(fullPath)
          const originalName = path.basename(fullPath)
          const originalExt = path.extname(fullPath)

          if (!fs.existsSync(dirPath)) {
            safeSend(getMainWindow(), IPC_CHANNELS.FS_FILE_CHANGED, {
              filePath: fullPath,
              eventType: 'deleted',
            })
            return
          }

          try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true })
            const fileNames = entries.filter(e => e.isFile()).map(e => e.name)

            const baseName = path.basename(fullPath, originalExt)
            const sameBaseFiles = fileNames.filter(
              n => path.basename(n, path.extname(n)) === baseName && n !== originalName
            )
            if (sameBaseFiles.length === 1) {
              const newPath = path.join(dirPath, sameBaseFiles[0])
              watchFileInternal(newPath, getMainWindow, depth + 1)
              safeSend(getMainWindow(), IPC_CHANNELS.FS_FILE_CHANGED, {
                filePath: fullPath,
                eventType: 'renamed',
                newPath,
              })
              return
            }

            if (originalExt) {
              const sameExtFiles = fileNames.filter(n => path.extname(n) === originalExt)
              if (sameExtFiles.length === 1 && sameExtFiles[0] !== originalName) {
                const newPath = path.join(dirPath, sameExtFiles[0])
                watchFileInternal(newPath, getMainWindow, depth + 1)
                safeSend(getMainWindow(), IPC_CHANNELS.FS_FILE_CHANGED, {
                  filePath: fullPath,
                  eventType: 'renamed',
                  newPath,
                })
                return
              }
            }
          } catch (err) {
            console.warn(`[IPC] 扫描目录判断重命名失败:`, err)
          }

          safeSend(getMainWindow(), IPC_CHANNELS.FS_FILE_CHANGED, {
            filePath: fullPath,
            eventType: 'deleted',
          })
        }, 100)
      }
    }
  })

  watcher.on('error', (err) => {
    console.warn(`[IPC] 文件监听器错误 for ${fullPath}:`, err)
    watcher.close()
    fileWatchers.delete(fullPath)
  })

  fileWatchers.set(fullPath, watcher)
}

export function registerFileWatcherHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.FS_WATCH_DIR, async (_, dirPath: string) => {
    try {
      const fullPath = expandTilde(dirPath)

      if (dirWatchers.has(fullPath)) {
        return { error: null }
      }

      const watcher = fs.watch(fullPath, { persistent: false }, (eventType, filename) => {
        console.log(`[FS-WATCH] 目录事件: ${fullPath} → ${eventType} ${filename || ''}`)
        safeSend(getMainWindow(), IPC_CHANNELS.FS_DIR_CHANGED, { dirPath: fullPath })
      })

      watcher.on('error', (err) => {
        console.warn(`[IPC] 目录监听器错误 for ${fullPath}:`, err)
        watcher.close()
        dirWatchers.delete(fullPath)
      })

      console.log(`[FS-WATCH] 已注册监听: ${fullPath}`)
      dirWatchers.set(fullPath, watcher)
      return { error: null }
    } catch (error) {
      console.error('[IPC] 监听目录失败:', error)
      return { error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_UNWATCH_DIR, async (_, dirPath: string) => {
    try {
      const fullPath = expandTilde(dirPath)
      const watcher = dirWatchers.get(fullPath)
      if (watcher) {
        watcher.close()
        dirWatchers.delete(fullPath)
      }
      return { error: null }
    } catch (error) {
      console.error('[IPC] 取消监听失败:', error)
      return { error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_WATCH_FILE, async (_, filePath: string) => {
    try {
      const fullPath = expandTilde(filePath)
      watchFileInternal(fullPath, getMainWindow)
      return { error: null }
    } catch (error) {
      console.error('[IPC] 监听文件失败:', error)
      return { error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_UNWATCH_FILE, async (_, filePath: string) => {
    try {
      const fullPath = expandTilde(filePath)
      const watcher = fileWatchers.get(fullPath)
      if (watcher) {
        watcher.close()
        fileWatchers.delete(fullPath)
      }
      return { error: null }
    } catch (error) {
      console.error('[IPC] 取消监听失败:', error)
      return { error: (error as Error).message }
    }
  })
}

/**
 * 清理所有文件监听器
 */
export function cleanupFileWatchers(): void {
  for (const watcher of dirWatchers.values()) {
    watcher.close()
  }
  dirWatchers.clear()

  for (const watcher of fileWatchers.values()) {
    watcher.close()
  }
  fileWatchers.clear()
}
