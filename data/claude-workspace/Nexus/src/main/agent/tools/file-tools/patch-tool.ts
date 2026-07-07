/**
 * 文件工具：patch
 *
 * 针对性 find-and-replace 编辑文件，支持模糊匹配和 V4A patch 格式。
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { ToolDefinition, ToolResult } from '../../../../core/types/agent'
import { expandTilde, isPathSafe } from './path-safety'
import { updateReadTimestamp } from './read-file'
import { runShellCommand } from './shell-exec'
import { redactSensitiveText } from '../../utils/redact'
import { fuzzyFindAndReplace } from '../../utils/fuzzy-match'
import { parseV4aPatch, applyV4aOperations, checkLint } from '../../utils/patch-parser'
import { logger } from '../../../utils/logger'

// ==================== 工具 4: patch ====================

export const patchTool: ToolDefinition = {
  name: 'patch',
  description: `对文件进行 targeted find-and-replace 编辑。不要用 sed/awk 等终端命令编辑文件，应该用这个工具。

替换模式（默认）：查找文件中唯一的字符串并替换。使用 9 策略模糊匹配链（exact → line_trimmed → whitespace_normalized → indentation_flexible → escape_normalized → trimmed_boundary → unicode_normalized → block_anchor → context_aware），容忍 LLM 生成的空格、缩进、转义等差异。
返回 unified diff 显示变更内容。编辑后自动执行语法检查（lint）。

Patch 模式（V4A）：应用多文件批量变更。支持 Add/Update/Delete/Move 四种操作。用 patch 参数提供 V4A 格式的 patch 内容。`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要编辑的文件路径（replace 模式必填）',
      },
      old_string: {
        type: 'string',
        description: '要查找的文本（replace 模式必填）。必须在文件中唯一出现，除非 replace_all=true。支持模糊匹配，无需提供精确的空格和缩进。',
      },
      new_string: {
        type: 'string',
        description: '替换文本。可为空字符串以删除匹配的内容。',
      },
      replace_all: {
        type: 'boolean',
        description: '替换所有匹配项，默认 false（要求唯一匹配）',
      },
      patch: {
        type: 'string',
        description: 'V4A 格式的 patch 内容（patch 模式必填）。支持 *** Update File / *** Add File / *** Delete File / *** Move File 四种操作。',
      },
      mode: {
        type: 'string',
        description: "操作模式：'replace' 替换模式（默认），'patch' V4A patch 模式",
        enum: ['replace', 'patch'],
      },
    },
    required: [],
  },
  handler: async (args): Promise<ToolResult> => {
    const mode = (args.mode as string) || 'replace'

    if (mode === 'patch') {
      return handleV4aPatch(args)
    }

    return handleReplacePatch(args)
  },
}

/**
 * 替换模式：模糊查找并替换单个文件
 */
async function handleReplacePatch(args: any): Promise<ToolResult> {
  const filePath = expandTilde(String(args.path ?? '').trim())
  const oldString = String(args.old_string ?? '')
  const newString = String(args.new_string ?? '')
  const replaceAll = Boolean(args.replace_all)

  if (!filePath) {
    return { success: false, output: '文件路径不能为空' }
  }
  if (!oldString) {
    return { success: false, output: 'old_string 不能为空' }
  }

  // 路径安全检查
  const safety = isPathSafe(filePath)
  if (!safety.safe) {
    return { success: false, output: safety.reason || '路径不安全' }
  }

  if (!fs.existsSync(filePath)) {
    return { success: false, output: `文件不存在: ${filePath}` }
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')

    // 使用 9 策略模糊匹配链
    const result = fuzzyFindAndReplace(content, oldString, newString, replaceAll)

    if (result.matchCount === 0) {
      return {
        success: false,
        output: `${result.error || '未找到匹配的文本'}\n\n请使用 read_file 查看文件当前内容，确认要查找的文本。`,
      }
    }

    // 写回文件
    fs.writeFileSync(filePath, result.newContent, 'utf-8')

    // 刷新存储的 mtime
    updateReadTimestamp(filePath)

    // 生成 unified diff
    const diff = await generateUnifiedDiffFull(filePath, content, result.newContent, filePath, filePath)

    // 脱敏 diff
    const redactedDiff = redactSensitiveText(diff)

    // 运行 lint 检查
    let lintInfo = ''
    const lintResult = await checkLint(filePath)
    if (!lintResult.skipped) {
      if (lintResult.success) {
        lintInfo = `\n\nLint: 通过`
      } else {
        lintInfo = `\n\nLint 警告:\n${lintResult.output.slice(0, 500)}`
      }
    }

    const linesChanged = (newString.match(/\n/g) || []).length - (oldString.match(/\n/g) || []).length
    const sign = linesChanged >= 0 ? '+' : ''
    logger.info(`[Patch] 编辑: ${filePath} (${sign}${linesChanged} 行, 策略: ${result.strategy})`)

    return {
      success: true,
      output: `文件已编辑: ${filePath}（匹配策略: ${result.strategy}）\n\n${redactedDiff}${lintInfo}`,
      data: { path: filePath, replaced: result.matchCount, strategy: result.strategy },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, output: `编辑文件失败: ${message}` }
  }
}

