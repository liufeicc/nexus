/**
 * 测试脚本：写入智能体配置到 configs 表，并测试 LLM 调用
 *
 * 运行方式：node scripts/test-llm.mjs
 */

import { DatabaseSync } from 'node:sqlite'
import path from 'path'
import os from 'os'

// ==================== 1. 写入配置到数据库 ====================

const dbPath = path.join(os.homedir(), '.tview', 'db.sqlite3')
console.log('数据库路径:', dbPath)

// 确保目录存在
const fs = await import('fs')
const dirPath = path.dirname(dbPath)
if (!fs.existsSync(dirPath)) {
  fs.mkdirSync(dirPath, { recursive: true })
}

const db = new DatabaseSync(dbPath)

// 创建 configs 表（如果不存在）
db.exec(`
  CREATE TABLE IF NOT EXISTS configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
`)

// 写入智能体配置
const agentConfig = {
  provider: 'anthropic',
  apiUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
  apiKey: 'sk-6e8d418d99d943e3a162f98de5d61cac',
  model: 'qwen3.6-plus',
  maxIterations: 90,
  timeout: 60000,
  maxRetries: 3,
}

const stmt = db.prepare(`
  INSERT INTO configs (key, value, updated_at)
  VALUES ('agentConfig', ?, strftime('%s', 'now'))
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at
`)
stmt.run(JSON.stringify(agentConfig))
console.log('✅ 配置已写入 configs 表')

// 验证读取
const getStmt = db.prepare("SELECT value FROM configs WHERE key = 'agentConfig'")
const row = getStmt.get()
if (row?.value) {
  const parsed = JSON.parse(row.value)
  console.log('✅ 读取配置:', JSON.stringify(parsed, null, 2))
} else {
  console.error('❌ 读取配置失败')
  process.exit(1)
}

// ==================== 2. 测试 LLM 调用 ====================

// 动态导入 LLMClient（需要 ESM 加载）
const { LLMClient } = await import('../src/main/agent/llm-client.js')

const messages = [
  { role: 'system', content: '你是一个测试助手。' },
  { role: 'user', content: '你好，请用一句话介绍你自己。' },
]

async function testChat() {
  console.log('\n--- 测试非流式调用 ---')
  const client = new LLMClient(agentConfig)
  try {
    const response = await client.chat(messages)
    console.log('✅ 响应内容:', response.content)
    console.log('✅ 工具调用:', response.toolCalls.length > 0 ? response.toolCalls : '无')
    console.log('✅ Thinking:', response.thinking ?? '无')
    console.log('✅ 是否完整:', response.stopped)
  } catch (err) {
    console.error('❌ 请求失败:', err.message)
    console.error('❌ 错误类型:', err.type)
    db.close()
    process.exit(1)
  }
}

async function testStream() {
  console.log('\n--- 测试流式调用 ---')
  const client = new LLMClient(agentConfig)

  const streamMessages = [
    { role: 'system', content: '你是一个测试助手。' },
    { role: 'user', content: '请数到 5，每数一个数字换一行。' },
  ]

  try {
    await client.streamChat(streamMessages, {
      onChunk: (text) => {
        process.stdout.write(text)
      },
      onDone: () => {
        console.log('\n✅ 流式响应完成')
        db.close()
        process.exit(0)
      },
      onError: (err) => {
        console.error('\n❌ 流式请求失败:', err.message)
        db.close()
        process.exit(1)
      },
    })
  } catch (err) {
    console.error('\n❌ 请求失败:', err.message)
    db.close()
    process.exit(1)
  }
}

// 先测试非流式，再测试流式
testChat()
  .then(() => testStream())
  .catch(err => {
    console.error('❌ 意外错误:', err.message)
    db.close()
    process.exit(1)
  })
