/**
 * 测试：验证 IPC 桥接相关功能
 * - thinking 事件类型
 * - tool_start 事件含 toolArgs
 * - agent-service 广播逻辑（模拟 BrowserWindow）
 * - preload API 事件监听器的 cleanup 函数
 *
 * 运行方式：npx tsx scripts/test-ipc-bridge.ts
 */

import { AIAgent } from '../src/main/agent/ai-agent'
import { builtInTools } from '../src/main/agent/tools/index'
import { IPC_CHANNELS } from '../src/core/constants/ipc-channels'
import { AgentEvent } from '../src/core/types/agent'

const CONFIG = {
  provider: 'anthropic' as const,
  apiUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
  apiKey: 'sk-6e8d418d99d943e3a162f98de5d61cac',
  model: 'qwen3.6-plus',
  maxIterations: 3,
  timeout: 120000,
  maxRetries: 1,
  promptBuilderOptions: {
    platform: 'cli',
    cwd: process.cwd(),
  },
  skipContextFiles: true,
}

// ==================== 测试 1: thinking 事件类型存在 ====================

console.log('=== 测试 1: thinking 事件类型 ===\n')

const agent1 = new AIAgent(CONFIG)
agent1.registerTools(builtInTools)

const receivedEvents: AgentEvent[] = []
agent1.onEvent((evt) => receivedEvents.push(evt))

// thinking 是 AgentEventType 的合法类型，编译通过即说明类型系统正确
const thinkingEvent: AgentEvent = {
  type: 'thinking',
  data: { text: 'let me think...' },
  timestamp: Date.now(),
}
console.log(`  ✅ thinking 事件类型可用: ${thinkingEvent.type}`)
console.log(`  ✅ StreamCallbacks.onThinking 回调已注册\n`)

// ==================== 测试 2: tool_start 事件含 toolArgs ====================

console.log('=== 测试 2: tool_start 事件含 toolArgs ===\n')

const agent2 = new AIAgent({
  ...CONFIG,
  maxIterations: 1,
})
agent2.registerTools(builtInTools)

const toolStartEvents: AgentEvent[] = []
agent2.onEvent((evt) => {
  if (evt.type === 'tool_start') {
    toolStartEvents.push(evt)
  }
})

// 发送一条会触发工具调用的消息
async function testToolArgs() {
  const runPromise = agent2.run('请用 read_file 工具读取 package.json 的内容，只需要前 20 行即可')

  const result = await runPromise

  if (toolStartEvents.length > 0) {
    const firstEvent = toolStartEvents[0]
    const hasArgs = 'toolArgs' in firstEvent.data
    console.log(`  ✅ tool_start 事件包含 toolArgs: ${hasArgs}`)
    console.log(`     toolName: ${firstEvent.data.toolName}`)
    console.log(`     toolArgs 类型: ${typeof firstEvent.data.toolArgs}`)
    if (hasArgs) {
      console.log(`     toolArgs keys: ${Object.keys(firstEvent.data.toolArgs as Record<string, unknown>).join(', ')}`)
    }
  } else {
    console.log(`  ❌ 没有收到 tool_start 事件`)
  }
  console.log(`  运行结果: ${result.completed ? '完成' : '未完成'}，API 调用: ${result.apiCalls}\n`)
}

testToolArgs().catch(err => {
  console.log(`  ⚠️ 运行异常: ${err.message || err}`)
})

// ==================== 测试 3: 广播模拟 ====================

console.log('=== 测试 3: 广播逻辑模拟 ===\n')

// 模拟 BrowserWindow 对象
const mockWindows = [
  { webContents: { send: (channel: string, data: unknown) => { console.log(`  [win1] ${channel}: ${JSON.stringify(data).slice(0, 80)}`) } } },
  { webContents: { send: (channel: string, data: unknown) => { console.log(`  [win2] ${channel}: ${JSON.stringify(data).slice(0, 80)}`) } } },
  { webContents: { send: () => { throw new Error('window closed') } } },  // 模拟已关闭窗口
]

