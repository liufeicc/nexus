/**
 * 剪贴板 IPC 处理器
 */

import { ipcMain, clipboard } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'

/**
 * 从系统剪贴板读取文件路径。
 * 跨平台差异：
 * - macOS：读取 NSFilenamesPboardType 格式的 PropertyList
 * - Windows：读取 CF_HDROP 格式
 * - Linux：解析 x-special/gnome-copied-files MIME 类型（URI 列表）
 */
function readFilesFromClipboard(): string[] {
  const platform = process.platform

  // Linux：解析 x-special/gnome-copied-files
  // 格式示例：copy\nfile:///home/user/file.txt\nfile:///home/user/file2.txt
  if (platform === 'linux') {
    try {
      const buffer = clipboard.readBuffer('x-special/gnome-copied-files')
      const text = buffer.toString('utf8').trim()
      if (!text) return []

      const lines = text.split('\n')
      // 第一行是 cut/copy 操作标识，从第二行开始是 file:// URI
      return lines.slice(1)
        .filter(line => line.startsWith('file://'))
        .map(uri => {
          // file:///home/user/file.txt -> /home/user/file.txt
          const urlPath = decodeURIComponent(uri.replace(/^file:\/\//, ''))
          // 处理 file://localhost/path 格式
          return urlPath.replace(/^localhost/, '')
        })
        .filter(Boolean)
    } catch {
      return []
    }
  }

  // macOS：读取 NSFilenamesPboardType（PropertyList 格式）
  if (platform === 'darwin') {
    try {
      const buffer = clipboard.readBuffer('NSFilenamesPboardType')
      // PropertyList 格式解析较复杂，先尝试读取通用格式
      return []
    } catch {
      return []
    }
  }

  // Windows：读取 CF_HDROP（格式 ID 15）
  if (platform === 'win32') {
    try {
      const buffer = clipboard.readBuffer('CF_HDROP')
      // CF_HDROP 二进制格式解析，先留空
      return []
    } catch {
      return []
    }
  }

  return []
}

export function registerClipboardHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_READ_TEXT, () => {
    return clipboard.readText()
  })

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE_TEXT, (_, text: string) => {
    clipboard.writeText(text)
  })

  // 新增：读取系统剪贴板中的文件路径
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_READ_FILES, () => readFilesFromClipboard())
}
