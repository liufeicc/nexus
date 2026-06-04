/**
 * V4A Patch 格式解析器
 *
 * 解析 V4A 格式的 patch 文本，支持 Update/Add/Delete/Move 四种操作。
 *
 * V4A 格式：
 *   *** Begin Patch
 *   *** Update File: path/to/file.py
 *   @@ context hint @@
 *    context line
 *   -removed line
 *   +added line
 *   *** Add File: path/to/new.py
 *   +new file content
 *   *** Delete File: path/to/old.py
 *   *** Move File: old.py -> new.py
 *   *** End Patch
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { exec } from 'child_process'
import { promisify } from 'util'
import { logger } from '../../utils/logger'
import { fuzzyFindAndReplace } from './fuzzy-match'
import { isPathSafe, expandTilde } from '../tools/file-tools'

const execAsync = promisify(exec)

// ==================== 数据类型 ====================

const OperationType = {
  Add: 'add',
  Update: 'update',
  Delete: 'delete',
  Move: 'move',
} as const

type OperationType = (typeof OperationType)[keyof typeof OperationType]

interface HunkLine {
  prefix: ' ' | '-' | '+'
  content: string
}

interface Hunk {
  contextHint?: string
  lines: HunkLine[]
}

interface PatchOperation {
  op: OperationType
  filePath: string
  newPath?: string
  hunks: Hunk[]
}

interface PatchResult {
  success: boolean
  diff: string
  filesModified: string[]
  filesCreated: string[]
  filesDeleted: string[]
  lint?: Record<string, unknown>
  error?: string
}

// ==================== 解析器 ====================

/**
 * 解析 V4A 格式的 patch 内容
 */
export function parseV4aPatch(patchContent: string): { operations: PatchOperation[]; error?: string } {
  const lines = patchContent.split('\n')
  const operations: PatchOperation[] = []

  // 找到 patch 边界
  let startIdx: number | null = null
  let endIdx = lines.length

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('*** Begin Patch') || lines[i].includes('***Begin Patch')) {
      startIdx = i
    } else if (lines[i].includes('*** End Patch') || lines[i].includes('***End Patch')) {
      endIdx = i
      break
    }
  }

  if (startIdx === null) startIdx = -1 // 无 Begin 标记也从开头解析

  let currentOp: PatchOperation | null = null
  let currentHunk: Hunk | null = null

  for (let i = startIdx + 1; i < endIdx; i++) {
    const line = lines[i]

    // 检查文件操作标记
    const updateMatch = line.match(/\*\*\*\s*Update\s+File:\s*(.+)/)
    const addMatch = line.match(/\*\*\*\s*Add\s+File:\s*(.+)/)
    const deleteMatch = line.match(/\*\*\*\s*Delete\s+File:\s*(.+)/)
    const moveMatch = line.match(/\*\*\*\s*Move\s+File:\s*(.+?)\s*->\s*(.+)/)

    function saveCurrentOp() {
      if (currentOp) {
        if (currentHunk && currentHunk.lines.length) currentOp.hunks.push(currentHunk)
        operations.push(currentOp)
      }
    }

    if (updateMatch) {
      saveCurrentOp()
      currentOp = { op: OperationType.Update, filePath: updateMatch[1].trim(), hunks: [] }
      currentHunk = null
    } else if (addMatch) {
      saveCurrentOp()
      currentOp = { op: OperationType.Add, filePath: addMatch[1].trim(), hunks: [] }
      currentHunk = { lines: [] }
    } else if (deleteMatch) {
      saveCurrentOp()
      currentOp = { op: OperationType.Delete, filePath: deleteMatch[1].trim(), hunks: [] }
      operations.push(currentOp)
      currentOp = null
      currentHunk = null
    } else if (moveMatch) {
      saveCurrentOp()
      currentOp = { op: OperationType.Move, filePath: moveMatch[1].trim(), newPath: moveMatch[2].trim(), hunks: [] }
      operations.push(currentOp)
      currentOp = null
      currentHunk = null
    } else if (line.startsWith('@@')) {
      // 上下文提示 / hunk 标记
      if (currentOp) {
        if (currentHunk && currentHunk.lines.length) currentOp.hunks.push(currentHunk)
        const hintMatch = line.match(/@@\s*(.+?)\s*@@/)
        currentHunk = { contextHint: hintMatch ? hintMatch[1] : undefined, lines: [] }
      }
    } else if (currentOp && line) {
      if (!currentHunk) currentHunk = { lines: [] }
      if (line.startsWith('+')) currentHunk.lines.push({ prefix: '+', content: line.slice(1) })
      else if (line.startsWith('-')) currentHunk.lines.push({ prefix: '-', content: line.slice(1) })
      else if (line.startsWith(' ')) currentHunk.lines.push({ prefix: ' ', content: line.slice(1) })
      else if (line.startsWith('\\')) { /* 忽略 "No newline" 标记 */ }
      else currentHunk.lines.push({ prefix: ' ', content: line }) // 无前缀视为上下文
    }
  }

  // 保存最后一个操作
  if (currentOp) {
    if (currentHunk && currentHunk.lines.length) currentOp.hunks.push(currentHunk)
    operations.push(currentOp)
  }

  // 验证
  if (!operations.length) return { operations: [], error: undefined } // 空 patch 不是错误

  const errors: string[] = []
  for (const op of operations) {
    if (!op.filePath) errors.push('操作缺少文件路径')
    if (op.op === OperationType.Update && !op.hunks.length) errors.push(`UPDATE ${op.filePath}: 未找到 hunk`)
    if (op.op === OperationType.Move && !op.newPath) errors.push(`MOVE ${op.filePath}: 缺少目标路径`)
  }
  if (errors.length) return { operations: [], error: '解析错误: ' + errors.join('; ') }

  return { operations, error: undefined }
}

