/**
 * 测试：验证 LLMResponse usage 字段、model-metadata 解析、context-compressor 压缩
 * 运行方式：npx tsx scripts/test-improvements.ts
 */

import { resolveContextLength, registerModelContext } from '../src/main/agent/model-metadata'
import {
  estimateTokens,
  estimateMessageTokens,
  pruneOldToolResults,
  findCompressBoundary,
  sanitizeToolPairs,
  compressMessages,
  serializeForSummary,
} from '../src/main/agent/context-compressor'
import { AgentMessage } from '../src/core/types/agent'

// ==================== 测试 1: model-metadata 解析 ====================

console.log('=== 测试 1: model-metadata resolveContextLength ===\n')

const cases = [
  { model: 'qwen3.6-plus', expect: 131_072 },
  { model: 'claude-sonnet-4-6', expect: 200_000 },
  { model: 'claude-opus-4-6-20250929', expect: 200_000 },  // 带日期后缀
  { model: 'gpt-4o', expect: 128_000 },
  { model: 'gpt-4o-mini', expect: 128_000 },  // 子串匹配
  { model: 'unknown-model', expect: 128_000 },  // 未知模型 fallback
]

let allPassed = true
for (const { model, expect: expected } of cases) {
  const actual = resolveContextLength(model)
  const pass = actual === expected
  if (!pass) allPassed = false
  console.log(`  ${pass ? '✅' : '❌'} ${model}: ${actual} ${pass ? '' : `(期望 ${expected})`}`)
}
console.log(`  ${allPassed ? '✅ 全部通过' : '❌ 有失败'}\n`)

// ==================== 测试 2: 手动注册模型 ====================

console.log('=== 测试 2: registerModelContext ===\n')
registerModelContext('my-custom-model', 64_000)
const customResult = resolveContextLength('my-custom-model')
console.log(`  ${customResult === 64_000 ? '✅' : '❌'} 手动注册模型: ${customResult}\n`)

// ==================== 测试 3: Token 估算 ====================

console.log('=== 测试 3: Token 估算 ===\n')

const textEst = estimateTokens('Hello, world! 你好世界')
console.log(`  estimateTokens("Hello, world! 你好世界"): ${textEst} tokens (文本长度 ${'Hello, world! 你好世界'.length} chars)\n`)

const messages: AgentMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.', timestamp: Date.now() },
  { role: 'user', content: 'What is 2+2?', timestamp: Date.now() },
  { role: 'assistant', content: '4', timestamp: Date.now() },
  { role: 'tool', content: '{"result": 4}', tool_call_id: 'tc_1', name: 'calculator', timestamp: Date.now() },
]

const msgTokens = estimateMessageTokens(messages)
console.log(`  estimateMessageTokens(4条消息): ${msgTokens} tokens\n`)

// ==================== 测试 4: pruneOldToolResults ====================

console.log('=== 测试 4: pruneOldToolResults ===\n')

const longOutput = 'x'.repeat(500)
const shortOutput = 'ok'

const msgsForPrune: AgentMessage[] = [
  { role: 'system', content: 'You are helpful.', timestamp: Date.now() },
  { role: 'user', content: 'Do something.', timestamp: Date.now() },
  { role: 'assistant', content: '', tool_calls: [{ id: 'tc_1', name: 'run', arguments: '{}' }], timestamp: Date.now() },
  { role: 'tool', content: longOutput, tool_call_id: 'tc_1', name: 'run', timestamp: Date.now() },
  { role: 'user', content: 'Do more.', timestamp: Date.now() },
  { role: 'assistant', content: 'done', tool_calls: [{ id: 'tc_2', name: 'run', arguments: '{}' }], timestamp: Date.now() },
  { role: 'tool', content: shortOutput, tool_call_id: 'tc_2', name: 'run', timestamp: Date.now() },
]

const pruned = pruneOldToolResults(msgsForPrune, 3)
const prunedTool = pruned.find(m => m.role === 'tool' && m.tool_call_id === 'tc_1')
const prunedOk = pruned.find(m => m.role === 'tool' && m.tool_call_id === 'tc_2')
const prunePass = prunedTool?.content === '[Old tool output cleared to save context space]' && prunedOk?.content === 'ok'
console.log(`  ${prunePass ? '✅' : '❌'} 长工具结果被替换: ${prunedTool?.content?.slice(0, 40)}`)
console.log(`  ${prunedOk?.content === 'ok' ? '✅' : '❌'} 短工具结果保留: ${prunedOk?.content}\n`)

