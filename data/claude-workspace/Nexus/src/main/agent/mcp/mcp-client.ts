/**
 * MCP（Model Context Protocol）客户端
 *
 * 通过 stdio 传输协议连接外部 MCP Server，自动发现其工具并注册到 ToolRegistry。
 * 不依赖 @modelcontextprotocol/sdk，自行实现 JSON-RPC 2.0 协议栈。
 *
 * 协议流程：
 * 1. spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
 * 2. 发送 initialize 握手
 * 3. 发送 initialized 通知
 * 4. 发现工具（tools/list）
 * 5. 调用工具（tools/call）
 *
 * 消息帧格式（LSP-style）：
 *   Content-Length: N\r\n\r\n{json-body}
 */

import { spawn, ChildProcess } from 'child_process'
import { McpServerConfig } from '../../../core/types/agent'
import { ToolDefinition, ToolResult } from '../../../core/types/agent'
import { ToolRegistry } from '../tool-registry'
import { logger } from '../../utils/logger'

// ==================== MCP 类型 ====================

interface McpTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

interface McpInitializeParams {
  protocolVersion: string
  capabilities: Record<string, unknown>
  clientInfo: { name: string; version: string }
}

interface McpContentBlock {
  type: string
  text?: string
  [key: string]: unknown
}

interface McpCallToolResult {
  content: McpContentBlock[]
  isError?: boolean
  [key: string]: unknown
}

// ==================== JSON-RPC 消息帧解析器 ====================

/**
 * 增量解析器：从字节流中提取完整的 JSON-RPC 消息。
 * 处理 LSP-style 的 Content-Length 帧格式。
 */
class MessageReader {
  private buffer = Buffer.alloc(0)
  private messages: Array<Record<string, unknown>> = []
  private readonly MAX_BUFFER_SIZE = 1024 * 1024 * 10 // 10MB 总缓冲上限
  private readonly MAX_MESSAGE_SIZE = 1024 * 1024 * 50 // 50MB 单条消息上限

  /**
   * 追加数据并尝试解析完整消息
   */
  append(chunk: Buffer): Array<Record<string, unknown>> {
    // 如果 buffer 已超限，先清空再追加新数据
    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      logger.warn(
        `[MCP] MessageReader buffer 超过 10MB，已清空 (${this.buffer.length} bytes)`
      )
      this.buffer = Buffer.alloc(0)
    }
    this.buffer = Buffer.concat([this.buffer, chunk])
    const parsed: Array<Record<string, unknown>> = []

    while (true) {
      // 查找 Content-Length 头
      const headerIdx = this.buffer.indexOf('Content-Length:')
      if (headerIdx === -1) {
        // buffer 中没有协议头，检查是否需要清理
        if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
          logger.warn(
            `[MCP] MessageReader buffer 超过 10MB 且无 Content-Length 头，已清空 (${this.buffer.length} bytes)`
          )
          this.buffer = Buffer.alloc(0)
        }
        break
      }

      // 如果 Content-Length: 不在 buffer 开头，说明前面有垃圾数据，跳过
      if (headerIdx > 0) {
        logger.debug(`[MCP] MessageReader 跳过 ${headerIdx} 字节非协议数据`)
        this.buffer = this.buffer.slice(headerIdx)
      }

      // 解析 Content-Length 值（此时 Content-Length: 在 buffer 开头）
      const colonPos = 'Content-Length:'.length
      const endOfLine = this.buffer.indexOf('\r', colonPos)
      if (endOfLine === -1) break // 头不完整

      const lengthStr = this.buffer
        .slice(colonPos, endOfLine)
        .toString('ascii')
        .trim()
      const contentLength = parseInt(lengthStr, 10)

      // 验证 contentLength 合法性：必须是 0 ~ MAX_MESSAGE_SIZE 之间的整数
      if (isNaN(contentLength) || contentLength < 0) {
        logger.warn(`[MCP] MessageReader 收到无效 Content-Length: ${lengthStr}，已跳过`)
        // 跳过当前行，尝试找下一个 Content-Length:
        const nextLineEnd = this.buffer.indexOf('\r\n', endOfLine)
        if (nextLineEnd !== -1) {
          this.buffer = this.buffer.slice(nextLineEnd + 2)
        } else {
          this.buffer = this.buffer.slice(endOfLine)
        }
        continue
      }
      if (contentLength > this.MAX_MESSAGE_SIZE) {
        logger.warn(
          `[MCP] MessageReader 消息体 ${contentLength} bytes 超过 50MB 上限，已断开连接`
        )
        this.buffer = Buffer.alloc(0)
        break
      }