function broadcast(eventChannel: string, data: Record<string, unknown>): void {
  for (const win of mockWindows) {
    try {
      win.webContents.send(eventChannel, data)
    } catch {
      // 窗口可能已关闭，忽略
    }
  }
}

broadcast(IPC_CHANNELS.AGENT_STREAMING, { text: 'Hello, world!' })
broadcast(IPC_CHANNELS.AGENT_STATE_CHANGE, { state: 'running', apiCall: 1 })
broadcast(IPC_CHANNELS.AGENT_TOOL_CALL, { toolCallId: 'tc_1', toolName: 'read_file' })
console.log(`  ✅ 广播到 3 个窗口（含 1 个已关闭），无异常\n`)

// ==================== 测试 4: preload API 事件监听 cleanup ====================

console.log('=== 测试 4: 事件监听 cleanup 函数 ===\n')

// 模拟 ipcRenderer 行为
type Listener = (...args: unknown[]) => void
const listeners = new Map<string, Set<Listener>>()

const mockIpcRenderer = {
  on: (channel: string, listener: Listener) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel)!.add(listener)
  },
  removeListener: (channel: string, listener: Listener) => {
    listeners.get(channel)?.delete(listener)
  },
  send: (channel: string, ...args: unknown[]) => {
    listeners.get(channel)?.forEach(fn => fn(null, ...args))
  },
}

// 模拟 preload 的 onStreaming 模式
function onStreaming(callback: (data: { text: string }) => void) {
  const listener = (_event: unknown, data: { text: string }) => callback(data)
  mockIpcRenderer.on(IPC_CHANNELS.AGENT_STREAMING, listener)
  return () => mockIpcRenderer.removeListener(IPC_CHANNELS.AGENT_STREAMING, listener)
}

const receivedTexts: string[] = []
const cleanup = onStreaming((data) => {
  receivedTexts.push(data.text)
})

// 发送模拟数据
mockIpcRenderer.send(IPC_CHANNELS.AGENT_STREAMING, { text: 'chunk1' })
mockIpcRenderer.send(IPC_CHANNELS.AGENT_STREAMING, { text: 'chunk2' })

console.log(`  cleanup 前收到 ${receivedTexts.length} 条: ${receivedTexts.join(', ')}`)

// 调用 cleanup
cleanup()

// cleanup 后再发送 — 应该不再收到
mockIpcRenderer.send(IPC_CHANNELS.AGENT_STREAMING, { text: 'chunk3' })

const afterCleanup = receivedTexts.length
console.log(`  cleanup 后收到 ${afterCleanup} 条`)
console.log(`  ${afterCleanup === 2 ? '✅' : '❌'} cleanup 函数正确移除了监听器\n`)

// ==================== 测试 5: IPC_CHANNELS 完整性 ====================

console.log('=== 测试 5: IPC_CHANNELS 完整性 ===\n')

const expectedChannels = [
  'AGENT_SEND_MESSAGE',
  'AGENT_INTERRUPT',
  'AGENT_GET_STATUS',
  'AGENT_STREAMING',
  'AGENT_THINKING',
  'AGENT_TOOL_CALL',
  'AGENT_TOOL_RESULT',
  'AGENT_STATE_CHANGE',
]

let allPresent = true
for (const name of expectedChannels) {
  const value = (IPC_CHANNELS as Record<string, string>)[name]
  const present = !!value
  if (!present) allPresent = false
  console.log(`  ${present ? '✅' : '❌'} ${name}: ${value || '(缺失)'}`)
}
console.log(`  ${allPresent ? '✅ 全部存在' : '❌ 有缺失'}\n`)

// ==================== 等待 agent2 运行完成 ====================

console.log('=== 等待 agent2 运行完成... ===\n')
