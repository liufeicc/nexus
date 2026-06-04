/**
 * 测试脚本：测试 patch 工具的模糊匹配和 V4A 解析
 * 运行方式：node scripts/test-patch-tools.mjs
 *
 * 注意：由于 Node strip-only 模式不支持跨模块 TypeScript 导入，
 * 本测试使用内联的 JS 版本实现来验证逻辑。
 */

import fs from 'fs'
import path from 'path'

const TEST_DIR = '/tmp/tview-patch-test'

function setup() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true })
  fs.mkdirSync(TEST_DIR, { recursive: true })
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true })
}

// ==================== 内联 fuzzyFindAndReplace（简化版） ====================

function unicodeNormalize(text) {
  const map = { '\u201c': '"', '\u201d': '"', '\u2018': "'", '\u2019': "'", '\u2014': '--', '\u2013': '-', '\u2026': '...', '\u00a0': ' ' }
  let r = text
  for (const [c, repl] of Object.entries(map)) r = r.split(c).join(repl)
  return r
}

function fuzzyFindAndReplace(content, oldString, newString, replaceAll = false) {
  if (!oldString) return { newContent: content, matchCount: 0, strategy: undefined, error: 'old_string 不能为空' }
  if (oldString === newString) return { newContent: content, matchCount: 0, strategy: undefined, error: 'old_string 和 new_string 相同' }

  const strategies = [
    ['exact', (c, p) => {
      const m = []; let s = 0
      while (true) { const pos = c.indexOf(p, s); if (pos === -1) break; m.push([pos, pos + p.length]); s = pos + 1 }
      return m
    }],
    ['line_trimmed', (c, p) => {
      const pl = p.split('\n').map(l => l.trim()).join('\n')
      const cl = c.split('\n').map(l => l.trim()).join('\n')
      return strategyFindAll(cl, pl, c)
    }],
    ['whitespace_normalized', (c, p) => {
      const norm = s => s.replace(/[ \t]+/g, ' ')
      const pn = norm(p), cn = norm(c)
      return mapNormalizedPositions(c, cn, strategyFindAll(cn, pn, cn))
    }],
    ['indentation_flexible', (c, p) => {
      const pl = p.split('\n').map(l => l.replace(/^\s+/, '')).join('\n')
      const cl = c.split('\n').map(l => l.replace(/^\s+/, '')).join('\n')
      return strategyFindAll(cl, pl, c)
    }],
    ['escape_normalized', (c, p) => {
      const u = s => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
      const pu = u(p); if (pu === p) return []
      return strategyFindAll(c, pu, c)
    }],
    ['trimmed_boundary', (c, p) => {
      const pl = p.split('\n'); if (!pl.length) return []
      pl[0] = pl[0].trim(); if (pl.length > 1) pl[pl.length - 1] = pl[pl.length - 1].trim()
      const mod = pl.join('\n')
      return strategyFindAll(c, mod, c)
    }],
    ['unicode_normalized', (c, p) => {
      const nc = unicodeNormalize(c), np = unicodeNormalize(p)
      if (nc === c && np === p) return []
      return strategyFindAll(nc, np, c)
    }],
  ]

  function strategyFindAll(content, pattern, origContent) {
    const m = []; let s = 0
    while (true) { const pos = content.indexOf(pattern, s); if (pos === -1) break; m.push([pos, pos + pattern.length]); s = pos + 1 }
    return m
  }

  function mapNormalizedPositions(original, normalized, matches) {
    if (!matches.length) return []
    const origToNorm = []; let oi = 0, ni = 0
    while (oi < original.length && ni < normalized.length) {
      if (original[oi] === normalized[ni]) { origToNorm.push(ni); oi++; ni++ }
      else if (' \t'.includes(original[oi]) && normalized[ni] === ' ') { origToNorm.push(ni); oi++; if (oi < original.length && !' \t'.includes(original[oi])) ni++ }
      else if (' \t'.includes(original[oi])) { origToNorm.push(ni); oi++ }
      else { origToNorm.push(ni); oi++ }
    }
    while (oi < original.length) { origToNorm.push(normalized.length); oi++ }
    const normToStart = {}; const normToEnd = {}
    for (let op = 0; op < origToNorm.length; op++) {
      const np = origToNorm[op]; if (!(np in normToStart)) normToStart[np] = op; normToEnd[np] = op
    }
    const results = []
    for (const [ns, ne] of matches) {
      const os = ns in normToStart ? normToStart[ns] : Object.entries(normToStart).find(([k]) => Number(k) >= ns)?.[1] ?? ns
      let oe = (ne - 1) in normToEnd ? normToEnd[ne - 1] + 1 : os + (ne - ns)
      while (oe < original.length && ' \t'.includes(original[oe])) oe++
      results.push([os, Math.min(oe, original.length)])
    }
    return results
  }

  for (const [name, fn] of strategies) {
    const matches = fn(content, oldString)
    if (!matches.length) continue
    if (matches.length > 1 && !replaceAll) {
      return { newContent: content, matchCount: 0, strategy: null, error: `找到 ${matches.length} 处匹配。请提供更多上下文以确保唯一匹配，或设置 replace_all=true。` }
    }
    const sorted = [...matches].sort((a, b) => b[0] - a[0])
    let result = content
    for (const [start, end] of sorted) {
      result = result.slice(0, start) + newString + result.slice(end)
    }
    return { newContent: result, matchCount: matches.length, strategy: name, error: null }
  }

  return { newContent: content, matchCount: 0, strategy: null, error: '未找到匹配的文本' }
}

