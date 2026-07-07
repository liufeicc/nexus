/**
 * 文件工具：read_file
 *
 * 读取文本文件内容，带行号和分页支持。
 * 包含：读取去重缓存、连续读取循环检测、文件 staleness 检测、二进制/图片检测。
 *
 * 通过 SessionStateAccess 接口访问会话级状态，不使用模块级全局变量。
 */

import fs from 'fs'
import path from 'path'
import { ToolDefinition, ToolResult } from '../../../../core/types/agent'
import { expandTilde, isPathSafe, DEVICE_PATHS } from './path-safety'
import { runShellCommand } from './shell-exec'
import { logger } from '../../../utils/logger'
import { supportsVision } from '../../model-metadata'

// ==================== 会话状态访问接口 ====================

/**
 * 读取去重缓存条目
 */
interface ReadEntry {
  mtime: number
  count: number
}

/**
 * 会话级状态访问接口。
 * 由 AIAgent 实现并注入到工具中，避免模块级全局变量。
 */
interface FileToolSession {
  // 读取去重
  getReadCache(): Map<string, ReadEntry>
  getReadTrackerState(): { lastKey: string | null; count: number }
  setReadTrackerState(lastKey: string | null, count: number): void
  resetReadTracker(): void

  // 搜索循环（由 search-files 使用，这里声明以便 reset 时联动）
  resetSearchTracker(): void

  // 文件时间戳
  getReadTimestamps(): Map<string, number>

  // 当前模型名（用于判断是否支持图片识别）
  getCurrentModel(): string
}

// ==================== 图片扩展名检测 ====================

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico',
  '.tiff', '.tif', '.avif',
])

function isImagePath(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase())
}

// ==================== 常量 ====================

const DEFAULT_LINES = 500
const MAX_LINES = 2000
const MAX_OUTPUT_CHARS = 100_000

// ==================== 读取去重 key 构建 ====================

function buildReadKey(resolvedPath: string, offset: number, limit: number): string {
  return `${resolvedPath}|${offset}|${limit}`
}

// ==================== 工具 1: read_file ====================

let session: FileToolSession | null = null

/**
 * 绑定会话状态（由 AIAgent 注册工具时调用）
 */
export function bindFileToolSession(s: FileToolSession): void {
  session = s
}

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: '读取文件内容，支持文本文件和图片文件。文本文件：带行号和分页，默认每次读取 500 行，最多 2000 行。如果文件很大，使用 offset 和 limit 参数分段读取。图片文件：自动将图片内容发送给模型（如果模型支持视觉），让模型可以"看到"图片内容。支持绝对路径和 ~ 开头的路径。如果路径是目录，返回目录文件列表。对于文本文件，不要使用 cat/head/tail 等终端命令，应该用这个工具。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径，支持绝对路径和 ~ 开头的路径（如 ~/project/file.txt）',
      },
      offset: {
        type: 'number',
        description: '起始行号（从 1 开始），默认 1',
      },
      limit: {
        type: 'number',
        description: '最多读取行数，默认 500，最大 2000',
      },
    },
    required: ['path'],
  },
  handler: async (args): Promise<ToolResult> => {
    const filePath = expandTilde(String(args.path ?? args.file_path ?? '').trim())

    if (!filePath) {
      return { success: false, output: '文件路径不能为空' }
    }

    // 路径安全检查
    const safety = isPathSafe(filePath)
    if (!safety.safe) {
      return { success: false, output: safety.reason || '路径不安全' }
    }

    // 设备路径检查
    const resolved = path.resolve(filePath)
    for (const device of DEVICE_PATHS) {
      if (resolved.startsWith(device)) {
        return { success: false, output: `无法读取设备文件: ${filePath}` }
      }
    }

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return { success: false, output: await suggestSimilarFiles(filePath) }
    }

    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(filePath, { withFileTypes: true })
      const files = entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
      }))
      const lines = entries.map(e =>
        e.isDirectory() ? `[${e.name}]` : `  ${e.name}`
      )
      return {
        success: true,
        output: `目录内容 (${filePath}):\n${lines.join('\n')}`,
        data: { files, isDirectory: true },
      }
    }

    // 图片检测
    if (isImagePath(filePath)) {
      const sizeMB = stat.size / (1024 * 1024)
      const currentModel = session?.getCurrentModel() || ''
      const canSeeImage = supportsVision(currentModel) && sizeMB < 5

      logger.info(
        `[ReadFile] 图片文件: ${filePath}, 大小: ${(sizeMB * 1024).toFixed(1)}KB, ` +
        `模型: ${currentModel || '(未设置)'}, 支持视觉: ${supportsVision(currentModel)}, ` +
        `可发送图片: ${canSeeImage}`
      )

      if (canSeeImage) {
        // 模型支持视觉且图片 < 5MB：读取 base64 发送给模型
        try {
          const buffer = fs.readFileSync(filePath)
          const base64 = buffer.toString('base64')
          const ext = path.extname(filePath).toLowerCase()
          const mimeMap: Record<string, string> = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
            '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
            '.tiff': 'image/tiff', '.tif': 'image/tiff', '.avif': 'image/avif',
          }
          const mimeType = mimeMap[ext] || 'image/png'
          return {
            success: true,
            output: `[图片文件 ${ext}，大小: ${(stat.size / 1024).toFixed(1)}KB，已作为图片内容发送]`,
            data: { isImage: true, extname: ext, size: stat.size },
            imageData: { base64, mimeType },
          }
        } catch {
          // 读取失败，降级到描述文本
        }
      }

      // 模型不支持视觉或图片 >= 5MB：返回描述文本
      return {
        success: true,
        output: `[图片文件 ${path.extname(filePath)}，大小: ${(stat.size / 1024).toFixed(1)}KB。模型不支持图片识别或文件过大，无法查看内容。]`,
        data: { isImage: true, extname: path.extname(filePath), size: stat.size },
      }
    }

    // 二进制检测（读取前 512 字节）
    const header = fs.readFileSync(filePath, { encoding: null }).slice(0, 512)
    const isBinary = header.some((byte: number) =>
      byte < 32 && byte !== 9 && byte !== 10 && byte !== 13
    )
    if (isBinary) {
      return {
        success: true,
        output: `[二进制文件, 大小: ${(stat.size / 1024).toFixed(1)}KB。无法作为文本读取。]`,
        data: { isBinary: true, size: stat.size },
      }
    }

    // 分页参数
    const offset = typeof args.offset === 'number' ? Math.max(1, Math.floor(args.offset)) : 1
    const limit = typeof args.limit === 'number'
      ? Math.min(Math.max(1, Math.floor(args.limit)), MAX_LINES)
      : DEFAULT_LINES

    // 兼容旧的 start_line/end_line 参数
    if (args.start_line || args.end_line) {
      const sl = typeof args.start_line === 'number' ? Math.max(1, Math.floor(args.start_line)) : 1
      const el = typeof args.end_line === 'number' ? Math.floor(args.end_line) : sl + limit - 1
      return readLinesWithSed(filePath, resolved, sl, el - sl + 1, stat)
    }

    return readLinesWithSed(filePath, resolved, offset, limit, stat)
  },
}

