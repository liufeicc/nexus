/**
 * 文件工具：search_files
 *
 * 搜索文件内容或按文件名查找。使用 ripgrep (rg) 优先，grep 备选。
 * 包含：搜索循环检测、结果脱敏、rg/grep 内容搜索、rg --files 文件搜索。
 *
 * 通过 SessionStateAccess 接口访问会话级状态，不使用模块级全局变量。
 */

import fs from 'fs'
import { ToolDefinition, ToolResult } from '../../../../core/types/agent'
import { expandTilde } from './path-safety'
import { resetReadTracker } from './read-file'
import { runShellCommand, commandExists } from './shell-exec'
import { redactSensitiveText } from '../../utils/redact'
import { logger } from '../../../utils/logger'

// ==================== Shell 参数转义 ====================

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\"'\"'")}'`
}

// ==================== 搜索循环检测（会话级） ====================

/**
 * 搜索循环检测状态访问器。
 * 由 AIAgent 注入，避免模块级全局变量。
 */
let getSearchState: (() => { lastKey: string | null; count: number }) | null = null
let setSearchState: ((lastKey: string | null, count: number) => void) | null = null

export function bindSearchState(
  getFn: () => { lastKey: string | null; count: number },
  setFn: (lastKey: string | null, count: number) => void,
): void {
  getSearchState = getFn
  setSearchState = setFn
}

function checkSearchLoop(
  pattern: string, target: string, searchPath: string,
  fileGlob: string | undefined, limit: number, offset: number,
  outputMode: string, context: number,
): { blocked?: number; warning?: number } | null {
  const key = `${pattern}|${target}|${searchPath}|${fileGlob ?? ''}|${limit}|${offset}|${outputMode}|${context}`

  const state = getSearchState?.() ?? { lastKey: null, count: 0 }
  if (state.lastKey === key) {
    state.count++
  } else {
    state.lastKey = key
    state.count = 1
  }
  setSearchState?.(state.lastKey, state.count)

  if (state.count >= 4) {
    return { blocked: state.count }
  }
  if (state.count >= 3) {
    return { warning: state.count }
  }
  return null
}

function getCurrentSearchCount(): number {
  return getSearchState?.().count ?? 0
}

/**
 * 重置搜索跟踪器
 */
function resetSearchTracker(): void {
  setSearchState?.(null, 0)
  resetReadTracker()
}

// ==================== 常量 ====================

// ==================== 工具 3: search_files ====================

export const searchFilesTool: ToolDefinition = {
  name: 'search_files',
  description: `搜索文件内容或按文件名查找。不要用 grep/rg/find/ls 等终端命令搜索，应该用这个工具。

内容搜索（target='content'）：在文件中搜索正则表达式。输出模式：完整匹配（带行号）、仅文件路径、匹配计数。
文件查找（target='files'）：按 glob 模式查找文件（如 '*.py'、'*config*'）。也可以用来代替 ls，结果按修改时间排序。`,
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: '搜索关键词或正则表达式（内容搜索），或 glob 模式（文件查找，如 "*.py"）',
      },
      target: {
        type: 'string',
        description: "'content' 搜索文件内容（默认），'files' 按文件名查找",
        enum: ['content', 'files'],
      },
      path: {
        type: 'string',
        description: '搜索起始路径，默认为当前工作目录',
      },
      file_glob: {
        type: 'string',
        description: '内容搜索时按 glob 模式过滤文件，如 "*.ts" 或 "*.py"',
      },
      limit: {
        type: 'number',
        description: '最多返回结果数，默认 50',
      },
      offset: {
        type: 'number',
        description: '跳过前 N 个结果（分页），默认 0',
      },
      output_mode: {
        type: 'string',
        description: "输出格式：'content' 带行号的匹配行（默认），'files_only' 仅文件路径，'count' 每文件匹配数",
        enum: ['content', 'files_only', 'count'],
      },
      context: {
        type: 'number',
        description: '每个匹配行前后的上下文行数，默认 0',
      },
    },
    required: ['pattern'],
  },
  handler: async (args): Promise<ToolResult> => {
    const pattern = String(args.pattern ?? args.query ?? '').trim()
    const searchPath = args.path ? expandTilde(String(args.path)) : process.env.HOME || '/tmp'
    const target = (args.target as string) || (args.type as string) || 'content'
    const fileGlob = args.file_glob ? String(args.file_glob) : (args.glob ? String(args.glob) : undefined)
    const limit = typeof args.limit === 'number' ? Math.max(1, Math.floor(args.limit)) : 50
    const offset = typeof args.offset === 'number' ? Math.max(0, Math.floor(args.offset)) : 0
    const outputMode = (args.output_mode as string) || 'content'
    const context = typeof args.context === 'number' ? Math.max(0, Math.floor(args.context)) : 0

    if (!pattern) {
      return { success: false, output: '搜索关键词不能为空' }
    }

    if (!fs.existsSync(searchPath)) {
      return { success: false, output: `搜索路径不存在: ${searchPath}` }
    }

    // 循环检测
    const loopCheck = checkSearchLoop(pattern, target, searchPath, fileGlob, limit, offset, outputMode, context)
    if (loopCheck?.blocked) {
      return {
        success: false,
        output: `已阻止：你已连续 ${loopCheck.blocked} 次执行完全相同的搜索。结果未变，请停止重复搜索，继续你的任务。`,
        data: { blocked: true, alreadySearched: loopCheck.blocked },
      }
    }

    // 搜索前重置 read tracker
    resetReadTracker()

    try {
      if (target === 'files') {
        return searchFiles(pattern, searchPath, limit, offset)
      }

      return searchContent(pattern, searchPath, fileGlob, limit, offset, outputMode, context)
    } catch (error: any) {
      if (error.code === 1) {
        return { success: true, output: `未找到匹配的内容: ${pattern}`, data: { matches: 0 } }
      }
      const message = error.message || String(error)
      return { success: false, output: `搜索失败: ${message}` }
    }
  },
}

