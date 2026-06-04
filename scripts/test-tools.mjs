/**
 * 测试脚本：工具调用测试
 * 运行方式：node scripts/test-tools.mjs
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

const terminalTool = {
  name: 'bash',
  description: '执行终端命令。\n\n注意：\n- 不要用 cat/head/tail 读取文件 — 使用 read_file。\n- 不要用 grep/rg/find 搜索文件 — 使用 search_files。\n- 不要用 ls 列目录 — 使用 search_files(target=\'files\')。\n- 终端仅用于：构建、安装、git、进程管理、网络操作、包管理器，以及需要 shell 的操作。',
  parameters: { type:'object', properties: { command:{ type:'string', description:'要执行的命令，如 "ls -la" 或 "npm install"' } }, required:['command'] },
  handler: async (args) => {
    const cmd = String(args.command||'').trim()
    if (!cmd) return { success:false, output:'命令不能为空' }
    console.log('  执行:', cmd)
    return new Promise((resolve) => {
      exec(cmd, { timeout:180000, maxBuffer:1024*1024*5, shell:'/bin/bash' }, (err,stdout,stderr) => {
        let out = (stdout||'')+(stderr||'')
        out = out.replace(/\x1b\[[0-9;]*m/g, '')
        if (out.length > 10000) out = out.slice(0,4000)+'\n\n...[截断]...\n\n'+out.slice(-6000)
        let exitNote = ''
        if (err && err.code) exitNote = `\n[退出码: ${err.code}]`
        // grep/rg/diff 退出码 1 注释
        if ((cmd.startsWith('grep') || cmd.includes(' grep ') || cmd.startsWith('rg ') || cmd.includes(' rg ') || cmd.startsWith('diff ')) && err?.code === 1) {
          exitNote += '\n[退出码 1 含义: 无匹配结果/文件有差异（不是错误）]'
        }
        resolve({ success:!err, output:out+exitNote })
      })
    })
  },
}

const readFileTool = {
  name: 'read_file',
  description: '读取文本文件内容，带行号和分页支持。默认每次读取 500 行，最多 2000 行。使用 offset 和 limit 参数分段读取大文件。',
  parameters: {
    type:'object',
    properties: {
      path:{ type:'string', description:'文件路径，支持 ~ 开头' },
      offset:{ type:'number', description:'起始行号（从 1 开始），默认 1' },
      limit:{ type:'number', description:'最多读取行数，默认 500，最大 2000' },
    },
    required:['path'],
  },
  handler: async (args) => {
    let fp = String(args.path || args.file_path || '').trim()
    if (fp.startsWith('~')) fp = path.join(process.env.HOME||'/tmp', fp.slice(1))
    if (!fs.existsSync(fp)) return { success:false, output:'文件不存在: '+fp }
    const st = fs.statSync(fp)
    if (st.isDirectory()) {
      const e = fs.readdirSync(fp,{withFileTypes:true}).map(x=>x.isDirectory()?`[${x.name}]`:`  ${x.name}`)
      return { success:true, output:'目录内容:\n'+e.join('\n') }
    }
    // 用 sed 分页读取
    const offset = typeof args.offset==='number' ? Math.max(1,Math.floor(args.offset)) : 1
    const limit = typeof args.limit==='number' ? Math.min(Math.max(1,Math.floor(args.limit)),2000) : 500
    const endLine = offset + limit - 1
    try {
      const totalLines = parseInt((await execSync(`wc -l < "${fp}"`)).trim()) || 0
      const { stdout } = await execAsync(`sed -n '${offset},${endLine}p' "${fp}"`)
      const lines = stdout.split('\n')
      if (lines.length>0 && lines[lines.length-1]==='') lines.pop()
      const numbered = lines.map((l,i)=>`${String(offset+i).padStart(6)}  ${l}`).join('\n')
      let out = numbered
      if (totalLines > endLine) out += `\n\n[文件共 ${totalLines} 行，已读取 ${offset}-${endLine} 行。使用 offset=${endLine+1} 继续。]`
      return { success:true, output:out.length>10000?out.slice(0,10000)+'\n...[截断]...':out }
    } catch(e) {
      const c = fs.readFileSync(fp,'utf-8')
      return { success:true, output:c.length>10000?c.slice(0,10000)+'\n...[截断]...':c }
    }
  },
}

function execSync(cmd) {
  return new Promise((resolve,reject) => {
    exec(cmd, {timeout:5000}, (err,stdout) => err?reject(err):resolve(stdout))
  })
}
function execAsync(cmd) {
  return new Promise((resolve,reject) => {
    exec(cmd, {timeout:10000, maxBuffer:1024*1024*5}, (err,stdout,stderr) => {
      if (err && err.code!==1) reject(err); else resolve({stdout,stderr})
    })
  })
}

const searchFilesTool = {
  name: 'search_files',
  description: '搜索文件内容或按文件名查找。不要用 grep/rg/find/ls 等终端命令搜索，应该用这个工具。\n\n内容搜索（target=\'content\'）：在文件中搜索正则表达式。输出模式：完整匹配（带行号）、仅文件路径、匹配计数。\n文件查找（target=\'files\'）：按 glob 模式查找文件（如 \'*.py\'、\'*config*\'）。也可以用来代替 ls，结果按修改时间排序。',
  parameters: {
    type:'object',
    properties: {
      pattern:{ type:'string', description:'搜索关键词或正则表达式（内容搜索），或 glob 模式（文件查找，如 "*.py"）' },
      target:{ type:'string', description:"'content' 搜索文件内容（默认），'files' 按文件名查找", enum:['content','files'] },
      path:{ type:'string', description:'搜索起始路径，默认为当前工作目录' },
      file_glob:{ type:'string', description:'内容搜索时按 glob 模式过滤文件，如 "*.ts"' },
      limit:{ type:'number', description:'最多返回结果数，默认 50' },
      offset:{ type:'number', description:'跳过前 N 个结果（分页），默认 0' },
      output_mode:{ type:'string', description:"'content' 带行号的匹配行（默认），'files_only' 仅文件路径，'count' 每文件匹配数", enum:['content','files_only','count'] },
      context:{ type:'number', description:'每个匹配行前后的上下文行数，默认 0' },
    },
    required:['pattern'],
  },
  handler: async (args) => {
    const pattern = String(args.pattern || '').trim()
    const searchPath = args.path ? (String(args.path).startsWith('~') ? path.join(process.env.HOME||'/tmp', String(args.path).slice(1)) : String(args.path)) : process.env.HOME || '/tmp'
    const target = args.target || 'content'
    const fileGlob = args.file_glob ? String(args.file_glob) : undefined
    const limit = typeof args.limit==='number' ? Math.max(1,Math.floor(args.limit)) : 50
    const offset = typeof args.offset==='number' ? Math.max(0,Math.floor(args.offset)) : 0
    const outputMode = args.output_mode || 'content'
    const context = typeof args.context==='number' ? Math.max(0,Math.floor(args.context)) : 0
    if (!pattern) return { success:false, output:'搜索关键词不能为空' }
    if (!fs.existsSync(searchPath)) return { success:false, output:`搜索路径不存在: ${searchPath}` }

    if (target === 'files') {
      const searchPattern = (!pattern.startsWith('**/') && !pattern.includes('/')) ? `*${pattern}` : pattern
      try {
        // 优先 rg --files
        let { stdout } = await execAsync(`rg --files -g ${escapeShell(searchPattern)} ${escapeShell(searchPath)} 2>/dev/null | head -n ${limit + offset}`, { timeout:30000, maxBuffer:1024*1024*5 })
        let allFiles = stdout.trim().split('\n').filter(Boolean)
        let page = allFiles.slice(offset, offset + limit)
        if (page.length === 0) {
          // fallback find
          const gp = (fileGlob && fileGlob !== '*') ? fileGlob : searchPattern
          const { stdout: fout } = await execAsync(`find ${escapeShell(searchPath)} -not -path '*/.*' -type f -name ${escapeShell(gp)} -maxdepth 5 2>/dev/null | head -100`, { timeout:15000 })
          page = fout.trim().split('\n').filter(Boolean)
          allFiles = page
        }
        if (!page.length) return { success:true, output:`未找到匹配的文件: ${pattern}`, data:{ matches:0 } }
        let out = `找到 ${page.length} 个匹配的文件:\n${page.join('\n')}`
        if (allFiles.length >= limit + offset) out += `\n\n[Hint: 结果已截断。使用 offset=${offset+limit} 查看更多。]`
        return { success:true, output:out, data:{ files:page, total_count:allFiles.length } }
      } catch(e) {
        return { success:true, output:`未找到匹配的文件: ${pattern}`, data:{ matches:0 } }
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
      const { stdout } = await execAsync(cmd, { timeout:30000, maxBuffer:1024*1024*5 })
      if (!stdout.trim()) return { success:true, output:`未找到匹配的内容: ${pattern}`, data:{ matches:0 } }
      const lines = stdout.trim().split('\n').filter(l => l !== '--')
      const page = lines.slice(offset, offset + limit)
      const truncated = lines.length >= limit + offset
      let out
      if (outputMode === 'files_only') out = `找到 ${page.length} 个匹配的文件:\n${page.join('\n')}`
      else if (outputMode === 'count') out = `找到 ${page.length} 个文件包含匹配内容:\n${page.join('\n')}`
      else out = `找到 ${page.length} 行匹配:\n${page.join('\n')}`
      if (truncated) out += `\n\n[Hint: 结果已截断。使用 offset=${offset+limit} 查看更多。]`
      return { success:true, output:out, data:{ matches:lines.length, pattern, path:searchPath } }
    } catch(e) {
      if (e.code === 1) return { success:true, output:`未找到匹配的内容: ${pattern}`, data:{ matches:0 } }
      return { success:false, output:`搜索失败: ${e.message}` }
    }
  },
}