/**
 * 使用 sed 命令分页读取文件
 */
async function readLinesWithSed(
  filePath: string,
  resolved: string,
  offset: number,
  limit: number,
  stat: fs.Stats,
): Promise<ToolResult> {
  const endLine = offset + limit - 1

  // 获取总行数
  let totalLines = 0
  try {
    const stdout = await runShellCommand(`wc -l < "${resolved}" 2>/dev/null`, { timeout: 5000 })
    totalLines = parseInt(stdout.trim(), 10) || 0
  } catch {
    return fallbackReadFileSync(filePath, resolved, offset, limit, stat)
  }

  // 使用 sed 读取指定行范围
  let sedContent = ''
  try {
    sedContent = await runShellCommand(
      `sed -n '${offset},${endLine}p' "${resolved}" 2>/dev/null`,
      { timeout: 10000, maxBuffer: 1024 * 1024 * 5 }
    )
  } catch (err: any) {
    if (err.code === 1) {
      return {
        success: false,
        output: `文件共 ${totalLines} 行，offset=${offset} 超出范围。`,
        data: { totalLines, offset, limit },
      }
    }
    return fallbackReadFileSync(filePath, resolved, offset, limit, stat)
  }

  // 添加行号
  const lines = sedContent.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  const numberedLines = lines.map((line, i) => {
    const lineNum = offset + i
    return `${String(lineNum).padStart(6)}  ${line}`
  })
  let output = numberedLines.join('\n')

  // 字符数上限检查
  let charsExceeded = false
  if (output.length > MAX_OUTPUT_CHARS) {
    output = output.slice(0, MAX_OUTPUT_CHARS)
    charsExceeded = true
  }

  // 截断标志
  const truncated = totalLines > endLine

  if (truncated && !charsExceeded) {
    output += `\n\n[文件共 ${totalLines} 行，已读取 ${offset}-${endLine} 行。使用 offset=${endLine + 1} 继续读取。]`
  } else if (charsExceeded) {
    output += `\n\n[输出已达到 ${MAX_OUTPUT_CHARS.toLocaleString()} 字符上限，已截断。建议使用更小的 limit 或缩小读取范围。]`
  }

  // 去重与循环检测（使用会话级状态）
  const readKey = buildReadKey(resolved, offset, limit)
  const currentMtime = stat.mtimeMs
  const cache = session?.getReadCache() ?? new Map()
  const tracker = session?.getReadTrackerState() ?? { lastKey: null, count: 0 }

  if (tracker.lastKey === readKey) {
    tracker.count++
  } else {
    tracker.lastKey = readKey
    tracker.count = 1
  }
  session?.setReadTrackerState(tracker.lastKey, tracker.count)

  const cached = cache.get(readKey)
  if (cached && cached.mtime === currentMtime) {
    if (tracker.count >= 4) {
      return {
        success: false,
        output: `已阻止：你已连续 ${tracker.count} 次读取同一文件的同一区域（第 ${offset}-${endLine} 行）。内容未变，请停止重复读取，继续你的任务。`,
        data: { blocked: true, alreadyRead: tracker.count },
      }
    }
    if (tracker.count >= 3) {
      output += `\n\n[警告：你已连续 ${tracker.count} 次读取同一区域，文件内容未变。]`
    }
  } else {
    cache.set(readKey, { mtime: currentMtime, count: 1 })
  }

  logger.info(`[ReadFile] 读取: ${filePath} (第 ${offset}-${endLine} 行，共 ${totalLines} 行)`)

  // 记录读取时间戳，供 staleness 检测使用
  updateReadTimestamp(filePath)

  return {
    success: true,
    output,
    data: {
      path: filePath,
      offset,
      limit,
      totalLines,
      readLines: lines.length,
      truncated,
      charsExceeded,
    },
  }
}

