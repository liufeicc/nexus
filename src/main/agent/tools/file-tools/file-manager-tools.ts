/**
 * 文件管理工具：copy_file、move_file、trash_file、rename_file
 *
 * 为智能体提供文件复制、移动、删除、重命名等操作能力。
 * 这些工具直接在主进程使用 Node.js fs 和 Electron shell 模块操作文件系统。
 */

import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { shell } from 'electron'
import { ToolDefinition, ToolResult } from '../../../../core/types/agent'
import { expandTilde, isWriteDenied } from './path-safety'
import { logger } from '../../../utils/logger'

const execAsync = promisify(exec)

// ==================== 内部辅助函数 ====================

/** 根据操作系统生成复制命令 */
function makeCopyCommand(src: string, dst: string, isDir: boolean): string {
  const isWindows = process.platform === 'win32'
  if (isWindows) {
    return isDir ? `xcopy "${src}" "${dst}" /E /I /Y` : `copy /Y "${src}" "${dst}"`
  }
  const escapedSrc = src.replace(/'/g, "'\\''")
  const escapedDst = dst.replace(/'/g, "'\\''")
  return `cp -r '${escapedSrc}' '${escapedDst}'`
}

// ==================== 工具定义 ====================

/**
 * copy_file: 复制文件或目录到目标路径
 */
export const copyFileTool: ToolDefinition = {
  name: 'copy_file',
  description: '复制文件或目录到目标路径。如果目标已存在则覆盖。',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: '源文件或目录的路径' },
      destination: { type: 'string', description: '目标文件或目录的路径' },
    },
    required: ['source', 'destination'],
  },
  handler: async (args): Promise<ToolResult> => {
    const source = expandTilde(String(args.source))
    const destination = expandTilde(String(args.destination))

    // 安全检查
    const denyCheck = isWriteDenied(destination)
    if (denyCheck.denied) {
      return { success: false, output: `复制被拒绝: ${denyCheck.reason}` }
    }

    try {
      // 确保源存在
      if (!fs.existsSync(source)) {
        return { success: false, output: `源路径不存在: ${source}` }
      }
      // 确保目标目录存在
      const dstDir = path.dirname(destination)
      fs.mkdirSync(dstDir, { recursive: true })
      // 执行复制
      if (typeof fs.promises.cp === 'function') {
        await (fs.promises as any).cp(source, destination, { recursive: true })
      } else {
        const stat = fs.statSync(source)
        const cmd = makeCopyCommand(source, destination, stat.isDirectory())
        await execAsync(cmd)
      }
      return { success: true, output: `已复制: ${source} -> ${destination}` }
    } catch (error) {
      logger.error('[copy_file] 复制失败:', error)
      return { success: false, output: `复制失败: ${(error as Error).message}` }
    }
  },
}

/**
 * move_file: 移动文件或目录到目标路径（剪切）
 */
export const moveFileTool: ToolDefinition = {
  name: 'move_file',
  description: '移动文件或目录到目标路径（剪切操作）。源文件将被移除。',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: '源文件或目录的路径' },
      destination: { type: 'string', description: '目标文件或目录的路径' },
    },
    required: ['source', 'destination'],
  },
  handler: async (args): Promise<ToolResult> => {
    const source = expandTilde(String(args.source))
    const destination = expandTilde(String(args.destination))

    // 安全检查
    const denyCheck = isWriteDenied(destination)
    if (denyCheck.denied) {
      return { success: false, output: `移动被拒绝: ${denyCheck.reason}` }
    }

    try {
      if (!fs.existsSync(source)) {
        return { success: false, output: `源路径不存在: ${source}` }
      }
      const dstDir = path.dirname(destination)
      fs.mkdirSync(dstDir, { recursive: true })
      await fs.promises.rename(source, destination)
      return { success: true, output: `已移动: ${source} -> ${destination}` }
    } catch (error) {
      logger.error('[move_file] 移动失败:', error)
      return { success: false, output: `移动失败: ${(error as Error).message}` }
    }
  },
}

/**
 * trash_file: 将文件/目录移入回收站
 */
export const trashFileTool: ToolDefinition = {
  name: 'trash_file',
  description: '将文件或目录移入系统回收站。支持同时操作多个文件。',
  parameters: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string', description: '文件或目录路径' },
        description: '要删除的文件或目录路径列表（单个路径也可放在数组中）',
      },
    },
    required: ['paths'],
  },
  handler: async (args): Promise<ToolResult> => {
    const pathsList = Array.isArray(args.paths)
      ? args.paths.map((p: unknown) => expandTilde(String(p)))
      : [expandTilde(String(args.paths))]

    let successCount = 0
    let errorCount = 0
    const errors: string[] = []

    for (const p of pathsList) {
      try {
        if (!fs.existsSync(p)) {
          errorCount++
          errors.push(`${p}: 文件不存在`)
          continue
        }
        await shell.trashItem(p)
        successCount++
      } catch (err) {
        errorCount++
        errors.push(`${p}: ${(err as Error).message}`)
      }
    }

    const parts: string[] = []
    if (successCount > 0) parts.push(`成功 ${successCount} 个`)
    if (errorCount > 0) parts.push(`失败 ${errorCount} 个: ${errors.join(', ')}`)
    return {
      success: successCount > 0,
      output: parts.length > 0 ? parts.join('，') : '删除操作完成',
    }
  },
}

/**
 * rename_file: 重命名文件或目录
 */
export const renameFileTool: ToolDefinition = {
  name: 'rename_file',
  description: '重命名文件或目录。如果目标名称已存在，会自动添加序号后缀。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '当前文件或目录的完整路径' },
      newName: { type: 'string', description: '新的文件或目录名称（不含路径）' },
    },
    required: ['path', 'newName'],
  },
  handler: async (args): Promise<ToolResult> => {
    const filePath = expandTilde(String(args.path))
    const newName = String(args.newName)

    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, output: `文件不存在: ${filePath}` }
      }

      const parentDir = path.dirname(filePath)
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

      await fs.promises.rename(filePath, resolvedNew)
      return { success: true, output: `已重命名: ${filePath} -> ${resolvedNew}` }
    } catch (error) {
      logger.error('[rename_file] 重命名失败:', error)
      return { success: false, output: `重命名失败: ${(error as Error).message}` }
    }
  },
}
