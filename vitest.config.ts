/**
 * Vitest 配置
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/main/agent/**/*.ts'],
      exclude: ['src/main/agent/mcp/mcp-client.ts'], // MCP 客户端需要特殊 mock
    },
  },
})
