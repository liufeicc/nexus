/**
 * 文件系统操作 IPC 处理器
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { expandTilde } from '../../utils/path'
import { getMimeType } from '../../../core/utils/mime-types'
import * as fs from 'fs'
import * as path from 'path'
import { exec, execFileSync } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/**
 * 批量将文件/目录移入回收站
 *
 * @param paths 路径列表（已展开 ~）
 * @returns { successCount, errorCount, errors }
 */
async function trashItems(paths: string[]): Promise<{ successCount: number; errorCount: number; errors: string[] }> {
  const { shell } = await import('electron')
  let successCount = 0
  let errorCount = 0
  const errors: string[] = []

  for (const p of paths) {
    try {
      await shell.trashItem(p)
      successCount++
    } catch (err) {
      errorCount++
      const fileName = path.basename(p)
      errors.push(`"${fileName}": ${(err as Error).message}`)
    }
  }

  return { successCount, errorCount, errors }
}

/**
 * 根据当前操作系统生成复制命令
 */
function makeCopyCommand(src: string, dst: string, isDir: boolean): string {
  const isWindows = process.platform === 'win32'
  if (isWindows) {
    return isDir
      ? `xcopy "${src}" "${dst}" /E /I /Y`
      : `copy /Y "${src}" "${dst}"`
  }
  const escapedSrc = src.replace(/'/g, "'\\''")
  const escapedDst = dst.replace(/'/g, "'\\''")
  return `cp -r '${escapedSrc}' '${escapedDst}'`
}

export function registerFilesystemHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.FS_READ_DIR, async (_, dirPath: string) => {
    try {
      const fullPath = expandTilde(dirPath)
      const entries = await fs.promises.readdir(fullPath, { withFileTypes: true })
      const items = entries
        .filter(entry => !entry.name.startsWith('.'))
        .map(entry => ({
          name: entry.name,
          path: path.join(fullPath, entry.name),
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isFile() ? 0 : undefined,
          mtime: undefined as number | undefined,
        }))

      const statPromises = items.map(async (item) => {
        if (item.type === 'file') {
          try {
            const stat = await fs.promises.stat(item.path)
            item.size = stat.size
            item.mtime = stat.mtimeMs
          } catch {
            item.size = 0
          }
        } else if (item.type === 'directory') {
          try {
            const stat = await fs.promises.stat(item.path)
            item.mtime = stat.mtimeMs
          } catch {
            // ignore
          }
        }
      })
      await Promise.all(statPromises)

      items.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
      })

      return { items, error: null }
    } catch (error) {
      console.error('[IPC] 读取目录失败:', error)
      return { items: [], error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_READ_FILE, async (_, filePath: string) => {
    try {
      const fullPath = expandTilde(filePath)
      const content = await fs.promises.readFile(fullPath, 'utf-8')
      return { content, error: null }
    } catch (error) {
      console.error('[IPC] 读取文件失败:', error)
      return { content: '', error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_WRITE_FILE, async (_, filePath: string, content: string) => {
    try {
      const fullPath = expandTilde(filePath)
      await fs.promises.writeFile(fullPath, content, 'utf-8')
      return { error: null }
    } catch (error) {
      console.error('[IPC] 写入文件失败:', error)
      return { error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_COPY_FILE, async (_, src: string, dst: string) => {
    try {
      const fullSrc = expandTilde(src)
      const fullDst = expandTilde(dst)

      const dstDir = path.dirname(fullDst)
      if (!fs.existsSync(dstDir)) {
        await fs.promises.mkdir(dstDir, { recursive: true })
      }

      const isDir = fs.statSync(fullSrc).isDirectory()
      await execAsync(makeCopyCommand(fullSrc, fullDst, isDir))
      return { error: null }
    } catch (error) {
      console.error('[IPC] 复制文件失败:', error)
      return { error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_EXISTS, async (_, filePath: string) => {
    try {
      const fullPath = expandTilde(filePath)
      return { exists: fs.existsSync(fullPath) }
    } catch (error) {
      console.error('[IPC] 检查路径失败:', error)
      return { exists: false }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_RENAME, async (_, oldPath: string, newPath: string) => {
    try {
      const fullOldPath = expandTilde(oldPath)
      const fullNewPath = expandTilde(newPath)

      if (!fs.existsSync(fullOldPath)) {
        return { error: '原文件不存在' }
      }

      if (fs.existsSync(fullNewPath)) {
        return { error: '目标名称已存在' }
      }

      await fs.promises.rename(fullOldPath, fullNewPath)
      return { error: null }
    } catch (error) {
      console.error('[IPC] 重命名文件失败:', error)
      return { error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_CREATE_DIR, async (_, dirPath: string) => {
    try {
      const fullPath = expandTilde(dirPath)

      if (!fs.existsSync(fullPath)) {
        await fs.promises.mkdir(fullPath, { recursive: true })
        return { resolvedPath: fullPath, error: null }
      }

      const dirName = path.basename(fullPath)
      const parentDir = path.dirname(fullPath)
      let resolvedPath = fullPath
      let index = 1

      while (fs.existsSync(resolvedPath)) {
        const newName = `${dirName} (${index})`
        resolvedPath = path.join(parentDir, newName)
        index++
        if (index > 1000) {
          return { resolvedPath: '', error: '无法创建文件夹：重名过多' }
        }
      }

      await fs.promises.mkdir(resolvedPath, { recursive: true })
      return { resolvedPath, error: null }
    } catch (error) {
      console.error('[IPC] 创建文件夹失败:', error)
      return { resolvedPath: '', error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_CREATE_FILE, async (_, filePath: string, content: string) => {
    try {
      const fullPath = expandTilde(filePath)

      if (!fs.existsSync(fullPath)) {
        await fs.promises.writeFile(fullPath, content, 'utf-8')
        return { resolvedPath: fullPath, error: null }
      }

      const dirName = path.dirname(fullPath)
      const baseName = path.basename(fullPath)
      const ext = path.extname(fullPath)
      const nameWithoutExt = ext ? baseName.slice(0, -ext.length) : baseName
      let resolvedPath = fullPath
      let index = 1

      while (fs.existsSync(resolvedPath)) {
        const newName = ext
          ? `${nameWithoutExt} (${index})${ext}`
          : `${baseName} (${index})`
        resolvedPath = path.join(dirName, newName)
        index++
        if (index > 1000) {
          return { resolvedPath: '', error: '无法创建文件：重名过多' }
        }
      }

      await fs.promises.writeFile(resolvedPath, content, 'utf-8')
      return { resolvedPath, error: null }
    } catch (error) {
      console.error('[IPC] 创建文件失败:', error)
      return { resolvedPath: '', error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_OPEN_WITH_SYSTEM, async (_event, filePath: string) => {
    try {
      const { shell } = await import('electron')
      const result = await shell.openPath(filePath)
      return { error: result || null }
    } catch (err) {
      return { error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_TRASH_ITEM, async (_, paths: string[]) => {
    try {
      const fullPaths = paths.map(expandTilde)
      return await trashItems(fullPaths)
    } catch (error) {
      return { successCount: 0, errorCount: paths.length, errors: [(error as Error).message] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.FS_READ_FILE_AS_BASE64, async (_, filePath: string) => {
    try {
      const fullPath = expandTilde(filePath)
      const buffer = await fs.promises.readFile(fullPath)
      const base64 = buffer.toString('base64')

      const ext = path.extname(fullPath).toLowerCase()
      const mimeType = getMimeType(ext)

      return { base64, mimeType, error: null }
    } catch (error) {
      console.error('[IPC] 读取文件为 base64 失败:', error)
      return { base64: '', mimeType: '', error: (error as Error).message }
    }
  })

  // ===== LibreOffice 转换与检测 =====

  /** 检测系统是否安装 LibreOffice */
  ipcMain.handle(IPC_CHANNELS.FS_CHECK_LIBREOFFICE, async () => {
    try {
      let sofficePath = ''

      if (process.platform === 'win32') {
        // Windows: 检查常见安装路径
        const candidates = [
          'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
          'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
        ]
        for (const p of candidates) {
          try {
            await fs.promises.access(p, fs.constants.X_OK)
            sofficePath = p
            break
          } catch {
            // 继续检查下一个
          }
        }
      } else if (process.platform === 'darwin') {
        // Mac: 检查 /Applications/LibreOffice.app
        const macPath = '/Applications/LibreOffice.app/Contents/MacOS/soffice'
        try {
          await fs.promises.access(macPath, fs.constants.X_OK)
          sofficePath = macPath
        } catch {
          // 未安装
        }
      } else {
        // Linux/Other: 使用 which 命令
        try {
          const { stdout } = await execAsync('which soffice')
          sofficePath = stdout.trim()
        } catch {
          // 未安装
        }
      }

      return {
        success: true,
        installed: !!sofficePath,
        path: sofficePath,
      }
    } catch (error) {
      return { success: false, installed: false, path: '', error: String(error) }
    }
  })

  /** 使用 LibreOffice 将文件转换为 PDF */
  ipcMain.handle(IPC_CHANNELS.FS_CONVERT_TO_PDF, async (_, filePath: string) => {
    try {
      const sourcePath = expandTilde(filePath)
      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: '源文件不存在' }
      }

      // 使用系统临时目录作为输出
      const outputDir = path.join(
        process.env.TEMP || process.env.TMPDIR || '/tmp',
        'nexus-ppt-preview'
      )
      await fs.promises.mkdir(outputDir, { recursive: true })

      // 清理旧文件
      try {
        const oldFiles = await fs.promises.readdir(outputDir)
        for (const f of oldFiles) {
          await fs.promises.unlink(path.join(outputDir, f))
        }
      } catch {
        // 忽略清理错误
      }

      execFileSync('soffice', [
        '--headless',
        '--convert-to', 'pdf',
        '--outdir', outputDir,
        sourcePath,
      ], { timeout: 60000 })

      // 查找生成的 PDF 文件
      const baseName = path.basename(sourcePath, path.extname(sourcePath))
      const pdfPath = path.join(outputDir, `${baseName}.pdf`)

      if (fs.existsSync(pdfPath)) {
        return { success: true, pdfPath, error: null }
      } else {
        // 有时文件名会有差异，尝试查找目录下唯一的 PDF
        const files = await fs.promises.readdir(outputDir)
        const pdfFiles = files.filter(f => f.endsWith('.pdf'))
        if (pdfFiles.length > 0) {
          return { success: true, pdfPath: path.join(outputDir, pdfFiles[0]), error: null }
        }
        return { success: false, error: '转换后未找到 PDF 文件' }
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // ===== 文件管理工具（智能体调用） =====

  /** 复制文件/目录 */
  ipcMain.handle(IPC_CHANNELS.FILE_COPY, async (_, src: string, dst: string) => {
    try {
      const resolvedSrc = expandTilde(src)
      const resolvedDst = expandTilde(dst)
      // 确保目标目录存在
      const dstDir = path.dirname(resolvedDst)
      await fs.promises.mkdir(dstDir, { recursive: true })
      // 使用 cp 命令（Node.js 16+ 支持 fs.promises.cp）
      if (typeof fs.promises.cp === 'function') {
        await (fs.promises as any).cp(resolvedSrc, resolvedDst, { recursive: true })
      } else {
        const stat = await fs.promises.stat(resolvedSrc)
        const isDir = stat.isDirectory()
        const cmd = makeCopyCommand(resolvedSrc, resolvedDst, isDir)
        await execAsync(cmd)
      }
      return { error: null }
    } catch (error) {
      return { error: (error as Error).message }
    }
  })

  /** 移动文件/目录（剪切） */
  ipcMain.handle(IPC_CHANNELS.FILE_MOVE, async (_, src: string, dst: string) => {
    try {
      const resolvedSrc = expandTilde(src)
      const resolvedDst = expandTilde(dst)
      // 确保目标目录存在
      const dstDir = path.dirname(resolvedDst)
      await fs.promises.mkdir(dstDir, { recursive: true })
      await fs.promises.rename(resolvedSrc, resolvedDst)
      return { error: null }
    } catch (error) {
      return { error: (error as Error).message }
    }
  })

  /** 移入回收站 */
  ipcMain.handle(IPC_CHANNELS.FILE_TRASH, async (_, paths: string | string[]) => {
    try {
      const pathList = Array.isArray(paths) ? paths : [paths]
      const fullPaths = pathList.map(expandTilde)
      return await trashItems(fullPaths)
    } catch (error) {
      const pathList = Array.isArray(paths) ? paths : [paths]
      return { successCount: 0, errorCount: pathList.length, errors: [(error as Error).message] }
    }
  })

  /** 重命名文件/目录，自动处理同名冲突 */
  ipcMain.handle(IPC_CHANNELS.FILE_RENAME, async (_, oldPath: string, newName: string) => {
    try {
      const resolvedOld = expandTilde(oldPath)
      const parentDir = path.dirname(resolvedOld)
      let resolvedNew = path.join(parentDir, newName)

      // 如果目标已存在，自动追加序号
      if (fs.existsSync(resolvedNew)) {
        const lastDotIdx = newName.lastIndexOf('.')
        let baseName: string
        let ext: string
        if (lastDotIdx > 0 && !newName.startsWith('.')) {
          baseName = newName.substring(0, lastDotIdx)
          ext = newName.substring(lastDotIdx)
        } else {
          baseName = newName
          ext = ''
        }
        for (let i = 1; i <= 100; i++) {
          const candidate = `${baseName} (${i})${ext}`
          resolvedNew = path.join(parentDir, candidate)
          if (!fs.existsSync(resolvedNew)) break
        }
      }

      await fs.promises.rename(resolvedOld, resolvedNew)
      return { error: null, newPath: resolvedNew }
    } catch (error) {
      return { error: (error as Error).message, newPath: undefined }
    }
  })
}
