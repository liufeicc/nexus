/**
 * 文件工具：write_file
 *
 * 写入/创建文件内容，自动创建父目录，包含路径安全检查和 staleness 检测。
 */

import fs from 'fs'
import path from 'path'
import { ToolDefinition, ToolResult } from '../../../../core/types/agent'
import { expandTilde, DEVICE_PATHS, isWriteDenied, checkSensitivePath, isExpectedWriteError } from './path-safety'
import { checkFileStaleness, updateReadTimestamp } from './read-file'
import { logger } from '../../../utils/logger'

// ==================== 工具 2: write_file ====================

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: '写入文件内容，完全覆盖现有内容。会覆盖已存在的文件 — 如果需要针对性编辑，使用 patch 工具。写入前会自动创建不存在的父目录。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要写入的文件路径（不存在时自动创建，存在时完全覆盖）',
      },
      content: {
        type: 'string',
        description: '要写入的完整文件内容',
      },
    },
    required: ['path', 'content'],
  },
  handler: async (args): Promise<ToolResult> => {
    const filePath = expandTilde(String(args.path ?? '').trim())
    const content = String(args.content ?? '')

    if (!filePath) {
      return { success: false, output: '文件路径不能为空' }
    }

    // 设备路径检查
    const resolved = path.resolve(filePath)
    for (const device of DEVICE_PATHS) {
      if (resolved.startsWith(device)) {
        return { success: false, output: `无法写入设备路径: ${filePath}` }
      }
    }

    // 写入黑名单检查
    const denyCheck = isWriteDenied(filePath)
    if (denyCheck.denied) {
      return { success: false, output: denyCheck.reason || '写入被拒绝' }
    }

    // 敏感系统路径检查
    const sensitiveErr = checkSensitivePath(filePath)
    if (sensitiveErr) {
      return { success: false, output: sensitiveErr }
    }

    try {
      // 检查 staleness
      const staleWarning = checkFileStaleness(filePath)

      // 创建父目录（如果不存在）
      const dir = path.dirname(resolved)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
        logger.info(`[WriteFile] 创建目录: ${dir}`)
      }

      // 写入文件
      fs.writeFileSync(resolved, content, 'utf-8')

      // 刷新存储的 mtime
      updateReadTimestamp(filePath)

      const size = fs.statSync(resolved).size
      logger.info(`[WriteFile] 写入: ${resolved} (${size} 字节)`)

      let output = `文件已写入: ${resolved} (${size} 字节)`
      if (staleWarning) {
        output += `\n\n${staleWarning}`
      }

      return {
        success: true,
        output,
        data: { path: resolved, size, staleWarning: staleWarning ?? undefined },
      }
    } catch (error: any) {
      if (isExpectedWriteError(error)) {
        logger.debug(`[WriteFile] 预期拒绝: ${error.message}`)
      } else {
        logger.error(`[WriteFile] 写入失败: ${error.message}`)
      }
      return {
        success: false,
        output: `写入文件失败: ${error.message}`,
      }
    }
  },
}