// ==================== 内联 V4A 解析器 ====================

const OperationType = { Add: 'add', Update: 'update', Delete: 'delete', Move: 'move' }

function parseV4aPatch(content) {
  const lines = content.split('\n')
  const operations = []
  let startIdx = -1, endIdx = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('*** Begin Patch')) startIdx = i
    else if (lines[i].includes('*** End Patch')) { endIdx = i; break }
  }
  let currentOp = null, currentHunk = null

  function saveCurrentOp() {
    if (currentOp) {
      if (currentHunk && currentHunk.lines.length) currentOp.hunks.push(currentHunk)
      operations.push(currentOp)
    }
  }

  for (let i = startIdx + 1; i < endIdx; i++) {
    const line = lines[i]
    const updateMatch = line.match(/\*\*\*\s*Update\s+File:\s*(.+)/)
    const addMatch = line.match(/\*\*\*\s*Add\s+File:\s*(.+)/)
    const deleteMatch = line.match(/\*\*\*\s*Delete\s+File:\s*(.+)/)
    const moveMatch = line.match(/\*\*\*\s*Move\s+File:\s*(.+?)\s*->\s*(.+)/)

    if (updateMatch) { saveCurrentOp(); currentOp = { op: OperationType.Update, filePath: updateMatch[1].trim(), hunks: [] }; currentHunk = null }
    else if (addMatch) { saveCurrentOp(); currentOp = { op: OperationType.Add, filePath: addMatch[1].trim(), hunks: [] }; currentHunk = { lines: [] } }
    else if (deleteMatch) { saveCurrentOp(); currentOp = { op: OperationType.Delete, filePath: deleteMatch[1].trim(), hunks: [] }; operations.push(currentOp); currentOp = null; currentHunk = null }
    else if (moveMatch) { saveCurrentOp(); currentOp = { op: OperationType.Move, filePath: moveMatch[1].trim(), newPath: moveMatch[2].trim(), hunks: [] }; operations.push(currentOp); currentOp = null; currentHunk = null }
    else if (line.startsWith('@@')) {
      if (currentOp) {
        if (currentHunk && currentHunk.lines.length) currentOp.hunks.push(currentHunk)
        const hintMatch = line.match(/@@\s*(.+?)\s*@@/)
        currentHunk = { contextHint: hintMatch ? hintMatch[1] : undefined, lines: [] }
      }
    } else if (currentOp) {
      if (!currentHunk) currentHunk = { lines: [] }
      if (line.startsWith('+')) currentHunk.lines.push({ prefix: '+', content: line.slice(1) })
      else if (line.startsWith('-')) currentHunk.lines.push({ prefix: '-', content: line.slice(1) })
      else if (line.startsWith(' ')) currentHunk.lines.push({ prefix: ' ', content: line.slice(1) })
      else currentHunk.lines.push({ prefix: ' ', content: line })
    }
  }
  if (currentOp) { if (currentHunk && currentHunk.lines.length) currentOp.hunks.push(currentHunk); operations.push(currentOp) }
  return { operations, error: operations.length ? undefined : '未找到任何操作' }
}

