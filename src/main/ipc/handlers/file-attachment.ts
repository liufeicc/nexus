/**
 * 文件附件 IPC 处理器
 */

import { ipcMain, dialog, app } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { expandTilde } from '../../utils/path'
import { getNexusDirName } from '../../../core/utils/path-utils'
import { getMimeType } from '../../../core/utils/mime-types'
import * as fs from 'fs'
import * as path from 'path'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'])
const TEXT_EXTS = new Set([
  '.txt', '.md', '.log', '.json', '.csv', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.ts', '.tsx', '.js', '.jsx', '.py', '.css', '.html', '.htm', '.sh', '.bash', '.zsh',
  '.bat', '.cmd', '.ps1', '.sql', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
  '.rb', '.php', '.swift', '.kt', '.scala', '.lua', '.r', '.R', '.m', '.mdx',
  '.env', '.gitignore', '.dockerignore', '.dockerfile', 'dockerfile',
  '.vue', '.svelte', '.astro', '.markdown', '.tex', '.latex',
  '.conf', '.config', '.rc', '.properties',
])

function detectFileType(ext: string): 'image' | 'text' | 'other' {
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'other'
}

export function registerFileAttachmentHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.FILE_DIALOG_OPEN, async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'] },
        ],
        title: '选择图片文件',
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { files: null }
      }

      const files = result.filePaths.map(fp => {
        const stat = fs.statSync(fp)
        const ext = path.extname(fp).toLowerCase()

        return {
          name: path.basename(fp),
          path: fp,
          type: detectFileType(ext),
          size: stat.size,
          mimeType: getMimeType(ext),
        }
      })

      return { files }
    } catch (error) {
      console.error('[IPC] 文件选择对话框失败:', error)
      return { files: null, error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_READ_AS_TEXT, async (_, filePath: string) => {
    try {
      const fullPath = expandTilde(filePath)
      const content = await fs.promises.readFile(fullPath, 'utf-8')
      return { content, error: null }
    } catch (error) {
      console.error('[IPC] 读取文本文件失败:', error)
      return { content: '', error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_READ_AS_BASE64, async (_, filePath: string) => {
    try {
      const fullPath = expandTilde(filePath)
      const buffer = await fs.promises.readFile(fullPath)
      const base64 = buffer.toString('base64')
      const ext = path.extname(fullPath).toLowerCase()
      return { base64, mimeType: getMimeType(ext), error: null }
    } catch (error) {
      console.error('[IPC] 读取文件为 base64 失败:', error)
      return { base64: '', mimeType: '', error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_ATTACH, async (_, filePath: string) => {
    try {
      const fullPath = expandTilde(filePath)
      const attachDir = path.join(app.getPath('home'), getNexusDirName(), 'env', 'attachments')

      if (!fs.existsSync(attachDir)) {
        await fs.promises.mkdir(attachDir, { recursive: true })
      }

      const baseName = path.basename(fullPath)
      const safeName = baseName.replace(/[^\w.\-() ]/g, '_')
      const timestamp = Date.now().toString(36)
      const uniqueName = `att_${timestamp}_${safeName}`
      const destPath = path.join(attachDir, uniqueName)

      await fs.promises.copyFile(fullPath, destPath)

      return { savedPath: destPath, error: null }
    } catch (error) {
      console.error('[IPC] 保存附件失败:', error)
      return { savedPath: '', error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FILE_DETECT_TYPE, async (_, filePath: string) => {
    try {
      const fullPath = expandTilde(filePath)
      if (!fs.existsSync(fullPath)) {
        return { type: 'unknown', exists: false }
      }

      const stat = fs.statSync(fullPath)
      if (!stat.isFile()) {
        return { type: 'unknown', exists: true, isFile: false }
      }

      const ext = path.extname(fullPath).toLowerCase()
      return { type: detectFileType(ext), exists: true, isFile: true, size: stat.size, extension: ext }
    } catch (error) {
      console.error('[IPC] 检测文件类型失败:', error)
      return { type: 'unknown', exists: false, error: (error as Error).message }
    }
  })
}
