/**
 * 集成测试：使用真实 API 测试 AIAgent
 * 运行方式：npx tsx scripts/test-ai-agent-integration.ts
 *
 * API 配置：
 * - provider: aliyun (Anthropic 兼容接口)
 * - apiUrl: https://dashscope.aliyuncs.com/apps/anthropic (SDK 自动追加 /v1/messages)
 * - model: qwen3.6-plus
 */

import { AIAgent } from '../src/main/agent/ai-agent'
import { builtInTools } from '../src/main/agent/tools/index'

const CONFIG = {
  provider: 'anthropic' as const,
  apiUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',  // SDK 会自动追加 /v1/messages
  apiKey: 'sk-6e8d418d99d943e3a162f98de5d61cac',
  model: 'qwen3.6-plus',
  maxIterations: 5,
  timeout: 120000,
  maxRetries: 2,
  promptBuilderOptions: {
    platform: 'cli',
    cwd: process.cwd(),
  },
  skipContextFiles: true,
}

async function main() {
  console.log('========== AIAgent 集成测试 ==========\n')
  console.log('模型:', CONFIG.model)
  console.log('API:', CONFIG.apiUrl)
  console.log('')

  // 创建智能体
  const agent = new AIAgent(CONFIG)

  // 注册所有内置工具
  agent.registerTools(builtInTools)
  console.log('已注册工具:', agent.tools.names.join(', '))
  console.log('')

  // 监听事件
  const events = []
  agent.onEvent((evt) => {
    events.push(evt)
    if (evt.type === 'state_change') {
      console.log(`[事件] 状态变化: ${evt.data.state}`)
    } else if (evt.type === 'message_delta') {
      process.stdout.write(evt.data.text)
    } else if (evt.type === 'tool_start') {
      console.log(`\n[事件] 工具开始: ${evt.data.toolName}`)
    } else if (evt.type === 'tool_result') {
      console.log(`[事件] 工具完成: ${evt.data.toolName} (${evt.data.success ? '成功' : '失败'})`)
    }
  })

  console.log('--- 发送消息 ---')
  console.log('用户: 北京今天的天气怎么样？请用一句话回答即可。')
  console.log('')

  try {
    const result = await agent.run('北京今天的天气怎么样？请用一句话回答即可。')

    console.log('\n\n--- 运行结果 ---')
    console.log('最终响应:', result.finalResponse?.slice(0, 500))
    console.log('')
    console.log('API 调用次数:', result.apiCalls)
    console.log('完成:', result.completed)
    console.log('部分完成:', result.partial)
    console.log('错误:', result.error || '(无)')
    console.log('消息数:', result.messages.length)
    console.log('')
    console.log('--- 消息历史 ---')
    for (const msg of result.messages) {
      console.log(`[${msg.role}] ${msg.content?.slice(0, 100) || '(tool_calls)'}${msg.content?.length > 100 ? '...' : ''}`)
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          console.log(`  tool_call: ${tc.name}(${tc.arguments.slice(0, 60)})`)
        }
      }
    }
    console.log('')
    console.log('--- 事件统计 ---')
    const eventCounts = {}
    for (const evt of events) {
      eventCounts[evt.type] = (eventCounts[evt.type] || 0) + 1
    }
    for (const [type, count] of Object.entries(eventCounts)) {
      console.log(`  ${type}: ${count}`)
    }
  } catch (error) {
    console.error('运行异常:', error)
  }

  console.log('\n========== 测试完成 ==========')
}

main()
