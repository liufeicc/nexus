/**
 * 测试脚本：直接测试工具 handler（不经过 LLM）
 * 运行方式：node scripts/test-tools-direct.mjs
 */

import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'

function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
      if (err && err.code !== 1) reject(err); else resolve({ stdout, stderr })
    })
  })
}

function escapeShell(arg) {
  return `'${String(arg).replace(/'/g, "'\"'\"'")}'`
}

// ==================== searchFilesTool handler ====================

async function searchFiles(args) {
  const pattern = String(args.pattern || '').trim()
  const searchPath = args.path
    ? (String(args.path).startsWith('~')
        ? path.join(process.env.HOME || '/tmp', String(args.path).slice(1))
        : String(args.path))
    : process.env.HOME || '/tmp'
  const target = args.target || 'content'
  const fileGlob = args.file_glob ? String(args.file_glob) : undefined
  const limit = typeof args.limit === 'number' ? Math.max(1, Math.floor(args.limit)) : 50
  const offset = typeof args.offset === 'number' ? Math.max(0, Math.floor(args.offset)) : 0
  const outputMode = args.output_mode || 'content'
  const context = typeof args.context === 'number' ? Math.max(0, Math.floor(args.context)) : 0

  if (!pattern) return { success: false, output: '搜索关键词不能为空' }
  if (!fs.existsSync(searchPath)) return { success: false, output: `搜索路径不存在: ${searchPath}` }

  if (target === 'files') {
    const searchPattern = (!pattern.startsWith('**/') && !pattern.includes('/')) ? `*${pattern}` : pattern
    try {
      let { stdout } = await execAsync(
        `rg --files -g ${escapeShell(searchPattern)} ${escapeShell(searchPath)} 2>/dev/null | head -n ${limit + offset}`,
        { timeout: 30000, maxBuffer: 1024 * 1024 * 5 }
      )
      let allFiles = stdout.trim().split('\n').filter(Boolean)
      let page = allFiles.slice(offset, offset + limit)
      if (page.length === 0) {
        const gp = (fileGlob && fileGlob !== '*') ? fileGlob : searchPattern
        const { stdout: fout } = await execAsync(
          `find ${escapeShell(searchPath)} -not -path '*/.*' -type f -name ${escapeShell(gp)} -maxdepth 5 2>/dev/null | head -100`,
          { timeout: 15000 }
        )
        page = fout.trim().split('\n').filter(Boolean)
        allFiles = page
      }
      if (!page.length) return { success: true, output: `未找到匹配的文件: ${pattern}`, data: { matches: 0 } }
      let out = `找到 ${page.length} 个匹配的文件:\n${page.join('\n')}`
      if (allFiles.length >= limit + offset) out += `\n\n[Hint: 结果已截断。使用 offset=${offset + limit} 查看更多。]`
      return { success: true, output: out, data: { files: page, total_count: allFiles.length } }
    } catch (e) {
      return { success: true, output: `未找到匹配的文件: ${pattern}`, data: { matches: 0 } }
    }
  }

  // content search
  const globPart = fileGlob ? ` --glob ${escapeShell(fileGlob)}` : ''
  const ctxPart = context > 0 ? ` -C ${context}` : ''
  let cmd
  if (outputMode === 'files_only') {
    cmd = `rg -l --color never${globPart}${ctxPart} ${escapeShell(pattern)} ${escapeShell(searchPath)} | head -n ${limit + offset}`
  } else if (outputMode === 'count') {
    cmd = `rg -c --color never${globPart} ${escapeShell(pattern)} ${escapeShell(searchPath)} | head -n ${limit + offset}`
  } else {
    cmd = `rg --line-number --no-heading --with-filename --color never${globPart}${ctxPart} ${escapeShell(pattern)} ${escapeShell(searchPath)} | head -n ${limit + offset}`
  }
  try {
    const { stdout } = await execAsync(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 * 5 })
    if (!stdout.trim()) return { success: true, output: `未找到匹配的内容: ${pattern}`, data: { matches: 0 } }
    const lines = stdout.trim().split('\n').filter(l => l !== '--')
    const page = lines.slice(offset, offset + limit)
    const truncated = lines.length >= limit + offset
    let out
    if (outputMode === 'files_only') out = `找到 ${page.length} 个匹配的文件:\n${page.join('\n')}`
    else if (outputMode === 'count') out = `找到 ${page.length} 个文件包含匹配内容:\n${page.join('\n')}`
    else out = `找到 ${page.length} 行匹配:\n${page.join('\n')}`
    if (truncated) out += `\n\n[Hint: 结果已截断。使用 offset=${offset + limit} 查看更多。]`
    return { success: true, output: out, data: { matches: lines.length, pattern, path: searchPath } }
  } catch (e) {
    if (e.code === 1) return { success: true, output: `未找到匹配的内容: ${pattern}`, data: { matches: 0 } }
    return { success: false, output: `搜索失败: ${e.message}` }
  }
}

// ==================== readFileTool handler ====================

