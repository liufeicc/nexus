/**
 * 测试脚本：写入配置到数据库 + 测试 LLM 非流式/流式调用（含 Thinking 支持）
 *
 * 运行方式：node scripts/test-llm-direct.mjs
 */

import { DatabaseSync } from 'node:sqlite'
import path from 'path'
import os from 'os'
import fs from 'fs'

// ==================== 1. 写入配置到数据库 ====================

const dbPath = '/home/liufei/.config/tview_test/db.sqlite3'
console.log('数据库路径:', dbPath)

const dirPath = path.dirname(dbPath)
if (!fs.existsSync(dirPath)) {
  fs.mkdirSync(dirPath, { recursive: true })
}

const db = new DatabaseSync(dbPath)
db.exec(`
  CREATE TABLE IF NOT EXISTS configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
`)

const agentConfig = {
  provider: 'anthropic',
  apiUrl: 'https://dashscope.aliyuncs.com/apps/anthropic/v1/messages',
  apiKey: 'sk-6e8d418d99d943e3a162f98de5d61cac',
  model: 'qwen3.6-plus',
}

db.prepare(`
  INSERT INTO configs (key, value, updated_at)
  VALUES ('agentConfig', ?, strftime('%s', 'now'))
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at
`).run(JSON.stringify(agentConfig))

console.log('✅ 配置已写入 configs 表')

const row = db.prepare("SELECT value FROM configs WHERE key = 'agentConfig'").get()
if (row?.value) {
  const parsed = JSON.parse(row.value)
  console.log('✅ 读取配置:', JSON.stringify(parsed, null, 2))
}

// ==================== 2. 非流式调用测试 ====================

async function testNonStream() {
  console.log('\n=== 测试非流式调用 ===')

  const body = {
    model: agentConfig.model,
    messages: [
      { role: 'user', content: '你好，请用一句话介绍你自己。' },
    ],
    max_tokens: 4096,
  }

  const response = await fetch(agentConfig.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': agentConfig.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    console.error(`❌ API 错误: ${response.status} ${response.statusText}`)
    console.error('响应体:', text)
    return false
  }

  const data = await response.json()
  console.log('✅ stop_reason:', data.stop_reason)
  console.log('✅ 模型:', data.model)
  console.log('✅ 输入 tokens:', data.usage?.input_tokens)
  console.log('✅ 输出 tokens:', data.usage?.output_tokens)
  console.log('')

  for (const block of data.content || []) {
    if (block.type === 'text') {
      console.log('📝 文本输出:', block.text)
    } else if (block.type === 'thinking') {
      console.log('🧠 Thinking 内容:')
      console.log('─'.repeat(50))
      console.log(block.thinking || '(无思考内容)')
      console.log('─'.repeat(50))
    } else if (block.type === 'tool_use') {
      console.log('🔧 工具调用:', block.name)
      console.log('   参数:', JSON.stringify(block.input))
    }
  }

  return true
}

// ==================== 3. 流式调用测试 ====================

/**
 * 解析 Anthropic SSE 流式响应
 *
 * 格式示例：
 *   event:message_start
 *   data:{"type":"message_start","message":{...}}
 *
 *   event:content_block_delta
 *   data:{"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}
 *
 *   event:content_block_delta
 *   data:{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Let me think..."}}
 */
async function testStream() {
  console.log('\n=== 测试流式调用 ===')

  const body = {
    model: agentConfig.model,
    messages: [
      { role: 'user', content: '请数到 5，每数一个数字换一行。' },
    ],
    max_tokens: 4096,
    stream: true,
  }

  const response = await fetch(agentConfig.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': agentConfig.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    console.error(`❌ API 错误: ${response.status} ${response.statusText}`)
    console.error('响应体:', text)
    return false
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let fullThinking = ''
  let stopReason = null
  let lastEventType = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()

      // 捕获 event: 行
      if (trimmed.startsWith('event:')) {
        lastEventType = trimmed.slice(6).trim()
        continue
      }

      // 处理 data: 行
      if (!trimmed.startsWith('data:')) continue
      const dataStr = trimmed.slice(5)
      if (dataStr === '[DONE]') break

      try {
        const parsed = JSON.parse(dataStr)

        // 文本增量
        if (lastEventType === 'content_block_delta') {
          if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
            fullContent += parsed.delta.text
            process.stdout.write(parsed.delta.text)
          }
          if (parsed.delta?.type === 'thinking_delta' && parsed.delta.thinking) {
            fullThinking += parsed.delta.thinking
          }
        }

        // 消息结束
        if (lastEventType === 'message_delta' && parsed.delta?.stop_reason) {
          stopReason = parsed.delta.stop_reason
        }
      } catch {
        // JSON 解析失败，跳过
      }
    }
  }

  reader.releaseLock()

  console.log('')
  console.log('─'.repeat(50))
  console.log('✅ stop_reason:', stopReason)
  console.log('✅ 文本输出长度:', fullContent.length)

  if (fullThinking.length > 0) {
    console.log('✅ Thinking 长度:', fullThinking.length)
    console.log('🧠 Thinking 内容:')
    console.log('─'.repeat(50))
    // 打印完整 thinking，最多前 500 字符
    const preview = fullThinking.length > 500
      ? fullThinking.substring(0, 500) + '...'
      : fullThinking
    console.log(preview)
    console.log('─'.repeat(50))
  } else {
    console.log('ℹ️ 无 Thinking 内容')
  }

  return true
}

// ==================== 运行 ====================

testNonStream()
  .then(ok => {
    if (ok) return testStream()
    return false
  })
  .then(ok => {
    if (ok) console.log('\n🎉 所有测试通过')
    else console.log('\n❌ 部分测试失败')
    db.close()
    process.exit(ok ? 0 : 1)
  })
  .catch(err => {
    console.error('❌ 意外错误:', err.message)
    console.error(err.stack)
    db.close()
    process.exit(1)
  })