async function applyV4aOperations(operations) {
  const filesModified = [], filesCreated = [], filesDeleted = [], allDiffs = [], errors = []
  for (const op of operations) {
    try {
      if (op.op === OperationType.Add) {
        const contentLines = op.hunks.flatMap(h => h.lines.filter(l => l.prefix === '+').map(l => l.content))
        const content = contentLines.join('\n')
        const parent = path.dirname(op.filePath)
        if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })
        fs.writeFileSync(op.filePath, content, 'utf-8')
        filesCreated.push(op.filePath)
      } else if (op.op === OperationType.Update) {
        let fileContent = fs.readFileSync(op.filePath, 'utf-8')
        for (const hunk of op.hunks) {
          const searchLines = hunk.lines.filter(l => l.prefix === ' ' || l.prefix === '-').map(l => l.content)
          const replaceLines = hunk.lines.filter(l => l.prefix === ' ' || l.prefix === '+').map(l => l.content)
          const search = searchLines.join('\n')
          const replacement = replaceLines.join('\n')
          if (search) {
            const idx = fileContent.indexOf(search)
            if (idx === -1) { errors.push(`${op.filePath}: 未找到 '${search.slice(0, 50)}'`); break }
            fileContent = fileContent.slice(0, idx) + replacement + fileContent.slice(idx + search.length)
          }
        }
        fs.writeFileSync(op.filePath, fileContent, 'utf-8')
        filesModified.push(op.filePath)
      } else if (op.op === OperationType.Delete) {
        if (fs.existsSync(op.filePath)) fs.unlinkSync(op.filePath)
        filesDeleted.push(op.filePath)
      } else if (op.op === OperationType.Move) {
        const parent = path.dirname(op.newPath)
        if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })
        fs.renameSync(op.filePath, op.newPath)
        filesModified.push(`${op.filePath} -> ${op.newPath}`)
      }
    } catch (e) { errors.push(`${op.filePath}: ${e.message}`) }
  }
  return { success: errors.length === 0, diff: allDiffs.join('\n'), filesModified, filesCreated, filesDeleted, error: errors.length ? errors.join('; ') : undefined }
}

// ==================== 测试用例 ====================

function testExactMatch() {
  console.log('=== 测试 1: 精确匹配（策略 1）===')
  const content = 'def hello():\n    print("hello")\n'
  const result = fuzzyFindAndReplace(content, 'print("hello")', 'print("world")')
  console.log('  策略:', result.strategy)
  console.log('  匹配数:', result.matchCount)
  console.log('  成功:', result.matchCount === 1 && result.strategy === 'exact' ? 'PASS' : 'FAIL')
}

function testIndentationFlexible() {
  console.log('\n=== 测试 2: 缩进差异匹配（策略 4）===')
  const content = 'function foo() {\n    console.log("test")\n}\n'
  const result = fuzzyFindAndReplace(content, '  console.log("test")', '  console.log("fixed")')
  console.log('  策略:', result.strategy)
  console.log('  匹配数:', result.matchCount)
  console.log('  成功:', result.matchCount >= 1 ? 'PASS' : 'FAIL')
}

function testWhitespaceNormalized() {
  console.log('\n=== 测试 3: 空白规范化匹配（策略 3）===')
  const content = 'const x = "hello"   +   "world"\n'
  const result = fuzzyFindAndReplace(content, 'const x = "hello" + "world"', 'const x = 42')
  console.log('  策略:', result.strategy)
  console.log('  匹配数:', result.matchCount)
  console.log('  成功:', result.matchCount >= 1 ? 'PASS' : 'FAIL')
}

function testUnicodeNormalized() {
  console.log('\n=== 测试 4: Unicode 规范化匹配（策略 7）===')
  const content = 'const msg = "hello world"\n'
  const result = fuzzyFindAndReplace(content, 'const msg = \u201chello world\u201d', 'const msg = "fixed"')
  console.log('  策略:', result.strategy)
  console.log('  匹配数:', result.matchCount)
  console.log('  成功:', result.matchCount >= 1 ? 'PASS' : 'FAIL')
}

function testMultiMatchReject() {
  console.log('\n=== 测试 5: 多匹配拒绝（replaceAll=false）===')
  const content = 'log("a")\nlog("b")\nlog("a")\n'
  const result = fuzzyFindAndReplace(content, 'log("a")', 'log("x")', false)
  console.log('  错误:', result.error?.slice(0, 60))
  console.log('  成功:', result.matchCount === 0 && result.error && result.error.includes('2') ? 'PASS' : 'FAIL')
}

function testReplaceAll() {
  console.log('\n=== 测试 6: 全部替换（replaceAll=true）===')
  const content = 'log("a")\nlog("b")\nlog("a")\n'
  const result = fuzzyFindAndReplace(content, 'log("a")', 'log("x")', true)
  console.log('  匹配数:', result.matchCount)
  console.log('  成功:', result.matchCount === 2 && result.newContent.includes('log("x")') ? 'PASS' : 'FAIL')
}

