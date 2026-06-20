/**
 * 测试脚本：通过 LLM 调用 read_file 工具
 * 运行方式：node scripts/test-readfile-llm.mjs
 */

import { DatabaseSync } from 'node:sqlite'
import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'

const dbPath = '/home/liufei/.config/tview_test/db.sqlite3'
const db = new DatabaseSync(dbPath)
const row = db.prepare("SELECT value FROM configs WHERE key = 'agentConfig'").get()
if (!row?.value) { console.error('未找到配置'); process.exit(1) }
const agentConfig = JSON.parse(row.value)
console.log('模型:', agentConfig.model)

function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
      if (err && err.code !== 1) reject(err); else resolve({ stdout, stderr })
    })
  })
}

// ==================== read_file Tool ====================

const readFileTool = {
  name: 'read_file',
  description: '读取文本文件内容，带行号和分页支持。默认每次读取 500 行，最多 2000 行。使用 offset 和 limit 参数分段读取大文件。自动检测二进制文件和图片文件。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径，支持 ~ 开头' },
      offset: { type: 'number', description: '起始行号（从 1 开始），默认 1' },
      limit: { type: 'number', description: '最多读取行数，默认 500，最大 2000' },
    },
    required: ['path'],
  },
  handler: async (args) => {
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
  },
}

// ==================== search_files Tool ====================

function escapeShell(arg) {
  return `'${String(arg).replace(/'/g, "'\"'\"'")}'`
}

const searchFilesTool = {
  name: 'search_files',
  description: '搜索文件内容或按文件名查找。不要用 grep/rg/find/ls 等终端命令搜索，应该用这个工具。',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '搜索关键词或正则表达式，或 glob 模式（如 "*.py"）' },
      target: { type: 'string', description: "'content' 搜索文件内容（默认），'files' 按文件名查找", enum: ['content', 'files'] },
      path: { type: 'string', description: '搜索起始路径' },
      file_glob: { type: 'string', description: '内容搜索时按 glob 模式过滤文件' },
      limit: { type: 'number', description: '最多返回结果数，默认 50' },
      offset: { type: 'number', description: '跳过前 N 个结果（分页），默认 0' },
      output_mode: { type: 'string', description: "'content' 带行号的匹配行（默认），'files_only' 仅文件路径，'count' 每文件匹配数", enum: ['content', 'files_only', 'count'] },
      context: { type: 'number', description: '每个匹配行前后的上下文行数，默认 0' },
    },
    required: ['pattern'],
  },
  handler: async (args) => {
    const pattern = String(args.pattern || '').trim()
    const searchPath = args.path
      ? (String(args.path).startsWith('~') ? path.join(process.env.HOME || '/tmp', String(args.path).slice(1)) : String(args.path))
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
        let { stdout } = await execAsync(`rg --files -g ${escapeShell(searchPattern)} ${escapeShell(searchPath)} 2>/dev/null | head -n ${limit + offset}`)
        let allFiles = stdout.trim().split('\n').filter(Boolean)
        let page = allFiles.slice(offset, offset + limit)
        if (!page.length) return { success: true, output: `未找到匹配的文件: ${pattern}`, data: { matches: 0 } }
        return { success: true, output: `找到 ${page.length} 个匹配的文件:\n${page.join('\n')}`, data: { files: page, total_count: allFiles.length } }
      } catch (e) {
        return { success: true, output: `未找到匹配的文件: ${pattern}`, data: { matches: 0 } }
      }
    }

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
  },
}

const tools = [readFileTool, searchFilesTool]

function dispatch(name, args) {
  const t = tools.find(x => x.name === name)
  if (!t) return Promise.resolve({ success: false, output: '工具未注册: ' + name })
  return t.handler(args)
}

// ==================== LLM 日志 ====================

function formatMessages(messages, sysPrompt) {
  let out = ''
  if (sysPrompt) out += '\n  [system]: ' + sysPrompt.slice(0, 200)
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    out += '\n  [' + m.role + ']: ' + content.slice(0, 300)
  }
  return out
}