async function readFile(args) {
  let fp = String(args.path || args.file_path || '').trim()
  if (fp.startsWith('~')) fp = path.join(process.env.HOME || '/tmp', fp.slice(1))
  if (!fs.existsSync(fp)) return { success: false, output: '文件不存在: ' + fp }
  const st = fs.statSync(fp)
  if (st.isDirectory()) {
    const entries = fs.readdirSync(fp, { withFileTypes: true }).map(x => x.isDirectory() ? `[${x.name}]` : `  ${x.name}`)
    return { success: true, output: '目录内容:\n' + entries.join('\n') }
  }
  const offset = typeof args.offset === 'number' ? Math.max(1, Math.floor(args.offset)) : 1
  const limit = typeof args.limit === 'number' ? Math.min(Math.max(1, Math.floor(args.limit)), 2000) : 500
  const endLine = offset + limit - 1
  try {
    const totalLines = parseInt((await new Promise((resolve, reject) => {
      exec(`wc -l < "${fp}"`, { timeout: 5000 }, (e, o) => e ? reject(e) : resolve(o.trim()))
    })) || 0)
    const { stdout } = await new Promise((resolve, reject) => {
      exec(`sed -n '${offset},${endLine}p' "${fp}"`, { timeout: 10000, maxBuffer: 1024 * 1024 * 5 }, (e, o, s) => {
        if (e && e.code !== 1) reject(e); else resolve({ stdout: o, stderr: s })
      })
    })
    const lines = stdout.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    const numbered = lines.map((l, i) => `${String(offset + i).padStart(6)}  ${l}`).join('\n')
    let out = numbered
    if (totalLines > endLine) out += `\n\n[文件共 ${totalLines} 行，已读取 ${offset}-${endLine} 行。使用 offset=${endLine + 1} 继续。]`
    return { success: true, output: out.length > 10000 ? out.slice(0, 10000) + '\n...[截断]...' : out }
  } catch (e) {
    const c = fs.readFileSync(fp, 'utf-8')
    return { success: true, output: c.length > 10000 ? c.slice(0, 10000) + '\n...[截断]...' : c }
  }
}

// ==================== 主测试 ====================

async function main() {
  // --- read_file 测试 ---

  console.log('=== 测试 1: 读取小文件（完整内容）===')
  const r1 = await readFile({ path: '/home/liufei/data/claude-workspace/Nexus/package.json' })
  console.log(r1.output)
  console.log()

  console.log('=== 测试 2: 读取大文件（分页，前 10 行）===')
  const r2 = await readFile({ path: '/home/liufei/data/claude-workspace/Nexus/scripts/test-tools-direct.mjs', offset: 1, limit: 10 })
  console.log(r2.output)
  console.log()

  console.log('=== 测试 3: 继续读取（offset=11）===')
  const r3 = await readFile({ path: '/home/liufei/data/claude-workspace/Nexus/scripts/test-tools-direct.mjs', offset: 11, limit: 5 })
  console.log(r3.output)
  console.log()

  console.log('=== 测试 4: 读取目录 ===')
  const r4 = await readFile({ path: '/home/liufei/data/claude-workspace/Nexus/src/main/agent' })
  console.log(r4.output)
  console.log()

  console.log('=== 测试 5: 文件不存在 ===')
  const r5 = await readFile({ path: '/tmp/nonexistent_file_xyz.txt' })
  console.log(r5.output)
  console.log()

  // --- search_files 测试 ---

  console.log('=== 测试 6: target=files，搜索 Nexus/src 下的 *.ts 文件 ===')
  const sr1 = await searchFiles({ target: 'files', pattern: '*.ts', path: '/home/liufei/data/claude-workspace/Nexus/src', limit: 10 })
  console.log(sr1.output.slice(0, 500))
  console.log('  data:', JSON.stringify(sr1.data))
  console.log()

  console.log('=== 测试 2: target=content，搜索 "ToolDefinition" ===')
  const sr2 = await searchFiles({ target: 'content', pattern: 'ToolDefinition', path: '/home/liufei/data/claude-workspace/Nexus/src', file_glob: '*.ts' })
  console.log(sr2.output.slice(0, 800))
  console.log('  data:', JSON.stringify(sr2.data))
  console.log()

  console.log('=== 测试 3: output_mode=files_only ===')
  const sr3 = await searchFiles({ pattern: 'ToolDefinition', path: '/home/liufei/data/claude-workspace/Nexus/src', file_glob: '*.ts', output_mode: 'files_only' })
  console.log(sr3.output)
  console.log()

  console.log('=== 测试 4: output_mode=count ===')
  const sr4 = await searchFiles({ pattern: 'ToolDefinition', path: '/home/liufei/data/claude-workspace/Nexus/src', file_glob: '*.ts', output_mode: 'count' })
  console.log(sr4.output)
  console.log()

  console.log('=== 测试 5: content search 带 context=2 ===')
  const sr5 = await searchFiles({ pattern: 'ToolDefinition', path: '/home/liufei/data/claude-workspace/Nexus/src', file_glob: '*.ts', context: 2, limit: 5 })
  console.log(sr5.output.slice(0, 800))
  console.log()

  console.log('\n=== 所有测试完成 ===')
}

main().catch(err => {
  console.error('失败:', err.message)
  process.exit(1)
})