async function testV4aAddFile() {
  console.log('\n=== 测试 7: V4A Add File ===')
  setup()
  const patchContent = `*** Begin Patch
*** Add File: ${TEST_DIR}/new.py
+def hello():
+    print("hello")
*** End Patch`

  const { operations, error } = parseV4aPatch(patchContent)
  console.log('  解析操作数:', operations.length, '错误:', error)
  if (operations.length > 0) {
    await applyV4aOperations(operations)
    console.log('  文件存在:', fs.existsSync(`${TEST_DIR}/new.py`))
    if (fs.existsSync(`${TEST_DIR}/new.py`)) {
      console.log('  内容:', fs.readFileSync(`${TEST_DIR}/new.py`, 'utf-8').replace(/\n/g, '\\n'))
    }
  }
  console.log('  成功:', operations.length === 1 ? 'PASS' : 'FAIL')
  cleanup()
}

async function testV4aUpdateFile() {
  console.log('\n=== 测试 8: V4A Update File ===')
  setup()
  const targetFile = `${TEST_DIR}/test.py`
  fs.writeFileSync(targetFile, 'def old_func():\n    pass\n', 'utf-8')

  const patchContent = `*** Begin Patch
*** Update File: ${targetFile}
@@ def old_func @@
-def old_func():
-    pass
+def new_func():
+    return 42
*** End Patch`

  const { operations } = parseV4aPatch(patchContent)
  console.log('  解析操作数:', operations.length)
  if (operations.length > 0) {
    const result = await applyV4aOperations(operations)
    console.log('  应用成功:', result.success)
    if (result.success) {
      console.log('  新内容:', fs.readFileSync(targetFile, 'utf-8').replace(/\n/g, '\\n'))
    }
  }
  console.log('  成功:', operations.length === 1 ? 'PASS' : 'FAIL')
  cleanup()
}

async function testV4aDeleteFile() {
  console.log('\n=== 测试 9: V4A Delete File ===')
  setup()
  const targetFile = `${TEST_DIR}/to_delete.py`
  fs.writeFileSync(targetFile, 'pass\n', 'utf-8')

  const patchContent = `*** Begin Patch\n*** Delete File: ${targetFile}\n*** End Patch`
  const { operations } = parseV4aPatch(patchContent)
  if (operations.length > 0) {
    const result = await applyV4aOperations(operations)
    console.log('  删除成功:', result.success, '文件还存在:', fs.existsSync(targetFile))
    console.log('  成功:', result.success && !fs.existsSync(targetFile) ? 'PASS' : 'FAIL')
  } else { console.log('  FAIL'); cleanup(); return }
  cleanup()
}

async function testV4aMoveFile() {
  console.log('\n=== 测试 10: V4A Move File ===')
  setup()
  const src = `${TEST_DIR}/old.py`, dst = `${TEST_DIR}/new.py`
  fs.writeFileSync(src, '# moved file\n', 'utf-8')

  const patchContent = `*** Begin Patch\n*** Move File: ${src} -> ${dst}\n*** End Patch`
  const { operations } = parseV4aPatch(patchContent)
  if (operations.length > 0) {
    const result = await applyV4aOperations(operations)
    console.log('  移动成功:', result.success, '源存在:', fs.existsSync(src), '目标存在:', fs.existsSync(dst))
    console.log('  成功:', result.success && !fs.existsSync(src) && fs.existsSync(dst) ? 'PASS' : 'FAIL')
  } else { console.log('  FAIL'); cleanup(); return }
  cleanup()
}

async function testV4aMultiFile() {
  console.log('\n=== 测试 11: V4A 多文件批量操作 ===')
  setup()
  const file1 = `${TEST_DIR}/a.py`, file2 = `${TEST_DIR}/b.py`
  fs.writeFileSync(file1, 'def a(): pass\n', 'utf-8')

  const patchContent = `*** Begin Patch
*** Update File: ${file1}
@@ def a @@
-def a(): pass
+def a(): return 1
*** Add File: ${file2}
+def b():
+    return 2
*** End Patch`

  const { operations } = parseV4aPatch(patchContent)
  console.log('  解析操作数:', operations.length)
  if (operations.length === 2) {
    const result = await applyV4aOperations(operations)
    console.log('  修改:', result.filesModified, '创建:', result.filesCreated)
    console.log('  成功:', result.success && result.filesModified.length === 1 && result.filesCreated.length === 1 ? 'PASS' : 'FAIL')
  } else { console.log('  FAIL'); cleanup(); return }
  cleanup()
}

// ==================== 主测试 ====================

console.log('\n========== Patch 工具测试 ==========\n')

testExactMatch()
testIndentationFlexible()
testWhitespaceNormalized()
testUnicodeNormalized()
testMultiMatchReject()
testReplaceAll()

await testV4aAddFile()
await testV4aUpdateFile()
await testV4aDeleteFile()
await testV4aMoveFile()
await testV4aMultiFile()

console.log('\n========== 所有测试完成 ==========\n')