function escapeShell(arg) {
  return `'${String(arg).replace(/'/g, "'\"'\"'")}'`
}

// ==================== 工具注册 ====================

const tools = [terminalTool, readFileTool, searchFilesTool]

function dispatch(name, args) {
  const t = tools.find(x => x.name === name)
  if (!t) return Promise.resolve({ success:false, output:'工具未注册: '+name })
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
  const body = { model:agentConfig.model, messages, max_tokens:4096 }
  if (sysPrompt) body.system = sysPrompt
  if (toolsDef) body.tools = toolsDef.map(t=>({ type:'function', function:{ name:t.name, description:t.description, parameters:t.parameters } }))

  console.log('\n  ========== LLM 输入 ==========')
  console.log('  模型:', agentConfig.model)
  console.log(formatMessages(messages, sysPrompt))
  if (toolsDef) console.log('  工具:', toolsDef.map(t=>t.name).join(', '))
  console.log('  ==============================\n')

  const res = await fetch(agentConfig.apiUrl, {
    method:'POST', headers:{ 'Content-Type':'application/json', 'x-api-key':agentConfig.apiKey, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('API '+res.status+': '+await res.text())
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
    try { calls.push({ name: nameMatch[1], input: JSON.parse(argsMatch[1]) }) } catch(e) {}
  }
  if (calls.length) return calls
  const tm = text.match(/\{"tool"\s*:\s*"([^"]+)",\s*"tool_input"\s*:\s*"([^"]+)"\}/)
  if (tm) return [{ name: tm[1], input: { command: tm[2] } }]
  return []
}

// ==================== 主测试 ====================

async function main() {
  console.log('\n=== 测试 search_files 工具（搜索 Nexus 项目中的 "ToolDefinition"） ===')
  console.log('可用工具:', tools.map(t=>t.name).join(', '))
  const toolDefs = tools.map(t=>({ name:t.name, description:t.description, parameters:t.parameters }))
  const sysPrompt = '你是一个 AI 助手。你有 search_files 工具。搜索文件内容时用 target="content"，搜索文件名时用 target="files"。工具调用格式：{"name": "工具名", "arguments": {"参数名": "参数值"}}'

  const messages = [
    { role:'user', content:'在 /home/liufei/data/claude-workspace/Nexus/src 目录下搜索包含 "ToolDefinition" 的 TypeScript 文件，用 target="files" 先找到所有 .ts 文件' },
  ]

  let i = 0, maxI = 5
  while (i < maxI) {
    i++
    console.log('\n>>> 第 '+i+' 轮 <<<')
    const res = await callLLM(messages, sysPrompt, toolDefs)
    let textContent = '', toolCalls = []
    for (const block of res.content||[]) {
      if (block.type === 'text') {
        textContent += block.text
        toolCalls.push(...parseToolCalls(block.text))
      }
    }
    messages.push({ role:'assistant', content:[{ type:'text', text:textContent }] })
    if (toolCalls.length === 0) {
      console.log('\n最终回复:', textContent.slice(0, 800))
      break
    }
    for (const tc of toolCalls) {
      console.log('  >> 调用工具:', tc.name, JSON.stringify(tc.input))
      const r = await dispatch(tc.name, tc.input)
      const preview = r.output.slice(0, 300)
      console.log('  >> 工具结果 (ok='+r.success+', len='+r.output.length+'):', preview)
      messages.push({ role:'user', content:'工具 '+tc.name+' 返回: '+r.output.slice(0, 3000) })
    }
  }
  console.log('\n完成 (共 '+i+' 轮)')
}

main().then(()=>{ db.close(); process.exit(0) }).catch(err=>{
  console.error('失败:', err.message); db.close(); process.exit(1)
})
