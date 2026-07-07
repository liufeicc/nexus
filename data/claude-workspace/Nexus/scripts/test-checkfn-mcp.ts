/**
 * 测试 checkFn 和 MCP 工具注册功能
 *
 * 运行方式：npx tsx scripts/test-checkfn-mcp.ts
 */

import { ToolRegistry } from '../src/main/agent/tool-registry'
import type { ToolDefinition, McpServerConfig } from '../src/core/types/agent'

async function main() {
  // ==================== 测试 1: checkFn 过滤 ====================

  console.log('=== 测试 1: checkFn 过滤 ===\n')

  const alwaysAvailableTool: ToolDefinition = {
    name: 'always_on',
    description: '始终可用',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ success: true, output: 'ok' }),
  }

  const envCheckTool: ToolDefinition = {
    name: 'needs_env_var',
    description: '需要 MY_API_KEY 环境变量',
    parameters: { type: 'object', properties: {} },
    checkFn: () => !!process.env.MY_API_KEY && process.env.MY_API_KEY.trim().length > 0,
    handler: async () => ({ success: true, output: 'ok' }),
  }

  const asyncCheckTool: ToolDefinition = {
    name: 'async_check',
    description: '异步检查',
    parameters: { type: 'object', properties: {} },
    checkFn: async () => {
      await new Promise(r => setTimeout(r, 10))
      return true
    },
    handler: async () => ({ success: true, output: 'ok' }),
  }

  const failingCheckTool: ToolDefinition = {
    name: 'failing_check',
    description: 'checkFn 会抛异常',
    parameters: { type: 'object', properties: {} },
    checkFn: () => { throw new Error('check failed') },
    handler: async () => ({ success: true, output: 'ok' }),
  }

  const registry = new ToolRegistry()
  registry.registerMany([alwaysAvailableTool, envCheckTool, asyncCheckTool, failingCheckTool])

  console.log(`  注册了 ${registry.size} 个工具`)

  // 无 MY_API_KEY 时
  const defsNoEnv = await registry.getDefinitions()
  console.log(`  无 MY_API_KEY: 可见 ${defsNoEnv.length} 个工具: ${defsNoEnv.map(d => d.name).join(', ')}`)

  // 验证 envCheckTool 被过滤
  const hasEnvTool = defsNoEnv.some(d => d.name === 'needs_env_var')
  console.log(`  needs_env_var ${hasEnvTool ? '❌ 未过滤（失败）' : '✅ 已过滤'}`)

  // 验证 failing_check 被过滤
  const hasFailing = defsNoEnv.some(d => d.name === 'failing_check')
  console.log(`  failing_check ${hasFailing ? '❌ 未过滤（失败）' : '✅ 已过滤（异常处理）'}`)

  // 验证 always_on 和 async_check 始终可见
  const hasAlways = defsNoEnv.some(d => d.name === 'always_on')
  const hasAsync = defsNoEnv.some(d => d.name === 'async_check')
  console.log(`  always_on: ${hasAlways ? '✅ 可见' : '❌ 丢失'}`)
  console.log(`  async_check: ${hasAsync ? '✅ 可见' : '❌ 丢失'}`)

  // 设置 MY_API_KEY 后
  process.env.MY_API_KEY = 'test-key'
  const defsHasEnv = await registry.getDefinitions()
  console.log(`\n  有 MY_API_KEY: 可见 ${defsHasEnv.length} 个工具: ${defsHasEnv.map(d => d.name).join(', ')}`)
  const hasEnvTool2 = defsHasEnv.some(d => d.name === 'needs_env_var')
  console.log(`  needs_env_var ${hasEnvTool2 ? '✅ 出现' : '❌ 仍未出现'}`)

  // ==================== 测试 2: unregister 和 getNamesByPrefix ====================

  console.log('\n=== 测试 2: unregister 和 getNamesByPrefix ===\n')

  const registry2 = new ToolRegistry()
  registry2.registerMany([
    { name: 'builtin_read', description: '', parameters: { type: 'object', properties: {} }, handler: async () => ({ success: true, output: '' }) },
    { name: 'builtin_write', description: '', parameters: { type: 'object', properties: {} }, handler: async () => ({ success: true, output: '' }) },
    { name: 'mcp_server1_list', description: '', parameters: { type: 'object', properties: {} }, handler: async () => ({ success: true, output: '' }) },
    { name: 'mcp_server1_read', description: '', parameters: { type: 'object', properties: {} }, handler: async () => ({ success: true, output: '' }) },
    { name: 'mcp_server2_exec', description: '', parameters: { type: 'object', properties: {} }, handler: async () => ({ success: true, output: '' }) },
  ])

  console.log(`  注册了 ${registry2.size} 个工具`)

  const mcp1Names = registry2.getNamesByPrefix('mcp_server1_')
  console.log(`  mcp_server1_ 前缀: ${mcp1Names.join(', ')} ${mcp1Names.length === 2 ? '✅' : '❌'}`)

  const builtinNames = registry2.getNamesByPrefix('builtin_')
  console.log(`  builtin_ 前缀: ${builtinNames.join(', ')} ${builtinNames.length === 2 ? '✅' : '❌'}`)

  // unregister
  registry2.unregister('mcp_server1_list')
  console.log(`  unregister mcp_server1_list 后: ${registry2.size} 个工具 ${registry2.size === 4 ? '✅' : '❌'}`)

  const mcp1After = registry2.getNamesByPrefix('mcp_server1_')
  console.log(`  mcp_server1_ 前缀剩余: ${mcp1After.join(', ')} ${mcp1After.length === 1 ? '✅' : '❌'}`)

  // ==================== 测试 3: MCP 配置类型 ====================

  console.log('\n=== 测试 3: MCP 配置类型验证 ===\n')

  const mcpConfig: McpServerConfig = {
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    env: { DEBUG: '1' },
    timeout: 15000,
  }
  console.log(`  MCP 配置: ${JSON.stringify(mcpConfig)}`)
  console.log('  ✅ 类型编译通过')

  console.log('\n=== 所有测试完成 ===')
}

main().catch(err => {
  console.error('测试失败:', err)
  process.exit(1)
})