/**
 * V4A Patch 模式：应用多文件批量变更
 */
async function handleV4aPatch(args: any): Promise<ToolResult> {
  const patchContent = String(args.patch ?? '')

  if (!patchContent) {
    return { success: false, output: 'patch 内容不能为空' }
  }

  try {
    // 解析 V4A patch
    const { operations, error: parseError } = parseV4aPatch(patchContent)

    if (parseError) {
      return { success: false, output: `V4A Patch 解析错误: ${parseError}` }
    }

    if (operations.length === 0) {
      return { success: false, output: 'Patch 内容为空，未找到任何操作' }
    }

    // 应用操作
    const patchResult = await applyV4aOperations(operations)

    // 脱敏 diff
    const redactedDiff = redactSensitiveText(patchResult.diff)

    if (patchResult.success) {
      let summary = `V4A Patch 应用成功！\n`
      if (patchResult.filesModified.length) summary += `\n修改的文件:\n${patchResult.filesModified.map(f => `  - ${f}`).join('\n')}`
      if (patchResult.filesCreated.length) summary += `\n创建的文件:\n${patchResult.filesCreated.map(f => `  - ${f}`).join('\n')}`
      if (patchResult.filesDeleted.length) summary += `\n删除的文件:\n${patchResult.filesDeleted.map(f => `  - ${f}`).join('\n')}`
      summary += `\n\n变更详情:\n${redactedDiff}`

      // 对修改的文件运行 lint
      const allFiles = [...patchResult.filesModified, ...patchResult.filesCreated]
      const lintResults: string[] = []
      for (const f of allFiles) {
        const lr = await checkLint(f)
        if (!lr.skipped) {
          lintResults.push(`${f}: ${lr.success ? '通过' : '警告 — ' + lr.output.slice(0, 200)}`)
        }
      }
      if (lintResults.length) summary += `\n\nLint 检查:\n${lintResults.join('\n')}`

      logger.info(`[Patch] V4A 应用成功 (${patchResult.filesModified.length} 修改, ${patchResult.filesCreated.length} 创建, ${patchResult.filesDeleted.length} 删除)`)

      return { success: true, output: summary, data: patchResult }
    } else {
      return {
        success: false,
        output: `V4A Patch ${patchResult.error}\n\n部分变更可能已应用，请运行 git diff 检查状态。`,
        data: patchResult,
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, output: `应用 V4A Patch 失败: ${message}` }
  }
}

/**
 * 生成 unified diff（使用 diff -u 命令）
 */
async function generateUnifiedDiffFull(
  filePath: string, oldContent: string, newContent: string,
  fromFile: string, toFile: string,
): Promise<string> {
  try {
    const tmpDir = os.tmpdir()
    const uniqueId = crypto.randomUUID()
    const tmpOld = path.join(tmpDir, `.nexus_diff_old_${uniqueId}`)
    const tmpNew = path.join(tmpDir, `.nexus_diff_new_${uniqueId}`)
    fs.writeFileSync(tmpOld, oldContent, 'utf-8')
    fs.writeFileSync(tmpNew, newContent, 'utf-8')
    const stdout = await runShellCommand(
      `diff -u --label "a/${fromFile}" --label "b/${toFile}" "${tmpOld}" "${tmpNew}" || true`,
      { timeout: 5000 }
    )
    fs.unlinkSync(tmpOld)
    fs.unlinkSync(tmpNew)
    return stdout
  } catch {
    // 降级到手工生成
    const oldLines = oldContent.split(/\r?\n/)
    const newLines = newContent.split(/\r?\n/)
    const diff = [`--- a/${fromFile}`, `+++ b/${toFile}`]
    diff.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`)
    for (const line of oldLines) diff.push(`-${line}`)
    for (const line of newLines) diff.push(`+${line}`)
    return diff.join('\n')
  }
}
