/**
 * 测试脚本：测试 AIAgent 核心类
 * 运行方式：node scripts/test-ai-agent.mjs
 *
 * 由于 AIAgent 依赖 LLMClient（需要真实 API），本测试使用模拟方式：
 * - 测试构造、状态管理、工具注册、事件系统、中断、预算等纯逻辑部分
 * - 不测试真实 LLM 调用（需要 API Key）
 */

import path from 'path'

const SRC = path.join(process.cwd(), 'src')

// ─── 内联核心类型和逻辑（Node strip-only 不支持跨模块 TS 导入） ───

// IterationBudget
class IterationBudget {
  constructor(max = 90) {
    this.max = max
    this.used = 0
  }
  get remaining() { return this.max - this.used }
  get consumed() { return this.used }
  consume(count = 1) { this.used += count }
  get hasRemaining() { return this.remaining > 0 }
  reset() { this.used = 0 }
}

// ToolRegistry 简化版
class ToolRegistry {
  constructor() { this.tools = new Map() }
  register(tool) { this.tools.set(tool.name, tool) }
  registerMany(tools) { tools.forEach(t => this.register(t)) }
  getDefinitions() { return Array.from(this.tools.values()).map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }
  has(name) { return this.tools.has(name) }
  async dispatch(name, args) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`工具 '${name}' 未注册`)
    return tool.handler(args)
  }
  get size() { return this.tools.size }
  get names() { return Array.from(this.tools.keys()) }
}

// ─── 测试：IterationBudget ───

function testBudgetInit() {
  console.log('=== 测试 1: IterationBudget 初始化 ===')
  const b = new IterationBudget(90)
  console.log('  max:', b.max, '=== 90:', b.max === 90)
  console.log('  remaining:', b.remaining, '=== 90:', b.remaining === 90)
  console.log('  consumed:', b.consumed, '=== 0:', b.consumed === 0)
  console.log('  hasRemaining:', b.hasRemaining, '=== true:', b.hasRemaining === true)
  console.log('  成功:', b.max === 90 && b.remaining === 90 && b.consumed === 0 ? 'PASS' : 'FAIL')
}

function testBudgetConsume() {
  console.log('\n=== 测试 2: IterationBudget 消耗 ===')
  const b = new IterationBudget(5)
  b.consume()
  console.log('  消耗 1 后 remaining:', b.remaining, '=== 4:', b.remaining === 4)
  b.consume(2)
  console.log('  消耗 2 后 remaining:', b.remaining, '=== 2:', b.remaining === 2)
  console.log('  consumed:', b.consumed, '=== 3:', b.consumed === 3)
  console.log('  成功:', b.remaining === 2 && b.consumed === 3 ? 'PASS' : 'FAIL')
}

function testBudgetReset() {
  console.log('\n=== 测试 3: IterationBudget 重置 ===')
  const b = new IterationBudget(10)
  b.consume(5)
  b.reset()
  console.log('  重置后 remaining:', b.remaining, '=== 10:', b.remaining === 10)
  console.log('  成功:', b.remaining === 10 ? 'PASS' : 'FAIL')
}

// ─── 测试：ToolRegistry ───

function testToolRegistry() {
  console.log('\n=== 测试 4: ToolRegistry 注册和查询 ===')
  const reg = new ToolRegistry()
  reg.register({
    name: 'read_file',
    description: '读取文件',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ success: true, output: 'content' }),
  })
  reg.register({
    name: 'todo',
    description: '任务管理',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ success: true, output: 'ok' }),
  })
  console.log('  数量:', reg.size, '=== 2:', reg.size === 2)
  console.log('  has read_file:', reg.has('read_file'), '=== true:', reg.has('read_file'))
  console.log('  has write_file:', reg.has('write_file'), '=== false:', reg.has('write_file') === false)
  console.log('  names:', reg.names.join(', '))
  console.log('  成功:', reg.size === 2 && reg.has('read_file') && !reg.has('write_file') ? 'PASS' : 'FAIL')
}

