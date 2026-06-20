/**
 * NEXUS.md 目录档案工具
 *
 * 允许智能体读取和写入目标目录下的 NEXUS.md 文件。
 * NEXUS.md 是对目录的描述，包含结构、技术栈、重要文件等信息。
 *
 * 工具列表：
 * - nexus_profile_read: 读取目录下的 NEXUS.md
 * - nexus_profile_write: 写入/创建 NEXUS.md
 * - nexus_profile_scan: 扫描子目录中是否存在 NEXUS.md
 */

import { ToolDefinition, ToolResult } from '../../../core/types/agent'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import { execSync } from 'child_process'
import { logger } from '../../utils/logger'

const NEXUS_FILENAME = '.NEXUS.md'
const MAX_CONTENT_LENGTH = 3000

/**
 * 在 Windows 上设置文件隐藏属性（使用 attrib +h）
 * 在 Linux/macOS 上无操作（以 . 开头的文件自动隐藏）
 */
function setHiddenAttribute(filePath: string): void {
  if (process.platform === 'win32') {
    try {
      // 使用 PowerShell 或 cmd 设置隐藏属性
      execSync(`attrib +h "${filePath}"`, { stdio: 'ignore' })
      logger.info(`[NexusProfile] 已设置 Windows 隐藏属性: ${filePath}`)
    } catch (err) {
      logger.warn(`[NexusProfile] 设置 Windows 隐藏属性失败: ${filePath}`, err)
    }
  }
}

// ==================== Read 工具 ====================

/**
 * 读取目录下的 NEXUS.md 文件
 */
export const nexusProfileReadTool: ToolDefinition = {
  name: 'nexus_profile_read',
  description: (
    '读取指定目录下的 NEXUS.md 目录档案文件。'
    + 'NEXUS.md 包含该目录的结构、技术栈、重要文件等描述信息。\n\n'
    + '使用场景：\n'
    + '- 进入新目录时，了解项目背景和技术栈\n'
    + '- 查看已有的目录描述，避免重复分析\n\n'
    + '参数:\n'
    + '- dir: 目标目录的绝对路径\n\n'
    + '返回:\n'
    + '- exists: 文件是否存在\n'
    + '- content: 文件内容（存在时）\n'
    + '- error: 错误信息（失败时）'
  ),
  parameters: {
    type: 'object',
    properties: {
      dir: {
        type: 'string',
        description: '目标目录的绝对路径',
      },
    },
    required: ['dir'],
  },
  handler: async (args): Promise<ToolResult> => {
    const dir = args.dir as string
    if (!dir) {
      return { success: false, output: '错误: 缺少 dir 参数' }
    }

    try {
      const filePath = join(dir, NEXUS_FILENAME)
      if (!existsSync(filePath)) {
        return {
          success: true,
          output: `目录 "${dir}" 下不存在 NEXUS.md 文件。你可以使用 nexus_profile_write 工具创建它。`,
          data: { exists: false },
        }
      }

      const content = readFileSync(filePath, 'utf-8')
      logger.info(`[NexusProfile] 读取 NEXUS.md: ${filePath} (${content.length} 字符)`)
      return {
        success: true,
        output: content,
        data: { exists: true, content },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`[NexusProfile] 读取失败: ${dir}`, error)
      return { success: false, output: `读取失败: ${message}` }
    }
  },
}

// ==================== Write 工具 ====================

/**
 * 写入/创建 NEXUS.md 文件
 */