// ==================== 应用器 ====================

/**
 * 应用 V4A patch 操作
 */
export async function applyV4aOperations(operations: PatchOperation[]): Promise<PatchResult> {
  // 验证阶段
  const validationErrors: string[] = []
  for (const op of operations) {
    const resolved = expandTildeInternal(op.filePath)
    if (op.op === OperationType.Update || op.op === OperationType.Add || op.op === OperationType.Delete) {
      const safety = isPathSafe(resolved)
      if (!safety.safe) { validationErrors.push(`${op.filePath}: ${safety.reason}`); continue }
    }
    if (op.op === OperationType.Update) {
      if (!fs.existsSync(resolved)) { validationErrors.push(`${op.filePath}: 文件不存在`); continue }
      // 模拟 hunk 应用验证
      let simulated = fs.readFileSync(resolved, 'utf-8')
      for (const hunk of op.hunks) {
        const searchLines = hunk.lines.filter(l => l.prefix === ' ' || l.prefix === '-').map(l => l.content)
        if (!searchLines.length) {
          // 纯添加 hunk：验证 contextHint 唯一性
          if (hunk.contextHint) {
            const occurrences = countOccurrences(simulated, hunk.contextHint)
            if (occurrences === 0) validationErrors.push(`${op.filePath}: 添加 hunk 的上下文提示 '${hunk.contextHint}' 未找到`)
            else if (occurrences > 1) validationErrors.push(`${op.filePath}: 添加 hunk 的上下文提示 '${hunk.contextHint}' 不唯一 (${occurrences} 处)`)
          }
          continue
        }
        const searchPattern = searchLines.join('\n')
        const replaceLines = hunk.lines.filter(l => l.prefix === ' ' || l.prefix === '+').map(l => l.content)
        const replacement = replaceLines.join('\n')
        const result = fuzzyFindAndReplace(simulated, searchPattern, replacement, false)
        if (result.matchCount === 0) {
          const label = hunk.contextHint ? `'${hunk.contextHint}'` : '(无提示)'
          validationErrors.push(`${op.filePath}: hunk ${label} 未找到 — ${result.error || ''}`)
        } else {
          simulated = result.newContent
        }
      }
    } else if (op.op === OperationType.Delete) {
      if (!fs.existsSync(resolved)) validationErrors.push(`${op.filePath}: 文件不存在，无法删除`)
    } else if (op.op === OperationType.Move) {
      if (!op.newPath) { validationErrors.push(`${op.filePath}: MOVE 缺少目标路径`); continue }
      const srcResolved = expandTildeInternal(op.filePath)
      const dstResolved = expandTildeInternal(op.newPath)
      if (!fs.existsSync(srcResolved)) validationErrors.push(`${op.filePath}: 源文件不存在`)
      if (fs.existsSync(dstResolved)) validationErrors.push(`${op.newPath}: 目标文件已存在`)
    }
  }
  if (validationErrors.length) {
    return {
      success: false, diff: '', filesModified: [], filesCreated: [], filesDeleted: [],
      error: 'Patch 验证失败（未修改任何文件）:\n' + validationErrors.map(e => `  - ${e}`).join('\n'),
    }
  }

  // 应用阶段
  const filesModified: string[] = []
  const filesCreated: string[] = []
  const filesDeleted: string[] = []
  const allDiffs: string[] = []
  const errors: string[] = []

  for (const op of operations) {
    try {
      if (op.op === OperationType.Add) {
        const r = await applyAdd(op)
        if (r.ok) { filesCreated.push(op.filePath); allDiffs.push(r.diff) }
        else errors.push(`添加 ${op.filePath} 失败: ${r.error}`)
      } else if (op.op === OperationType.Delete) {
        const r = await applyDelete(op)
        if (r.ok) { filesDeleted.push(op.filePath); allDiffs.push(r.diff) }
        else errors.push(`删除 ${op.filePath} 失败: ${r.error}`)
      } else if (op.op === OperationType.Move) {
        const r = await applyMove(op)
        if (r.ok) { filesModified.push(`${op.filePath} -> ${op.newPath}`); allDiffs.push(r.diff) }
        else errors.push(`移动 ${op.filePath} 失败: ${r.error}`)
      } else if (op.op === OperationType.Update) {
        const r = await applyUpdate(op)
        if (r.ok) { filesModified.push(op.filePath); allDiffs.push(r.diff) }
        else errors.push(`更新 ${op.filePath} 失败: ${r.error}`)
      }
    } catch (e: any) {
      errors.push(`处理 ${op.filePath} 时出错: ${e.message}`)
    }
  }

  const combinedDiff = allDiffs.join('\n')

  if (errors.length) {
    return {
      success: false, diff: combinedDiff, filesModified, filesCreated, filesDeleted,
      error: '应用失败（状态可能不一致，请运行 git diff 检查）:\n' + errors.map(e => `  - ${e}`).join('\n'),
    }
  }

  return { success: true, diff: combinedDiff, filesModified, filesCreated, filesDeleted }
}