function formatResponse(res) {
  let out = ''
  for (const block of res.content || []) {
    if (block.type === 'thinking') {
      out += '\n  [thinking]: ' + (block.thinking || '').slice(0, 300)
    }
    if (block.type === 'text') {
      out += '\n  [text]: ' + block.text.slice(0, 500)
    }
  }
  return out
}

async function callLLM(messages, sysPrompt, toolsDef) {
  const body = { model: agentConfig.model, messages, max_tokens: 4096 }
  if (sysPrompt) body.system = sysPrompt
  if (toolsDef) body.tools = toolsDef.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))

  console.log('\n  ========== LLM 输入 ==========')
  console.log('  模型:', agentConfig.model)
  console.log(formatMessages(messages, sysPrompt))
  if (toolsDef) console.log('  工具:', toolsDef.map(t => t.name).join(', '))
  console.log('  ==============================\n')

  const res = await fetch(agentConfig.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': agentConfig.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('API ' + res.status + ': ' + await res.text())
  const data = await res.json()

  console.log('\n  ========== LLM 输出 ==========')
  console.log('  stop_reason:', data.stop_reason)
  console.log('  usage:', JSON.stringify(data.usage))
  console.log(formatResponse(data))
  console.log('  ==============================\n')

  return data
}

function parseToolCalls(text) {
  const calls = []
  const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/)
  const argsMatch = text.match(/"arguments"\s*:\s*(\{[^}]+\})/)
  if (nameMatch && argsMatch) {
    try { calls.push({ name: nameMatch[1], input: JSON.parse(argsMatch[1]) }) } catch (e) { }
  }
  if (calls.length) return calls
  const tm = text.match(/\{"tool"\s*:\s*"([^"]+)",\s*"tool_input"\s*:\s*"([^"]+)"\}/)
  if (tm) return [{ name: tm[1], input: { command: tm[2] } }]
  return []
}

// ==================== 主测试 ====================

async function main() {
  console.log('\n=== 测试：LLM 调用 read_file 工具 ===')
  console.log('可用工具:', tools.map(t => t.name).join(', '))
  const toolDefs = tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters }))
  const sysPrompt = '你是一个 AI 助手。你有 read_file 和 search_files 两个工具。读取文件内容时使用 read_file，不要使用 cat/head 等终端命令。工具调用格式：{"name": "工具名", "arguments": {"参数名": "参数值"}}'

  const messages = [
    { role: 'user', content: '请读取 /home/liufei/data/claude-workspace/Nexus/CLAUDE.md 文件的前 20 行，告诉我这个文件的主要内容是什么？' },
  ]

  let i = 0, maxI = 6
  while (i < maxI) {
    i++
    console.log('\n>>> 第 ' + i + ' 轮 <<<')
    const res = await callLLM(messages, sysPrompt, toolDefs)
    let textContent = '', toolCalls = []
    for (const block of res.content || []) {
      if (block.type === 'text') {
        textContent += block.text
        toolCalls.push(...parseToolCalls(block.text))
      }
    }
    messages.push({ role: 'assistant', content: [{ type: 'text', text: textContent }] })
    if (toolCalls.length === 0) {
      console.log('\n最终回复:', textContent.slice(0, 800))
      break
    }
    for (const tc of toolCalls) {
      console.log('  >> 调用工具:', tc.name, JSON.stringify(tc.input))
      const r = await dispatch(tc.name, tc.input)
      const preview = r.output.slice(0, 300)
      console.log('  >> 工具结果 (ok=' + r.success + ', len=' + r.output.length + '):', preview)
      messages.push({ role: 'user', content: '工具 ' + tc.name + ' 返回: ' + r.output.slice(0, 3000) })
    }
  }
  console.log('\n完成 (共 ' + i + ' 轮)')
}

main().then(() => { db.close(); process.exit(0) }).catch(err => {
  console.error('失败:', err.message); db.close(); process.exit(1)
})