export const nexusProfileWriteTool: ToolDefinition = {
  name: 'nexus_profile_write',
  description: (
    '写入或创建指定目录下的 NEXUS.md 目录档案文件。\n\n'
    + '使用场景：\n'
    + '- 新建项目后，为该目录创建描述文件\n'
    + '- 目录结构发生重大变化时，更新描述\n'
    + '- 用户请求生成或更新目录档案\n\n'
    + '参数:\n'
    + '- dir: 目标目录的绝对路径\n'
    + '- content: NEXUS.md 文件内容（Markdown 格式，不超过 3000 字符）\n\n'
    + '限制:\n'
    + '- 内容不得超过 3000 字符\n'
    + '- 应使用中文编写\n'
    + '- 应包含：概述、技术栈、重要文件说明'
  ),
  parameters: {
    type: 'object',
    properties: {
      dir: {
        type: 'string',
        description: '目标目录的绝对路径',
      },
      content: {
        type: 'string',
        description: 'NEXUS.md 文件内容（Markdown 格式，不超过 3000 字符）',
      },
    },
    required: ['dir', 'content'],
  },
  handler: async (args): Promise<ToolResult> => {
    const dir = args.dir as string
    const content = args.content as string

    if (!dir) {
      return { success: false, output: '错误: 缺少 dir 参数' }
    }
    if (!content) {
      return { success: false, output: '错误: 缺少 content 参数' }
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return {
        success: false,
        output: `错误: 内容超出限制（当前 ${content.length} 字符，最大 ${MAX_CONTENT_LENGTH} 字符）`,
      }
    }

    try {
      if (!existsSync(dir)) {
        return { success: false, output: `错误: 目录不存在: ${dir}` }
      }

      const filePath = join(dir, NEXUS_FILENAME)
      const isNew = !existsSync(filePath)
      writeFileSync(filePath, content, 'utf-8')
      setHiddenAttribute(filePath)
      logger.info(`[NexusProfile] 写入 NEXUS.md: ${filePath} (${content.length} 字符)`)

      return {
        success: true,
        output: isNew
          ? `已在 "${dir}" 目录下创建 NEXUS.md（${content.length} 字符）`
          : `已更新 "${dir}" 目录下的 NEXUS.md（${content.length} 字符）`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`[NexusProfile] 写入失败: ${dir}`, error)
      return { success: false, output: `写入失败: ${message}` }
    }
  },
}

// ==================== Scan 工具 ====================

/**
 * 扫描子目录中的 NEXUS.md 存在情况
 */
export const nexusProfileScanTool: ToolDefinition = {
  name: 'nexus_profile_scan',
  description: (
    '扫描指定目录的直接子目录，查找存在的 NEXUS.md 文件。\n\n'
    + '使用场景：\n'
    + '- 想了解当前目录下哪些子目录已有描述文件\n'
    + '- 决定是否需要下钻读取子目录的 NEXUS.md\n\n'
    + '参数:\n'
    + '- dir: 目标目录的绝对路径\n\n'
    + '返回:\n'
    + '- 子目录名称列表（仅那些存在 NEXUS.md 的目录）'
  ),
  parameters: {
    type: 'object',
    properties: {
      dir: {
        type: 'string',
        description: '目标目录的绝对路径',
      },
    },
    required: ['dir'],
  },
  handler: async (args): Promise<ToolResult> => {
    const dir = args.dir as string
    if (!dir) {
      return { success: false, output: '错误: 缺少 dir 参数' }
    }

    try {
      if (!existsSync(dir)) {
        return { success: false, output: `错误: 目录不存在: ${dir}` }
      }

      const items = safeReaddir(dir)
      const childDirsWithNexus: string[] = []

      for (const item of items) {
        if (item.isDirectory) {
          const nexusPath = join(item.path, NEXUS_FILENAME)
          if (existsSync(nexusPath)) {
            childDirsWithNexus.push(item.name)
          }
        }
      }

      if (childDirsWithNexus.length === 0) {
        return {
          success: true,
          output: `"${basename(dir)}" 的子目录中没有找到任何 NEXUS.md 文件。`,
          data: { children: [] },
        }
      }

      const lines = childDirsWithNexus.map(name => `- ${name}/NEXUS.md`).join('\n')
      return {
        success: true,
        output: `在 "${basename(dir)}" 的 ${childDirsWithNexus.length} 个子目录中找到 NEXUS.md:\n\n${lines}`,
        data: { children: childDirsWithNexus },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`[NexusProfile] 扫描失败: ${dir}`, error)
      return { success: false, output: `扫描失败: ${message}` }
    }
  },
}

interface DirItem {
  name: string
  path: string
  isDirectory: boolean
}

function safeReaddir(dir: string): DirItem[] {
  try {
    return readdirSync(dir).map(name => {
      const fullPath = join(dir, name)
      const stat = statSync(fullPath)
      return { name, path: fullPath, isDirectory: stat.isDirectory() }
    })
  } catch {
    return []
  }
}
