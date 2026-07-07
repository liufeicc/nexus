/**
 * 记忆提取 Agent
 *
 * 在"清除历史对话"或"总结历史对话"时触发，分析完整对话历史，
 * 自主判断哪些信息值得长期保存，通过记忆工具写入 memory_entries。
 *
 * 去重和更新逻辑：
 * - 先 memory_search 搜索现有记忆
 * - 语义相同 → 跳过
 * - 内容已变 → memory_replace 更新
 * - 无相关 → memory_add 新增
 */

import { AgentConfig, AgentMessage } from '../../core/types/agent'
import { AuxiliaryClient } from './auxiliary-client'
import { SqliteMemoryProvider } from './memory/memory-manager'
import { DatabaseService } from '../services/database.service'
import { logger } from '../utils/logger'

/**
 * 记忆提取 Agent 配置
 */
export interface MemoryExtractorConfig {
  /** Nexus 会话 ID（用于记忆隔离） */
  nexusSessionId: string
  /** 主 Agent 配置（复用 provider/apiKey/apiUrl） */
  parentConfig: AgentConfig
  /** 副模型配置（可选） */
  summaryModelConfig?: AgentConfig
}

/**
 * 记忆提取 Agent
 */
export class MemoryExtractorAgent {
  private config: MemoryExtractorConfig
  private auxClient: AuxiliaryClient | null = null

  constructor(config: MemoryExtractorConfig) {
    this.config = config
  }

  /**
   * 执行记忆提取（异步，不阻塞）
   */
  async extract(messages: AgentMessage[]): Promise<void> {
    logger.info(`[MemoryExtractor] extract() 被调用, messages.length=${messages.length}`)

    if (messages.length < 4) {
      logger.info('[MemoryExtractor] 消息数不足 4 条，跳过提取')
      return
    }

    try {
      logger.info('[MemoryExtractor] 开始获取 aux client')
      const aux = this.getOrCreateAuxClient()
      logger.info('[MemoryExtractor] aux client 获取成功')

      const memoryProvider = this.getMemoryProvider()
      logger.info('[MemoryExtractor] memory provider 获取成功')

      const toolSchemas = memoryProvider.getToolSchemas()
      logger.info(`[MemoryExtractor] tool schemas 数量: ${toolSchemas.length}`)
      toolSchemas.forEach(s => logger.info(`[MemoryExtractor]   - ${s.name}: ${s.description}`))

      // 注入 toolDispatch -> 直接路由到 memoryProvider
      aux.setToolDispatch((name, args) => {
        logger.info(`[MemoryExtractor] 工具调用: ${name}(${JSON.stringify(args).slice(0, 200)})`)
        return memoryProvider.handleToolCall(name, args)
      })

      const systemPrompt = this.buildSystemPrompt()
      const userPrompt = this.buildUserPrompt(messages)
      logger.info(`[MemoryExtractor] system prompt 长度: ${systemPrompt.length} chars`)
      logger.info(`[MemoryExtractor] user prompt 长度: ${userPrompt.length} chars`)

      logger.info(`[MemoryExtractor] 开始提取: ${messages.length} 条消息`)

      const result = await aux.callWithTools({
        systemPrompt,
        userPrompt,
        tools: toolSchemas.map(s => ({
          name: s.name,
          description: s.description,
          parameters: s.parameters,
        })),
        maxIterations: 8,
      })

      logger.info(`[MemoryExtractor] callWithTools 返回: success=${result.success}, iterationCount=${result.iterationCount}`)

      if (result.success) {
        logger.info(`[MemoryExtractor] 提取完成, 迭代 ${result.iterationCount} 次`)
      } else {
        logger.warn(`[MemoryExtractor] 提取达到最大迭代次数 (${result.iterationCount})`)
      }
    } catch (err) {
      logger.error('[MemoryExtractor] 提取异常:', err)
    }
  }

  // ==================== 内部方法 ====================