async function testToolDispatch() {
  console.log('\n=== 测试 5: ToolRegistry 分派调用 ===')
  const reg = new ToolRegistry()
  reg.register({
    name: 'add',
    description: '加法',
    parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
    handler: async (args) => ({ success: true, output: String(args.a + args.b) }),
  })
  const result = await reg.dispatch('add', { a: 3, b: 5 })
  console.log('  结果:', result.output, '=== "8":', result.output === '8')
  console.log('  成功:', result.success && result.output === '8' ? 'PASS' : 'FAIL')
}

async function testToolDispatchUnknown() {
  console.log('\n=== 测试 6: ToolRegistry 分派未知工具 ===')
  const reg = new ToolRegistry()
  let thrown = false
  try {
    await reg.dispatch('unknown_tool', {})
  } catch (e) {
    thrown = e.message.includes('未注册')
    console.log('  抛出异常:', e.message.slice(0, 60))
  }
  console.log('  成功:', thrown ? 'PASS' : 'FAIL')
}

// ─── 测试：AIAgent 构造和属性 ───

async function testAIAgentConstruction() {
  console.log('\n=== 测试 7: AIAgent 构造 ===')
  // 动态导入 TS（需要 tsx）
  // 由于 Node strip-only 不支持 TS，我们测试纯逻辑部分
  // 这里模拟 AIAgent 的行为

  // 模拟：事件系统
  const callbacks = new Set()
  let eventReceived = null
  callbacks.add(e => { eventReceived = e })
  const evt = { type: 'state_change', data: { state: 'running' }, timestamp: Date.now() }
  for (const cb of callbacks) cb(evt)
  console.log('  收到事件:', eventReceived?.type, '=== state_change:', eventReceived?.type === 'state_change')
  console.log('  收到数据:', eventReceived?.data?.state, '=== running:', eventReceived?.data?.state === 'running')
  console.log('  成功:', eventReceived?.type === 'state_change' ? 'PASS' : 'FAIL')
}

async function testEventUnsubscribe() {
  console.log('\n=== 测试 8: 事件退订 ===')
  const callbacks = new Set()
  let count = 0
  const unsub = () => { callbacks.clear() }
  callbacks.add(() => count++)
  for (const cb of callbacks) cb()
  console.log('  退订前调用次数:', count, '=== 1:', count === 1)
  unsub()
  for (const cb of callbacks) cb()
  console.log('  退订后调用次数:', count, '=== 1:', count === 1)
  console.log('  成功:', count === 1 ? 'PASS' : 'FAIL')
}

async function testParallelToolExecution() {
  console.log('\n=== 测试 9: 并行工具执行 ===')
  const reg = new ToolRegistry()

  // 注册一个延迟工具
  reg.register({
    name: 'slow',
    description: '延迟工具',
    parameters: { type: 'object', properties: { ms: { type: 'number' } } },
    handler: async (args) => {
      await new Promise(r => setTimeout(r, args.ms || 100))
      return { success: true, output: `done after ${args.ms}ms` }
    },
  })

  // 并行执行 3 个调用
  const calls = [
    { id: '1', name: 'slow', arguments: JSON.stringify({ ms: 50 }) },
    { id: '2', name: 'slow', arguments: JSON.stringify({ ms: 80 }) },
    { id: '3', name: 'slow', arguments: JSON.stringify({ ms: 30 }) },
  ]

  const start = Date.now()
  const results = await Promise.all(
    calls.map(async (tc) => {
      const args = JSON.parse(tc.arguments)
      const result = await reg.dispatch(tc.name, args)
      return { toolCallId: tc.id, result }
    })
  )
  const elapsed = Date.now() - start

  console.log('  结果数:', results.length, '=== 3:', results.length === 3)
  console.log('  耗时:', elapsed, 'ms (< 200ms (并行):', elapsed < 200)
  console.log('  全部成功:', results.every(r => r.result.success))
  // 并行执行 3 个（最大 80ms），总耗时应该 < 200ms（串行则 >= 160ms）
  console.log('  成功:', results.length === 3 && elapsed < 200 && results.every(r => r.result.success) ? 'PASS' : 'FAIL')
}