      // 头结束位置：\r\n\r\n
      const headerEnd = this.buffer.indexOf('\r\n\r\n', endOfLine)
      if (headerEnd === -1) break // 头尾分隔符不完整

      const bodyStart = headerEnd + 4 // \r\n\r\n 长度
      const bodyEnd = bodyStart + contentLength

      if (this.buffer.length < bodyEnd) break // 消息体不完整

      // 提取并解析 JSON
      const body = this.buffer.slice(bodyStart, bodyEnd)
      try {
        const message = JSON.parse(body.toString('utf8'))

        // 验证 JSON-RPC 消息结构：必须包含 jsonrpc 字段
        if (message.jsonrpc !== '2.0') {
          logger.warn(`[MCP] MessageReader 收到无效 JSON-RPC 消息（缺少 jsonrpc: "2.0"），已跳过`)
          this.buffer = this.buffer.slice(bodyEnd)
          continue
        }

        parsed.push(message)
      } catch {
        // JSON 解析失败，跳过这条消息
        logger.warn('[MCP] 收到无效 JSON 消息，已跳过')
      }

      // 移除已处理的数据
      this.buffer = this.buffer.slice(bodyEnd)
    }

    return parsed
  }
}

// ==================== MCP Server Session ====================

/**
 * 管理单个 MCP Server 的进程和连接。
 * 职责：生命周期管理、工具发现、工具调用、健康检查。
 */
class McpServerSession {
  private config: McpServerConfig
  private process: ChildProcess | null = null
  private reader = new MessageReader()
  private nextId = 1
  private pendingRequests = new Map<number, {
    resolve: (value: Record<string, unknown>) => void
    reject: (reason: Error) => void
  }>()
  private discoveredTools: McpTool[] = []
  private alive = false
  private toolsListChangedCallback: ((tools: McpTool[]) => void) | null = null
  private stderrBuffer = Buffer.alloc(0)
  private readonly MAX_STDERR_BUFFER = 1024 * 1024 // 1MB stderr 缓冲上限

  constructor(config: McpServerConfig) {
    this.config = config
  }

