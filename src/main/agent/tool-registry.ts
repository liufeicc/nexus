/**
 * 工具注册系统
 *
 * 作用：统一管理所有工具的注册、查询和调用。类似"工具黄页"。
 *
 * 核心方法：
 * - register()    — 注册一个工具
 * - getDefinitions() — 获取所有工具的 API 格式 schema（传给 LLM 用）
 * - dispatch()    — 根据名字调用工具
 * - has()         — 检查工具是否存在
 * - remove()      — 移除一个工具
 */

import { ToolDefinition, ToolResult } from '../../core/types/agent'
import { logger } from '../utils/logger'

/**
 * 工具注册表
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()

  /** 只读工具白名单 — 计划模式下仅这些工具可用 */
  private static readonly READ_ONLY_TOOLS = new Set([
    'read_file',
    'search_files',
    'web_search',
    'web_extract',
    'email_read',
    'email_view',
    'nexus_profile_read',
    'nexus_profile_scan',
    'skills_list',
    'skill_view',
    'tasks_list',
    'task_view',
    'memory_search',
    'clarify',
    'exit_plan_mode',
    'enter_plan_mode',
  ])

  /**
   * 判断工具是否为只读工具
   *
   * 只读工具在计划模式下保持可用，写操作工具被过滤掉。
   */
  static isReadOnlyTool(name: string): boolean {
    return ToolRegistry.READ_ONLY_TOOLS.has(name)
  }

  /**
   * 注册一个工具
   *
   * @param tool 工具定义（名字、描述、参数 schema、handler 函数）
   *
   * 示例：
   *   registry.register({
   *     name: 'read_file',
   *     description: '读取文件内容',
   *     parameters: { type: 'object', properties: { path: { type: 'string', description: '文件路径' } } },
   *     handler: async (args) => { ... }
   *   })
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      logger.warn(`[ToolRegistry] 工具 '${tool.name}' 已存在，将被覆盖`)
    }
    this.tools.set(tool.name, tool)
    logger.debug(`[ToolRegistry] 注册工具: ${tool.name}`)
  }

  /**
   * 批量注册工具
   *
   * @param tools 工具定义数组
   */
  registerMany(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool)
    }
  }

  /**
   * 获取所有工具的 API 格式 schema（异步，支持 checkFn 过滤）
   *
   * 返回格式兼容 OpenAI 和 Anthropic API，可直接传给 LLM 的 tools 参数。
   * 如果工具定义了 checkFn，会调用它来判断工具是否可用。
   *
   * @returns 工具定义数组，每个包含 { name, description, parameters }
   */
  async getDefinitions(): Promise<Array<{ name: string; description: string; parameters: object }>> {
    const result: Array<{ name: string; description: string; parameters: object }> = []

    for (const [name, def] of this.tools) {
      // 如果工具有 checkFn，执行可用性检查
      if (def.checkFn) {
        try {
          const available = await def.checkFn()
          if (!available) {
            logger.debug(`[ToolRegistry] 工具 '${name}' checkFn 未通过，对 LLM 不可见`)
            continue
          }
        } catch (err) {
          logger.warn(`[ToolRegistry] 工具 '${name}' checkFn 异常: ${err}`)
          continue
        }
      }
      result.push({
        name,
        description: def.description,
        parameters: def.parameters,
      })
    }

    return result
  }

  /**
   * 获取只读工具 + write_plan 的 API 格式 schema（计划模式下使用）
   *
   * 仅返回白名单中的只读工具和 write_plan 工具，
   * 过滤掉所有写操作工具，防止 LLM 在计划模式下执行修改操作。
   */
  async getReadOnlyDefinitions(): Promise<Array<{ name: string; description: string; parameters: object }>> {
    const result: Array<{ name: string; description: string; parameters: object }> = []

    for (const [name, def] of this.tools) {
      // 仅保留只读工具或 write_plan 工具
      if (!ToolRegistry.isReadOnlyTool(name) && name !== 'write_plan') {
        continue
      }

      // 如果工具有 checkFn，执行可用性检查
      if (def.checkFn) {
        try {
          const available = await def.checkFn()
          if (!available) {
            logger.debug(`[ToolRegistry] 只读工具 '${name}' checkFn 未通过，对 LLM 不可见`)
            continue
          }
        } catch (err) {
          logger.warn(`[ToolRegistry] 只读工具 '${name}' checkFn 异常: ${err}`)
          continue
        }
      }
      result.push({
        name,
        description: def.description,
        parameters: def.parameters,
      })
    }

    return result
  }

  /**
   * 获取单个工具定义
   *
   * @param name 工具名称
   * @returns 工具定义，不存在时返回 undefined
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  /**
   * 检查工具是否存在
   *
   * @param name 工具名称
   * @returns 存在返回 true
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * 移除一个工具
   *
   * @param name 工具名称
   * @returns 移除成功返回 true，不存在返回 false
   */
  remove(name: string): boolean {
    if (!this.tools.has(name)) return false
    this.tools.delete(name)
    logger.debug(`[ToolRegistry] 移除工具: ${name}`)
    return true
  }

  /**
   * 注销一个工具（remove 的别名，语义上用于动态工具移除场景，如 MCP 工具列表变更）
   */
  unregister(name: string): boolean {
    return this.remove(name)
  }

  /**
   * 获取已注册工具数量
   */
  get size(): number {
    return this.tools.size
  }

  /**
   * 获取所有已注册的工具名称
   */
  get names(): string[] {
    return Array.from(this.tools.keys())
  }

  /**
   * 按前缀获取已注册的工具名称
   *
   * @param prefix 工具名前缀
   * @returns 匹配前缀的工具名列表
   */
  getNamesByPrefix(prefix: string): string[] {
    return Array.from(this.tools.keys()).filter(n => n.startsWith(prefix))
  }

  /**
   * 分派工具调用
   *
   * 根据工具名称和参数，找到对应的 handler 并执行。
   *
   * @param name 工具名称
   * @param args 工具参数（来自 LLM 的工具调用）
   * @param onUpdate 可选的进度回调（用于长时间运行的工具，如终端命令）
   * @returns 工具执行结果
   * @throws Error 如果工具不存在
   */
  async dispatch(
    name: string,
    args: Record<string, unknown>,
    onUpdate?: (chunk: string) => void,
    signal?: AbortSignal,
    planMode?: boolean,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)

    if (!tool) {
      const available = Array.from(this.tools.keys()).join(', ')
      throw new Error(
        `工具 '${name}' 未注册。可用工具: ${available || '无'}`
      )
    }

    // 计划模式下，拦截非只读且非 write_plan 的工具调用（防御层）
    if (planMode && !ToolRegistry.isReadOnlyTool(name) && name !== 'write_plan') {
      logger.warn(`[ToolRegistry] 计划模式下拦截写操作工具: ${name}`)
      return {
        success: false,
        output: `计划模式下不允许使用工具 '${name}'。当前仅允许只读操作和 write_plan 工具。`,
      }
    }

    // 序列化 args 避免打印 [object Object]
    let argsPreview: string
    try {
      const str = JSON.stringify(args)
      argsPreview = str && str.length > 200 ? str.slice(0, 200) + '...' : str || '{}'
    } catch {
      argsPreview = String(args)
    }
    logger.debug(`[ToolRegistry] 调用工具: ${name} ${argsPreview}`)

    try {
      const result = await tool.handler(args, onUpdate, signal)
      logger.debug(`[ToolRegistry] 工具 '${name}' 完成`, {
        success: result.success,
        outputLength: result.output.length,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`[ToolRegistry] 工具 '${name}' 执行异常:`, message)
      return {
        success: false,
        output: `执行工具 '${name}' 时发生异常: ${message}`,
      }
    }
  }

  /**
   * 清空所有已注册的工具
   */
  clear(): void {
    this.tools.clear()
    logger.debug('[ToolRegistry] 已清空所有工具')
  }
}