/**
 * sed 失败时的降级方案
 */
function fallbackReadFileSync(
  filePath: string,
  resolved: string,
  offset: number,
  limit: number,
  stat: fs.Stats,
): Promise<ToolResult> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const allLines = content.split('\n')
    const sliced = allLines.slice(offset - 1, offset + limit - 1)
    const numbered = sliced.map((line, i) =>
      `${String(offset + i).padStart(6)}  ${line}`
    )
    const totalLines = allLines.length

    let output = numbered.join('\n')
    const truncated = totalLines > offset + limit - 1
    if (truncated) {
      output += `\n\n[文件共 ${totalLines} 行，已读取 ${offset}-${offset + limit - 1} 行。使用 offset=${offset + limit} 继续读取。]`
    }

    return Promise.resolve({
      success: true,
      output,
      data: { path: filePath, offset, limit, totalLines, readLines: sliced.length, truncated },
    })
  } catch (err: any) {
    return Promise.resolve({
      success: false,
      output: `读取文件失败: ${err.message || err}`,
    })
  }
}

/**
 * 文件不存在时，推荐相似文件
 */
async function suggestSimilarFiles(filePath: string): Promise<string> {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath)

  if (!fs.existsSync(dir)) {
    return `文件不存在: ${filePath}\n目录也不存在: ${dir}`
  }

  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    const names = entries.filter(e => e.isFile()).map(e => e.name)

    const similar = names.filter(n =>
      n.toLowerCase().includes(base.toLowerCase()) ||
      base.toLowerCase().includes(n.toLowerCase().split('.')[0])
    ).slice(0, 10)

    if (similar.length > 0) {
      return `文件不存在: ${filePath}\n\n在目录 ${dir} 中找到相似文件:\n${similar.map(s => `  ${s}`).join('\n')}`
    }

    const allFiles = names.slice(0, 20)
    return `文件不存在: ${filePath}\n\n目录 ${dir} 中的文件:\n${allFiles.map(s => `  ${s}`).join('\n')}`
  } catch {
    return `文件不存在: ${filePath}`
  }
}

// ==================== 文件 Staleness 检测 ====================

/**
 * 记录文件当前 mtime
 */
export function updateReadTimestamp(filePath: string): void {
  try {
    const resolved = path.resolve(filePath)
    const mtime = fs.statSync(resolved).mtimeMs
    session?.getReadTimestamps().set(resolved, mtime)
  } catch {
    // 文件可能已被删除，忽略
  }
}

/**
 * 检查文件自上次读取后是否被外部修改
 */
export function checkFileStaleness(filePath: string): string | null {
  try {
    const resolved = path.resolve(filePath)
    const timestamps = session?.getReadTimestamps() ?? new Map()
    const readMtime = timestamps.get(resolved)
    if (readMtime == null) return null

    const currentMtime = fs.statSync(resolved).mtimeMs
    if (currentMtime !== readMtime) {
      return `警告: ${filePath} 在你上次读取后被修改（外部编辑或并发操作）。你读取的内容可能已过时，建议在写入前重新读取文件确认当前内容。`
    }
  } catch {
    // stat 失败，文件可能已被删除
  }
  return null
}

/**
 * 重置读取跟踪器（会话状态版）
 */
export function resetReadTracker(): void {
  session?.resetReadTracker()
}