  /**
   * 启动 MCP Server 连接，完成握手并发现工具。
   */
  async connect(): Promise<McpTool[]> {
    const { command, args, env, timeout } = this.config
    const spawnTimeout = timeout ?? 10000

    logger.info(`[MCP] 启动 ${this.config.name}: ${command} ${args.join(' ')}`)

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
        timeout: spawnTimeout,
      })

      this.process = child

      // 监听 stdout，解析 JSON-RPC 消息
      child.stdout.on('data', (chunk: Buffer) => {
        const messages = this.reader.append(chunk)
        for (const msg of messages) {
          this.handleMessage(msg)
        }
      })

      // 监听 stderr（MCP Server 的日志，非协议数据）
      child.stderr.on('data', (chunk: Buffer) => {
        // 限制 stderr 缓冲大小，防止无限增长
        if (this.stderrBuffer.length >= this.MAX_STDERR_BUFFER) {
          this.stderrBuffer = Buffer.alloc(0)
        }
        this.stderrBuffer = Buffer.concat([this.stderrBuffer, chunk])
        const text = chunk.toString('utf8').trim()
        if (text) {
          logger.debug(`[MCP:${this.config.name}] stderr: ${text.slice(0, 200)}`)
        }
      })

      child.on('error', (err) => {
        logger.error(`[MCP] ${this.config.name} 启动失败: ${err.message}`)
        this.alive = false
        reject(new Error(`MCP Server '${this.config.name}' 启动失败: ${err.message}`))
      })

      child.on('exit', (code) => {
        logger.info(`[MCP] ${this.config.name} 进程退出, code=${code}`)
        this.alive = false
        // 拒绝所有 pending 请求
        for (const [, { reject: rej }] of this.pendingRequests) {
          rej(new Error(`MCP Server '${this.config.name}' 已退出 (code=${code})`))
        }
        this.pendingRequests.clear()
      })

      // 连接成功后发送 initialize 握手
      this.sendInitialize(spawnTimeout)
        .then(() => resolve(this.discoveredTools))
        .catch(reject)
    })
  }

  /**
   * 关闭 MCP Server 连接。
   *
   * 守卫条件仅检查 this.process（而非 this.alive），确保初始化期间
   * 调用 disconnect 也能正确清理已 spawn 但尚未完成握手的子进程，
   * 避免孤儿进程泄漏。
   */
  async disconnect(): Promise<void> {
    if (!this.process) return

    logger.info(`[MCP] 关闭 ${this.config.name} (alive=${this.alive})`)

    // 仅在初始化完成后才发送 shutdown 通知（优雅关闭）
    if (this.alive) {
      try {
        await this.sendNotification('notifications/initialized', {})
      } catch {
        // 忽略关闭时的发送错误
      }
    }

    // 拒绝所有 pending 请求（包括初始化期间的握手请求）
    for (const [, { reject: rej }] of this.pendingRequests) {
      rej(new Error(`MCP Server '${this.config.name}' 正在关闭`))
    }
    this.pendingRequests.clear()

    this.process.kill('SIGTERM')

    // 等 1 秒，如果没退出就强杀
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try { this.process?.kill('SIGKILL') } catch {}
        resolve()
      }, 1000)
      this.process?.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    this.process = null
    this.alive = false
  }

  /**
   * 调用 MCP 工具。
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    if (!this.alive) {
      throw new Error(`MCP Server '${this.config.name}' 未运行`)
    }

    const result = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args,
    }, 60000) as McpCallToolResult

    // 处理返回内容
    const textParts: string[] = []
    for (const block of result.content || []) {
      if (block.type === 'text' && block.text !== undefined) {
        textParts.push(block.text)
      } else {
        textParts.push(JSON.stringify(block))
      }
    }

    const output = textParts.join('\n') || '(工具无输出)'

    if (result.isError) {
      return `工具调用失败: ${output}`
    }

    return output
  }

  /**
   * 检查连接是否存活。
   */
  isAlive(): boolean {
    return this.alive && this.process !== null
  }

  /**
   * 获取已发现的工具列表。
   */
  getTools(): McpTool[] {
    return [...this.discoveredTools]
  }

  /**
   * 重新发现工具（工具列表变更通知后调用）。
   */
  async refreshTools(): Promise<McpTool[]> {
    const result = await this.sendRequest('tools/list', {}) as { tools: McpTool[] }
    this.discoveredTools = result.tools || []
    this.toolsListChangedCallback?.(this.discoveredTools)
    return this.discoveredTools
  }

  /**
   * 注册工具列表变更通知的回调。
   */
  onToolsListChanged(callback: (tools: McpTool[]) => void): void {
    this.toolsListChangedCallback = callback
  }

  // ==================== 内部方法 ====================

  /**
   * 发送 initialize 握手 + initialized 通知 + 发现工具。
   */
  private async sendInitialize(timeout: number): Promise<void> {
    const initParams: McpInitializeParams = {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'tview', version: '1.0.0' },
    }

    const initResult = await this.sendRequest(
      'initialize',
      initParams,
      timeout,
    ) as Record<string, unknown>

    logger.info(`[MCP] ${this.config.name} 握手成功, 协议版本: ${initResult.protocolVersion}`)

    // 发送 initialized 通知
    await this.sendNotification('notifications/initialized', {})

    // 发现工具
    const toolsResult = await this.sendRequest('tools/list', {}) as { tools: McpTool[] }
    this.discoveredTools = toolsResult.tools || []
    this.alive = true

    logger.info(
      `[MCP] ${this.config.name} 发现 ${this.discoveredTools.length} 个工具: `
      + this.discoveredTools.map(t => t.name).join(', ')
    )
  }

  /**
   * 处理收到的 JSON-RPC 消息。
   */
  private handleMessage(msg: Record<string, unknown>): void {
    // 响应消息：{ jsonrpc, id, result } 或 { jsonrpc, id, error }
    if ('id' in msg && typeof msg.id === 'number') {
      const pending = this.pendingRequests.get(msg.id)
      if (pending) {
        this.pendingRequests.delete(msg.id)
        if ('error' in msg) {
          const err = msg.error as { message?: string }
          pending.reject(new Error(`MCP 错误: ${err.message || '未知错误'}`))
        } else {
          pending.resolve((msg.result ?? {}) as Record<string, unknown>)
        }
      }
      return
    }

    // 通知消息：{ jsonrpc, method }
    if ('method' in msg && typeof msg.method === 'string') {
      if (msg.method === 'notifications/tools/list_changed') {
        logger.info(`[MCP] ${this.config.name} 工具列表变更，正在刷新...`)
        this.refreshTools().catch(err => {
          logger.error(`[MCP] ${this.config.name} 刷新工具列表失败: ${err}`)
        })
      }
      return
    }

    // 其他消息，记录日志
    logger.debug(`[MCP] ${this.config.name} 收到未知消息: ${JSON.stringify(msg).slice(0, 200)}`)
  }

  /**
   * 发送 JSON-RPC 请求并等待响应。
   */
  private sendRequest(method: string, params: unknown, timeoutMs = 30000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('MCP 进程 stdin 不可用'))
        return
      }

      const id = this.nextId++
      const message = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`MCP 请求超时: ${method} (id=${id})`))
      }, timeoutMs)

      this.pendingRequests.set(id, {
        resolve: (val) => {
          clearTimeout(timer)
          resolve(val)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })

      this.writeMessage(message)
    })
  }

  /**
   * 发送 JSON-RPC 通知（无 id，无响应）。
   */
  private async sendNotification(method: string, params: unknown): Promise<void> {
    if (!this.process?.stdin) return

    const message = {
      jsonrpc: '2.0',
      method,
      params,
    }

    this.writeMessage(message)
  }

  /**
   * 将 JSON-RPC 消息写入 stdin（LSP 帧格式）。
   */
  private writeMessage(message: Record<string, unknown>): void {
    if (!this.process?.stdin) return

    const body = JSON.stringify(message)
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`
    this.process.stdin.write(header + body)
  }
}

// ==================== MCP 客户端 ====================

/**
 * 管理多个 MCP Server 连接的客户端。
 * 职责：启动/停止所有 Server、发现并注册工具到 ToolRegistry、动态工具更新。
 */
export class McpClient {
  private sessions = new Map<string, McpServerSession>()

  /**
   * 启动所有配置的 MCP Server。
   */
  async startAll(servers: McpServerConfig[]): Promise<void> {
    if (servers.length === 0) return

    logger.info(`[MCP] 启动 ${servers.length} 个 Server...`)

    // 并行启动所有 Server
    const results = await Promise.allSettled(
      servers.map(async (config) => {
        const session = new McpServerSession(config)
        const tools = await session.connect()
        this.sessions.set(config.name, session)

        // 监听工具列表变更
        session.onToolsListChanged(() => {
          // 工具列表变更在 registerToolsTo 中处理
        })

        return { name: config.name, tools }
      }),
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        logger.info(`[MCP] ${result.value.name} 启动成功，${result.value.tools.length} 个工具`)
      } else {
        logger.error(`[MCP] 启动失败: ${result.reason}`)
      }
    }

    const aliveCount = Array.from(this.sessions.values()).filter(s => s.isAlive()).length
    logger.info(`[MCP] 启动完成: ${aliveCount}/${servers.length} 个 Server 在线`)
  }

  /**
   * 关闭所有 MCP Server。
   */
  async stopAll(): Promise<void> {
    logger.info('[MCP] 关闭所有 Server...')

    await Promise.allSettled(
      Array.from(this.sessions.values()).map(session => session.disconnect()),
    )

    this.sessions.clear()
    logger.info('[MCP] 所有 Server 已关闭')
  }

  /**
   * 发现并注册所有 MCP 工具到 ToolRegistry。
   */
  registerToolsTo(registry: ToolRegistry): void {
    for (const [serverName, session] of this.sessions) {
      if (!session.isAlive()) continue

      const tools = session.getTools()
      for (const mcpTool of tools) {
        const toolDef = mcpToolToDefinition(mcpTool, serverName, session)
        registry.register(toolDef)
      }

      // 监听工具列表变更，动态更新 Registry
      session.onToolsListChanged((newTools: McpTool[]) => {
        this.refreshServerTools(serverName, registry, newTools)
      })
    }

    logger.info(`[MCP] 工具注册完成: ${registry.size} 个工具`)
  }

  /**
   * 刷新某个 Server 的工具列表（工具列表变更时调用）。
   */
  private refreshServerTools(
    serverName: string,
    registry: ToolRegistry,
    newTools?: McpTool[],
  ): void {
    const session = this.sessions.get(serverName)
    if (!session?.isAlive()) return

    const tools = newTools ?? session.getTools()
    const prefix = `mcp_${serverName}_`

    // 移除该 Server 的旧工具
    const oldNames = registry.getNamesByPrefix(prefix)
    for (const name of oldNames) {
      registry.unregister(name)
    }

    // 注册新工具
    for (const mcpTool of tools) {
      const toolDef = mcpToolToDefinition(mcpTool, serverName, session)
      registry.register(toolDef)
    }

    logger.info(`[MCP] ${serverName} 工具列表已刷新: ${oldNames.length} -> ${tools.length}`)
  }

  /**
   * 检查某个 Server 是否存活。
   */
  isServerAlive(serverName: string): boolean {
    return this.sessions.get(serverName)?.isAlive() ?? false
  }
}

// ==================== 工具转换辅助函数 ====================

/**
 * 将 MCP 工具名安全化（替换特殊字符为下划线）。
 */
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * 标准化 MCP 工具的 inputSchema 为 ToolParameters 格式。
 */
function normalizeMcpSchema(schema: Record<string, unknown>): ToolDefinition['parameters'] {
  // MCP inputSchema 通常是标准 JSON Schema
  const properties = (schema.properties as Record<string, unknown>) || {}
  const required = (schema.required as string[]) || undefined

  // 递归转换 properties 为 ToolParameterProperty 格式
  const convertedProps: Record<string, ToolDefinition['parameters']['properties'][string]> = {}
  for (const [key, value] of Object.entries(properties)) {
    const prop = value as Record<string, unknown>
    convertedProps[key] = {
      type: (prop.type as string) || 'string',
      description: (prop.description as string) || '',
      ...(prop.enum ? { enum: prop.enum as string[] } : {}),
      ...(prop.properties ? { properties: normalizeMcpSchema(prop).properties } : {}),
      ...(prop.required ? { required: prop.required as string[] } : {}),
      ...(prop.items ? { items: normalizeMcpSchemaItem(prop.items as Record<string, unknown>) } : {}),
    }
  }

  return {
    type: 'object',
    properties: convertedProps,
    required,
  }
}

/**
 * 标准化 MCP 的 items 定义。
 */
function normalizeMcpSchemaItem(item: Record<string, unknown>): ToolDefinition['parameters']['properties'][string] {
  return {
    type: (item.type as string) || 'string',
    description: (item.description as string) || '',
    ...(item.enum ? { enum: item.enum as string[] } : {}),
  }
}

/**
 * 将 MCP 工具转换为 ToolDefinition。
 */
function mcpToolToDefinition(
  mcpTool: McpTool,
  serverName: string,
  session: McpServerSession,
): ToolDefinition {
  const prefixedName = sanitizeToolName(`mcp_${serverName}_${mcpTool.name}`)
  return {
    name: prefixedName,
    description: mcpTool.description || `MCP 工具 ${mcpTool.name} (server: ${serverName})`,
    parameters: normalizeMcpSchema((mcpTool.inputSchema || {}) as Record<string, unknown>),
    checkFn: () => session.isAlive(),
    handler: async (args): Promise<ToolResult> => {
      try {
        const output = await session.callTool(mcpTool.name, args)
        return { success: true, output }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, output: `MCP 工具调用失败: ${message}` }
      }
    },
  }
}

// 导出 Session 类（供内部使用）
export { McpServerSession }