// ==================== 内部辅助操作 ====================

async function applyAdd(op: PatchOperation): Promise<{ ok: boolean; diff: string; error?: string }> {
  const contentLines: string[] = []
  for (const hunk of op.hunks) {
    for (const line of hunk.lines) {
      if (line.prefix === '+') contentLines.push(line.content)
    }
  }
  const content = contentLines.join('\n')
  const resolved = expandTildeInternal(op.filePath)
  try {
    const parent = path.dirname(resolved)
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })
    fs.writeFileSync(resolved, content, 'utf-8')
    const diff = `--- /dev/null\n+++ b/${op.filePath}\n` + contentLines.map(l => `+${l}`).join('\n')
    return { ok: true, diff }
  } catch (e: any) {
    return { ok: false, diff: '', error: e.message }
  }
}

async function applyDelete(op: PatchOperation): Promise<{ ok: boolean; diff: string; error?: string }> {
  const resolved = expandTildeInternal(op.filePath)
  if (!fs.existsSync(resolved)) return { ok: false, diff: '', error: '文件不存在' }
  try {
    const oldContent = fs.readFileSync(resolved, 'utf-8')
    fs.unlinkSync(resolved)
    const diff = await generateUnifiedDiff(resolved, oldContent, '', op.filePath, op.filePath)
    return { ok: true, diff: diff || `# Deleted: ${op.filePath}` }
  } catch (e: any) {
    return { ok: false, diff: '', error: e.message }
  }
}

async function applyMove(op: PatchOperation): Promise<{ ok: boolean; diff: string; error?: string }> {
  const src = expandTildeInternal(op.filePath)
  const dst = expandTildeInternal(op.newPath!)
  const safety = isPathSafe(dst)
  if (!safety.safe) return { ok: false, diff: '', error: safety.reason }
  try {
    const parent = path.dirname(dst)
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })
    fs.renameSync(src, dst)
    return { ok: true, diff: `# Moved: ${op.filePath} -> ${op.newPath}` }
  } catch (e: any) {
    return { ok: false, diff: '', error: e.message }
  }
}

async function applyUpdate(op: PatchOperation): Promise<{ ok: boolean; diff: string; error?: string }> {
  const resolved = expandTildeInternal(op.filePath)
  if (!fs.existsSync(resolved)) return { ok: false, diff: '', error: '文件不存在' }
  const oldContent = fs.readFileSync(resolved, 'utf-8')
  let newContent = oldContent

  for (const hunk of op.hunks) {
    const searchLines = hunk.lines.filter(l => l.prefix === ' ' || l.prefix === '-').map(l => l.content)
    const replaceLines = hunk.lines.filter(l => l.prefix === ' ' || l.prefix === '+').map(l => l.content)
    const searchPattern = searchLines.join('\n')
    const replacement = replaceLines.join('\n')

    if (searchPattern) {
      const result = fuzzyFindAndReplace(newContent, searchPattern, replacement, false)
      if (result.matchCount === 0) {
        // 尝试用 contextHint 定位
        if (hunk.contextHint) {
          const hintPos = newContent.indexOf(hunk.contextHint)
          if (hintPos !== -1) {
            const windowStart = Math.max(0, hintPos - 500)
            const windowEnd = Math.min(newContent.length, hintPos + 2000)
            const window = newContent.slice(windowStart, windowEnd)
            const wResult = fuzzyFindAndReplace(window, searchPattern, replacement, false)
            if (wResult.matchCount > 0) {
              newContent = newContent.slice(0, windowStart) + wResult.newContent + newContent.slice(windowEnd)
              continue
            }
          }
        }
        return { ok: false, diff: '', error: `无法应用 hunk: ${result.error || '未找到匹配'}` }
      }
      newContent = result.newContent
    } else {
      // 纯添加 hunk
      const insertText = replacement
      if (hunk.contextHint) {
        const occurrences = countOccurrences(newContent, hunk.contextHint)
        if (occurrences === 0) {
          newContent = newContent.replace(/\n?$/, '\n') + insertText + '\n'
        } else if (occurrences > 1) {
          return { ok: false, diff: '', error: `添加 hunk: 上下文提示 '${hunk.contextHint}' 不唯一 (${occurrences} 处)` }
        } else {
          const hintPos = newContent.indexOf(hunk.contextHint)
          const eol = newContent.indexOf('\n', hintPos)
          if (eol !== -1) {
            newContent = newContent.slice(0, eol + 1) + insertText + '\n' + newContent.slice(eol + 1)
          } else {
            newContent = newContent + '\n' + insertText
          }
        }
      } else {
        newContent = newContent.replace(/\n?$/, '\n') + insertText + '\n'
      }
    }
  }

  fs.writeFileSync(resolved, newContent, 'utf-8')
  const diff = await generateUnifiedDiff(resolved, oldContent, newContent, op.filePath, op.filePath)
  return { ok: true, diff }
}