/**
 * 按文件名搜索（rg --files 优先，fallback find）
 */
async function searchFiles(
  pattern: string, searchPath: string, limit: number, offset: number,
): Promise<ToolResult> {
  const searchPattern = (!pattern.startsWith('**/') && !pattern.includes('/'))
    ? `*${pattern}`
    : pattern

  if (await commandExists('rg')) {
    return searchFilesRg(searchPattern, searchPath, limit, offset)
  }

  // fallback: find
  const stdout = await runShellCommand(
    `find ${escapeShellArg(searchPath)} -not -path '*/.*' -type f -name ${escapeShellArg(searchPattern)} -printf '%T@ %p\\n' 2>/dev/null | sort -rn | tail -n +${offset + 1} | head -n ${limit}`,
    { timeout: 15000 }
  )

  const files = stdout.trim().split('\n').filter(Boolean).map(line => {
    const spaceIdx = line.indexOf(' ')
    return spaceIdx >= 0 ? line.slice(spaceIdx + 1) : line
  })

  if (files.length === 0) {
    return { success: true, output: `未找到匹配的文件: ${pattern}`, data: { matches: 0 } }
  }

  const output = files.join('\n')
  logger.info(`[SearchFiles] 文件搜索: "${pattern}" in ${searchPath} (${files.length} 个匹配)`)

  return {
    success: true,
    output: `找到 ${files.length} 个匹配的文件:\n${output}`,
    data: { files, total_count: files.length },
  }
}

/**
 * 使用 rg --files 搜索文件名
 */
async function searchFilesRg(
  pattern: string, searchPath: string, limit: number, offset: number,
): Promise<ToolResult> {
  const fetchLimit = limit + offset
  const stdout = await runShellCommand(
    `rg --files -g ${escapeShellArg(pattern)} ${escapeShellArg(searchPath)} 2>/dev/null | head -n ${fetchLimit}`,
    { timeout: 30000, maxBuffer: 1024 * 1024 * 5 }
  )

  const allFiles = stdout.trim().split('\n').filter(Boolean)
  const page = allFiles.slice(offset, offset + limit)
  const truncated = allFiles.length >= fetchLimit

  if (page.length === 0) {
    return { success: true, output: `未找到匹配的文件: ${pattern}`, data: { matches: 0 } }
  }

  const output = page.join('\n')
  let resultOutput = `找到 ${page.length} 个匹配的文件:\n${output}`

  if (truncated) {
    resultOutput += `\n\n[Hint: 结果已截断。使用 offset=${offset + limit} 查看更多，或缩小搜索范围。]`
  }

  logger.info(`[SearchFiles] rg 文件搜索: "${pattern}" in ${searchPath} (${page.length} 个匹配)`)

  return {
    success: true,
    output: resultOutput,
    data: { files: page, total_count: allFiles.length, truncated },
  }
}

/**
 * 搜索文件内容（rg 优先，fallback grep）
 */
async function searchContent(
  pattern: string, searchPath: string, fileGlob: string | undefined,
  limit: number, offset: number, outputMode: string, context: number,
): Promise<ToolResult> {
  let output: string
  let totalCount = 0

  if (await commandExists('rg')) {
    const result = await searchContentRg(pattern, searchPath, fileGlob, limit, offset, outputMode, context)
    output = result.output
    totalCount = result.totalCount
  } else if (await commandExists('grep')) {
    const result = await searchContentGrep(pattern, searchPath, fileGlob, limit, offset, outputMode, context)
    output = result.output
    totalCount = result.totalCount
  } else {
    return { success: false, output: '系统中未安装 ripgrep 或 grep，无法执行搜索' }
  }

  // 脱敏搜索结果
  output = redactSensitiveText(output)

  const searchCount = getCurrentSearchCount()
  if (searchCount >= 3) {
    output += `\n\n[警告：你已连续 ${searchCount} 次执行完全相同的搜索。结果未变，请使用已有的信息。]`
  }

  logger.info(`[SearchFiles] 内容搜索: "${pattern}" in ${searchPath} (${totalCount} 个匹配)`)

  return {
    success: true,
    output,
    data: { matches: totalCount, pattern, path: searchPath },
  }
}