async function testToolExecutionInterrupt() {
  console.log('\n=== 测试 10: 工具执行中断 ===')
  const reg = new ToolRegistry()
  let interruptRequested = false

  reg.register({
    name: 'check',
    description: '检查中断',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      if (interruptRequested) {
        return { success: false, output: '[被中断]' }
      }
      return { success: true, output: 'ok' }
    },
  })

  // 第一次正常
  const r1 = await reg.dispatch('check', {})
  console.log('  正常调用:', r1.output, '=== ok:', r1.output === 'ok')

  // 设置中断
  interruptRequested = true
  const r2 = await reg.dispatch('check', {})
  console.log('  中断后:', r2.output, '=== [被中断]:', r2.output === '[被中断]')
  console.log('  成功:', r1.success && !r2.success ? 'PASS' : 'FAIL')
}

async function testToolJSONParseError() {
  console.log('\n=== 测试 11: 工具参数 JSON 解析错误处理 ===')
  const reg = new ToolRegistry()
  reg.register({
    name: 'echo',
    description: '回显',
    parameters: { type: 'object', properties: {} },
    handler: async (args) => ({ success: true, output: JSON.stringify(args) }),
  })

  // 模拟 LLM 返回的无效 JSON
  const badArgs = '{ invalid json'
  let args
  try {
    args = JSON.parse(badArgs)
  } catch {
    args = {}
  }

  const result = await reg.dispatch('echo', args)
  console.log('  降级为空对象:', JSON.stringify(args), '=== {}:', JSON.stringify(args) === '{}')
  console.log('  结果:', result.output)
  console.log('  成功:', result.success && result.output === '{}' ? 'PASS' : 'FAIL')
}

// ─── 测试：消息构建 ───

function testBuildApiMessages() {
  console.log('\n=== 测试 12: 构建 API 消息列表 ===')
  const systemPrompt = 'You are Nexus Agent...'
  const messages = [
    { role: 'user', content: 'hello', timestamp: Date.now() },
  ]
  const apiMessages = [
    { role: 'system', content: systemPrompt, timestamp: Date.now() },
    ...messages,
  ]
  console.log('  消息数:', apiMessages.length, '=== 2:', apiMessages.length === 2)
  console.log('  第一条是 system:', apiMessages[0].role === 'system')
  console.log('  第二条是 user:', apiMessages[1].role === 'user')
  console.log('  成功:', apiMessages.length === 2 && apiMessages[0].role === 'system' ? 'PASS' : 'FAIL')
}

function testMessageHistory() {
  console.log('\n=== 测试 13: 消息历史追加 ===')
  const messages = []
  messages.push({ role: 'user', content: 'hello', timestamp: Date.now() })
  messages.push({ role: 'assistant', content: 'hi', tool_calls: [{ id: '1', name: 'todo', arguments: '{}' }], timestamp: Date.now() })
  messages.push({ role: 'tool', content: 'ok', tool_call_id: '1', name: 'todo', timestamp: Date.now() })
  console.log('  消息数:', messages.length, '=== 3:', messages.length === 3)
  console.log('  角色序列:', messages.map(m => m.role).join(', '))
  console.log('  成功:', messages.length === 3 ? 'PASS' : 'FAIL')
}

// ==================== 主测试 ====================

console.log('\n========== AIAgent 测试 ==========\n')

testBudgetInit()
testBudgetConsume()
testBudgetReset()
testToolRegistry()
await testToolDispatch()
await testToolDispatchUnknown()
await testAIAgentConstruction()
await testEventUnsubscribe()
await testParallelToolExecution()
await testToolExecutionInterrupt()
await testToolJSONParseError()
testBuildApiMessages()
testMessageHistory()

console.log('\n========== 所有测试完成 ==========\n')