function expandTildeInternal(p: string): string {
  if (p.startsWith('~')) {
    const home = process.env.HOME || '/tmp'
    return path.join(home, p.slice(1))
  }
  return p
}

function countOccurrences(text: string, pattern: string): number {
  let count = 0, start = 0
  while (true) {
    const pos = text.indexOf(pattern, start)
    if (pos === -1) break
    count++
    start = pos + 1
  }
  return count
}

// ==================== Diff 生成 ====================

async function generateUnifiedDiff(
  filePath: string, oldContent: string, newContent: string,
  fromFile: string, toFile: string,
): Promise<string> {
  try {
    // 用 diff 命令生成标准 unified diff
    // 使用 crypto.randomUUID() 生成不可预测的临时文件名，防止竞态攻击
    const tmpDir = os.tmpdir()
    const uniqueId = crypto.randomUUID()
    const tmpOld = path.join(tmpDir, `.nexus_diff_old_${uniqueId}`)
    const tmpNew = path.join(tmpDir, `.nexus_diff_new_${uniqueId}`)
    fs.writeFileSync(tmpOld, oldContent, 'utf-8')
    fs.writeFileSync(tmpNew, newContent, 'utf-8')
    const { stdout } = await execAsync(`diff -u --label "a/${fromFile}" --label "b/${toFile}" "${tmpOld}" "${tmpNew}" || true`, { timeout: 5000 })
    fs.unlinkSync(tmpOld)
    fs.unlinkSync(tmpNew)
    return stdout
  } catch {
    // 降级到手工生成
    const oldLines = oldContent.split(/\r?\n/)
    const newLines = newContent.split(/\r?\n/)
    const diff = [`--- a/${fromFile}`, `+++ b/${toFile}`]
    // 简化：输出全部变更
    diff.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`)
    for (const line of oldLines) diff.push(`-${line}`)
    for (const line of newLines) diff.push(`+${line}`)
    return diff.join('\n')
  }
}

// ==================== Lint 检查 ====================

const LINTERS: Record<string, string> = {
  '.py': 'python -m py_compile {file} 2>&1',
  '.js': 'node --check {file} 2>&1',
  '.ts': 'npx tsc --noEmit {file} 2>&1',
  '.go': 'go vet {file} 2>&1',
  '.rs': 'rustfmt --check {file} 2>&1',
}

export async function checkLint(filePath: string): Promise<{ success: boolean; output: string; skipped: boolean; message: string }> {
  const ext = path.extname(filePath).toLowerCase()
  const cmdTemplate = LINTERS[ext]
  if (!cmdTemplate) return { success: true, output: '', skipped: true, message: `不支持 ${ext} 文件的 lint` }

  const baseCmd = cmdTemplate.split(' ')[0]
  try {
    await execAsync(`command -v ${baseCmd}`, { timeout: 5000 })
  } catch {
    return { success: true, output: '', skipped: true, message: `${baseCmd} 未安装` }
  }

  const cmd = cmdTemplate.replace('{file}', `'${filePath.replace(/'/g, "'\"'\"'")}'`)
  try {
    const { stdout } = await execAsync(cmd, { timeout: 30000 })
    return { success: true, output: stdout.trim(), skipped: false, message: '' }
  } catch (e: any) {
    const out = (e.stdout || '') + (e.stderr || '')
    logger.warn(`[Patch] Lint 失败: ${filePath} — ${out.slice(0, 500)}`)
    return { success: false, output: out.slice(0, 2000), skipped: false, message: '' }
  }
}