/**
 * 使用 ripgrep 搜索文件内容
 */
async function searchContentRg(
  pattern: string, searchPath: string, fileGlob: string | undefined,
  limit: number, offset: number, outputMode: string, context: number,
): Promise<{ output: string; totalCount: number }> {
  const cmdParts: string[] = ['rg']

  cmdParts.push('--color', 'never')

  if (outputMode === 'files_only') {
    cmdParts.push('-l')
  } else if (outputMode === 'count') {
    cmdParts.push('-c')
  } else {
    cmdParts.push('--line-number', '--no-heading', '--with-filename')
    if (context > 0) {
      cmdParts.push('-C', String(context))
    }
  }

  if (fileGlob) {
    cmdParts.push('--glob', escapeShellArg(fileGlob))
  }

  const fetchLimit = limit + offset + (context > 0 ? 200 : 0)
  cmdParts.push(escapeShellArg(pattern), escapeShellArg(searchPath), '|', 'head', '-n', String(fetchLimit))

  const command = cmdParts.join(' ')

  try {
    const stdout = await runShellCommand(command, {
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 5,
    })

    if (!stdout.trim()) {
      return { output: `未找到匹配的内容: ${pattern}`, totalCount: 0 }
    }

    const lines = stdout.trim().split('\n')
    const realLines = lines.filter(l => l !== '--')
    const totalCount = realLines.length

    const page = realLines.slice(offset, offset + limit)
    const truncated = realLines.length >= fetchLimit

    let output: string
    if (outputMode === 'files_only') {
      output = `找到 ${page.length} 个匹配的文件:\n${page.join('\n')}`
    } else if (outputMode === 'count') {
      output = `找到 ${page.length} 个文件包含匹配内容:\n${page.join('\n')}`
    } else {
      output = `找到 ${page.length} 行匹配:\n${page.join('\n')}`
    }

    if (truncated) {
      output += `\n\n[Hint: 结果已截断。使用 offset=${offset + limit} 查看更多，或用更精确的正则/文件过滤缩小范围。]`
    }

    return { output, totalCount }
  } catch (error: any) {
    if (error.code === 1) {
      return { output: `未找到匹配的内容: ${pattern}`, totalCount: 0 }
    }
    throw error
  }
}

/**
 * 使用 grep 搜索文件内容（rg 不可用时的降级方案）
 */
async function searchContentGrep(
  pattern: string, searchPath: string, fileGlob: string | undefined,
  limit: number, offset: number, outputMode: string, context: number,
): Promise<{ output: string; totalCount: number }> {
  let command = 'grep -r'

  if (outputMode === 'files_only') {
    command += ' -l'
  } else if (outputMode === 'count') {
    command += ' -c'
  } else {
    command += ' -n'
    if (context > 0) {
      command += ` -C ${context}`
    }
  }

  if (fileGlob) {
    command += ` --include=${escapeShellArg(fileGlob)}`
  }

  command += ' --color=never'
  const fetchLimit = limit + offset
  command += ` ${escapeShellArg(pattern)} ${escapeShellArg(searchPath)} | head -n ${fetchLimit}`

  try {
    const stdout = await runShellCommand(command, {
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 5,
    })

    if (!stdout.trim()) {
      return { output: `未找到匹配的内容: ${pattern}`, totalCount: 0 }
    }

    const lines = stdout.trim().split('\n').filter(Boolean)
    const page = lines.slice(offset, offset + limit)
    const truncated = lines.length >= fetchLimit

    let output: string
    if (outputMode === 'files_only') {
      output = `找到 ${page.length} 个匹配的文件:\n${page.join('\n')}`
    } else if (outputMode === 'count') {
      output = `找到 ${page.length} 个文件包含匹配内容:\n${page.join('\n')}`
    } else {
      output = `找到 ${page.length} 行匹配:\n${page.join('\n')}`
    }

    if (truncated) {
      output += `\n\n[Hint: 结果已截断。使用 offset=${offset + limit} 查看更多。]`
    }

    return { output, totalCount: lines.length }
  } catch (error: any) {
    if (error.code === 1) {
      return { output: `未找到匹配的内容: ${pattern}`, totalCount: 0 }
    }
    throw error
  }
}