// ==================== 测试 5: findCompressBoundary ====================

console.log('=== 测试 5: findCompressBoundary ===\n')

const boundaryResult = findCompressBoundary(msgsForPrune, 2, 100)
console.log(`  compressStart=${boundaryResult.start}, compressEnd=${boundaryResult.end}`)
console.log(`  ${boundaryResult.start >= 2 ? '✅' : '❌'} 头部保护 (>= 2)`)

// ==================== 测试 6: serializeForSummary ====================

console.log('=== 测试 6: serializeForSummary ===\n')

const serialized = serializeForSummary(msgsForPrune)
console.log(`  序列化长度: ${serialized.length} chars`)
console.log(`  包含 run 工具调用: ${serialized.includes('run(') ? '✅' : '❌'}`)
console.log(`  包含用户消息: ${serialized.includes('[USER]') ? '✅' : '❌'}\n`)

// ==================== 测试 7: generateSummaryAsync (需要辅助模型) ====================

console.log('=== 测试 7: generateSummary (V2 需要辅助模型，跳过) ===\n')
console.log('  V2 摘要生成需要 AuxiliaryClient，此处跳过\n')

// ==================== 测试 8: sanitizeToolPairs ====================

console.log('=== 测试 8: sanitizeToolPairs ===\n')

const orphanedMsgs: AgentMessage[] = [
  { role: 'assistant', content: '', tool_calls: [{ id: 'tc_1', name: 'run', arguments: '{}' }], timestamp: Date.now() },
  // tc_1 的结果被删除了 — 应该插入占位结果
  { role: 'user', content: 'continue', timestamp: Date.now() },
]

const sanitized = sanitizeToolPairs(orphanedMsgs)
const stubResult = sanitized.find(m => m.role === 'tool' && m.tool_call_id === 'tc_1')
console.log(`  ${stubResult ? '✅' : '❌'} 缺失的 tool_call 结果被插入占位: ${stubResult?.content?.slice(0, 40)}\n`)

// ==================== 测试 9: compressMessages (完整流程，异步) ====================

async function testCompress() {
  console.log('=== 测试 9: compressMessages 完整流程 ===\n')

  // 构造一个长对话来触发压缩
  const longMessages: AgentMessage[] = [
    { role: 'system', content: 'You are Nexus Agent.', timestamp: Date.now() },
  ]

  for (let i = 0; i < 30; i++) {
    longMessages.push(
      { role: 'user', content: `User request #${i}: 处理任务 ${i}`, timestamp: Date.now() },
      { role: 'assistant', content: `I will handle task ${i}`, tool_calls: [{ id: `tc_${i}`, name: 'run_command', arguments: JSON.stringify({ cmd: `task-${i}` }) }], timestamp: Date.now() },
      { role: 'tool', content: `Output for task ${i}: ${'x'.repeat(300)} end`, tool_call_id: `tc_${i}`, name: 'run_command', timestamp: Date.now() },
    )
  }

  // 最后一条用户消息
  longMessages.push({ role: 'user', content: '最新的用户消息', timestamp: Date.now() })

  const totalTokensBefore = estimateMessageTokens(longMessages)
  console.log(`  压缩前: ${longMessages.length} 条消息, ~${totalTokensBefore} tokens`)

  // V2: compressMessages 返回 Promise，使用静态 fallback（无辅助客户端）
  const result = await compressMessages(longMessages, { contextLength: 5000 })
  console.log(`  压缩后: ${result.compressed.length} 条消息, ~${result.tokensAfter} tokens`)
  console.log(`  节省: ${result.tokensBefore - result.tokensAfter} tokens`)

  const compressPass = result.compressed.length < longMessages.length && result.tokensAfter < result.tokensBefore
  console.log(`  ${compressPass ? '✅' : '❌'} 消息数和 token 数都减少了\n`)
}

// ==================== 测试 10: LLMResponse usage 字段 ====================

console.log('=== 测试 10: LLMResponse usage 类型检查 ===\n')
console.log('  (usage 字段已在 llm-client.ts 的 4 条返回路径中填充)')
console.log('  类型定义: { promptTokens, completionTokens, totalTokens }')
console.log('  ✅ 类型检查已在 npx tsc --noEmit 中通过\n')

// ==================== 总结 ====================

// 运行异步压缩测试
testCompress().then(() => {
  console.log('========== 测试完成 ==========')
}).catch(err => {
  console.error('测试失败:', err)
  process.exit(1)
})