  /**
   * System Prompt
   */
  private buildSystemPrompt(): string {
    return (
      '# 角色\n\n'
      + '你是一个记忆提取 Agent。你的任务是分析对话历史，提取值得长期保存的信息到记忆系统。\n\n'
      + '# 记忆整合原则（最重要）\n\n'
      + '- **一个任务 = 一条记忆**。同一任务的背景、做法、涉及文件、技术方案，必须合并为一条完整记忆\n'
      + '- **正面示例**：\n'
      + '  "开发了一个 Python 脚本 /home/liufei/.Nexus/env/compare_ddl.py，使用正则解析 PostgreSQL DDL 中的 CREATE TABLE 语句，对比 Template 和 Product 两个数据库文件的表级（仅 A/仅 B/共有）和字段级差异（仅 A/仅 B/共有字段），输出包含基本信息、差异列表、详细对比的结构化报告"\n'
      + '- **反例（不要这样做）**：\n'
      + '  拆成多条："需求是对比 DDL" / "开发了 compare_ddl.py 脚本" / "Template 有 82 个表，Product 有 74 个表"\n'
      + '- **例外**：如果某个技术点/规则具有独立的通用价值（跨任务可复用），可作为单独记忆提取\n\n'
      + '# 工作流程（严格执行）\n\n'
      + '1. 先用 memory_search 搜索现有记忆（limit 至少为 5），查找与你要提取的信息相关的记录\n'
      + '2. 将搜索结果与你要新增的内容逐一比较语义相似度：\n'
      + '   - 如果已有语义相同或高度相似的记录 → 跳过，绝对不要重复添加\n'
      + '   - 如果主题相关但内容有重要更新/变化 → 用 memory_replace 更新旧记录\n'
      + '   - 如果无相关记忆 → 用 memory_add 新增\n'
      + '3. 重复以上步骤，直到所有值得记录的信息都已处理\n'
      + '4. 如果 memory_add 返回"存在语义相似的已有记忆"，说明服务端检测到重复，请改用 memory_replace 或跳过\n\n'
      + '# 应该记录什么\n\n'
      + '- 用户偏好和习惯（回复语言、代码风格、工作流程偏好等）\n'
      + '- 项目结构和关键文件路径（目录组织、模块职责、约定做法）\n'
      + '- 重要的技术决策及其原因（为什么选A不选B）\n'
      + '- 用户明确要求的规则和约束\n'
      + '- 反复出现的问题和对应的解决方案\n'
      + '- 环境配置（API key 位置、数据库连接、部署方式等）\n'
      + '- 对文件的重大操作（重构、重命名、迁移等高层级变更）\n\n'
      + '# 不应该记录什么\n\n'
      + '- 一次性的执行结果和数据（如对比结果统计数字、特定查询的返回结果）\n'
      + '- 仅对当前会话/任务有意义的临时结论\n'
      + '- 临时性的工具调用细节（读了一个文件内容、运行了一条命令）\n'
      + '- 中间过程的错误和重试（只记录最终解决方案）\n'
      + '- 寒暄和过渡语\n'
      + '- 已经记录过的重复信息\n'
      + '- 具体的代码改动（可从 git 历史查到）\n\n'
      + '# 记录格式\n\n'
      + '- 用中文记录（除非对话本身是英文）\n'
      + '- 包含必要的上下文，如文件名、目录路径、技术名称\n'
      + '- 文件路径写完整\n'
      + '- 一条记忆涵盖一个完整任务的所有关键信息（背景 + 做法 + 产出）\n\n'
      + '# scope 选择\n\n'
      + '- scope="user"：仅用户个人偏好和习惯\n'
      + '- scope="memory"：其他所有内容（技术决策、项目事实、文件操作等）\n\n'
      + '# 完成\n\n'
      + '完成所有提取后，输出一句简短总结即可。\n'
    )
  }

  /**
   * User Prompt — 将对话序列化为可读格式
   */
  private buildUserPrompt(messages: AgentMessage[]): string {
    const lines: string[] = []

    for (const msg of messages) {
      const timeStr = msg.timestamp
        ? new Date(msg.timestamp).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'unknown'

      if (msg.role === 'user') {
        const text = typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content)
        lines.push(`[${timeStr}] User: ${text}`)
      } else if (msg.role === 'assistant') {
        if (msg.tool_calls?.length) {
          const toolCalls = msg.tool_calls
            .map(tc => `${tc.name}(${tc.arguments})`)
            .join(', ')
          const text = typeof msg.content === 'string' && msg.content
            ? ` — ${msg.content}`
            : ''
          lines.push(`[${timeStr}] Assistant: [工具调用: ${toolCalls}]${text}`)
        } else {
          const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          const truncated = text.length > 2000
            ? text.slice(0, 2000) + '...[已截断]'
            : text
          lines.push(`[${timeStr}] Assistant: ${truncated}`)
        }
      } else if (msg.role === 'tool') {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        const truncated = text.length > 500
          ? text.slice(0, 500) + '...[已截断]'
          : text
        lines.push(`[${timeStr}] Tool(${msg.name || 'unknown'}): ${truncated}`)
      }
    }

    return `以下是完整的对话历史，请分析并提取值得记忆的信息：\n\n${lines.join('\n\n')}`
  }

  /**
   * 获取或创建辅助客户端
   */
  private getOrCreateAuxClient(): AuxiliaryClient {
    if (this.auxClient) return this.auxClient

    this.auxClient = new AuxiliaryClient({
      parentConfig: this.config.parentConfig,
      standaloneConfig: this.config.summaryModelConfig,
      timeout: 180000, // 3 分钟超时
    })
    return this.auxClient
  }

  /**
   * 获取记忆提供者
   *
   * 直接创建 SqliteMemoryProvider，不经过 MemoryManager 包装。
   * 记忆提取器只需要工具 schema 和 handler，不需要 manager 的
   * 快照/prefetch/sync 等会话状态管理。
   */
  private getMemoryProvider(): SqliteMemoryProvider {
    const memConfig = this.loadMemoryConfig()
    return new SqliteMemoryProvider(memConfig, this.config.nexusSessionId)
  }

  /**
   * 从数据库读取记忆配置
   */
  private loadMemoryConfig() {
    try {
      const db = DatabaseService.getInstance()
      if (!db) return { memoryMaxChars: 2200, userMaxChars: 1375 }
      const configDAO = db.getConfigDAO()
      const memConfig = configDAO.get('memoryConfig') as {
        memoryMaxChars?: number
        userMaxChars?: number
      } | null
      return {
        memoryMaxChars: memConfig?.memoryMaxChars ?? 2200,
        userMaxChars: memConfig?.userMaxChars ?? 1375,
      }
    } catch {
      return { memoryMaxChars: 2200, userMaxChars: 1375 }
    }
  }
}
