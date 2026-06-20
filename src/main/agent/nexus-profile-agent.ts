/**
 * 目录说明生成 Agent
 *
 * 轻量 Agent，仿照主 Agent 的 LLMClient + ToolRegistry + executeToolCalls 模式，
 * 但简化掉上下文压缩、事件系统、中断处理、记忆系统等复杂逻辑。
 *
 * 职责：自主探索目标目录，使用工具读取文件和搜索，最终调用 nexus_profile_write 生成 .NEXUS.md 文件。
 */

import { AgentConfig, AgentMessage } from '../../core/types/agent'
import { LLMClient } from './llm-client'
import { ToolRegistry } from './tool-registry'
import { executeToolCalls } from './agent-tool-execution'
import { loadAgentConfig, getAppLanguageName } from '../services/agent-service'
import { readFileTool, searchFilesTool, bindFileToolSession, bindSearchState } from './tools/file-tools'
import { nexusProfileWriteTool } from './tools/nexus-profile-tool'
import { logger } from '../utils/logger'

/**
 * 目录说明生成 Agent
 */
export class NexusProfileAgent {
  /**
   * 生成目标目录的 .NEXUS.md 文件
   *
   * @param targetDir 目标目录的绝对路径
   * @returns 生成结果 { success, content?, error? }
   */
  static async generate(
    targetDir: string,
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    // 1. 获取 LLM 配置
    const config = loadAgentConfig()
    if (!config) {
      return { success: false, error: '未找到模型配置' }
    }

    const llmConfig: AgentConfig = {
      provider: config.provider,
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      model: config.model,
      maxIterations: 80,
      timeout: config.timeout ?? 600000,
      maxRetries: config.maxRetries ?? 3,
    }

    // 2. 创建 LLM 客户端
    const llmClient = new LLMClient(llmConfig)

    // 3. 创建工具注册表，注册精简工具集
    const toolRegistry = new ToolRegistry()

    // bindFileToolSession / bindSearchState 需要完整的接口实现
    // 这里提供完整的空实现，去重/循环检测等功能正常工作但不跨会话持久化
    const readCache = new Map()
    let readTrackerState = { lastKey: null as string | null, count: 0 }
    let searchState = { lastKey: null as string | null, count: 0 }
    const readTimestamps = new Map()

    bindFileToolSession({
      getReadCache: () => readCache,
      getReadTrackerState: () => readTrackerState,
      setReadTrackerState: (k, c) => { readTrackerState = { lastKey: k, count: c } },
      resetReadTracker: () => { readCache.clear(); readTrackerState = { lastKey: null, count: 0 } },
      resetSearchTracker: () => { searchState = { lastKey: null, count: 0 } },
      getReadTimestamps: () => readTimestamps,
      getCurrentModel: () => config.model,
    })
    bindSearchState(
      () => searchState,
      (k, c) => { searchState = { lastKey: k, count: c } },
    )

    toolRegistry.register(readFileTool)
    toolRegistry.register(searchFilesTool)
    toolRegistry.register(nexusProfileWriteTool)

    // 4. 独立消息历史（不与主 Agent 混合）
    const messages: AgentMessage[] = []

    // 5. 构建 system prompt
    const languageName = getAppLanguageName()

    const systemPrompt = [
      '你是一个目录分析专家。你的任务是快速了解目标目录的结构和作用，',
      '然后生成一份精简的 .NEXUS.md 目录说明文件。\n',
      '## 工作流程',
      '1. 读取目标目录根目录下的关键文件（如配置文件、README、入口文件等）',
      '2. 使用 search_files 工具快速扫描目录结构，识别主要子目录',
      '3. 最后使用 nexus_profile_write 工具生成 .NEXUS.md 文件\n',
      '## .NEXUS.md 编写要求',
      `- 使用${languageName}编写`,
      '- 包含：概述、目录结构、作用描述、重要文件说明',
      '- 结构清晰，使用 Markdown 格式',
      '- 内容精炼，突出关键信息\n',
      '## 字数限制（硬性约束）',
      '- 全文（含 Markdown 标记）绝对不能超过 1000 字符',
      '- 目录结构用紧凑的单行或两行列表表示，不要画树形图',
      '- 每个重要文件的说明控制在 20 字以内\n',
      '## 注意事项',
      '- 忽略 node_modules、.git、dist、.next、.nuxt、coverage、.cache、.vite 等和功能无关目录',
      '- 不要读取二进制文件、图片、视频等',
      '- 探索要浅层快速，不要深入太多子目录',
      `- 目标目录：${targetDir}`,
    ].join('\n')

    // 添加 system message
    messages.push({ role: 'system', content: systemPrompt, timestamp: Date.now() })

    // 添加用户消息
    messages.push({
      role: 'user',
      content: `请快速探索目录 "${targetDir}" 并生成 .NEXUS.md 目录说明文件。注意：全文必须不超过 1000 字符。`,
      timestamp: Date.now(),
    })

    // 6. 根据 accessModes 决定调用策略
    const accessModes = config.accessModes ?? []
    const hasStream = accessModes.includes('stream')

    // 7. 运行工具循环
    const maxIterations = 80
    let iterations = 0
    let finalResponse: string | null = null

    // 工具执行依赖（stub 实现）
    const toolDeps = {
      toolRegistry,
      messages,
      interruptRequested: () => false,
      toolAbortSignal: new AbortController().signal,
      emit: () => {}, // 后台任务不需要事件
    }

    while (iterations < maxIterations) {
      iterations++
      logger.info(`[NexusProfileAgent] 迭代 #${iterations}/${maxIterations}`)

      try {
        let response

        // 根据 accessModes 选择调用方式
        if (hasStream) {
          // 有 stream：先用 streamChat
          response = await llmClient.streamChat(messages, {
            onChunk: () => {}, // 后台任务不需要实时输出
            onDone: () => {},
            onError: () => {},
          }, {
            tools: await toolRegistry.getDefinitions(),
          })
        } else {
          // 只有 invoke：用 chat
          response = await llmClient.chat(messages, {
            tools: await toolRegistry.getDefinitions(),
          })
        }

        if (response.toolCalls.length > 0) {
          // 有工具调用，记录 assistant 响应
          const assistantMsg: AgentMessage = {
            role: 'assistant',
            content: response.content || null,
            tool_calls: response.toolCalls.map(tc => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            })),
            timestamp: Date.now(),
          }
          messages.push(assistantMsg)

          // 执行工具
          await executeToolCalls(response.toolCalls, toolDeps)
        } else {
          // 无工具调用，说明最终响应已生成
          finalResponse = response.content
          logger.info(`[NexusProfileAgent] 生成完成，共 ${iterations} 次迭代`)
          break
        }
      } catch (error) {
        const llmError = llmClient.classifyError(error)
        logger.error(`[NexusProfileAgent] LLM 调用失败: ${llmError.message} (${llmError.type})`)

        if (llmError.type === 'context_too_long') {
          // 上下文超长，裁剪中间消息（保留 system 和最近几条）
          const trimmed = trimMessages(messages)
          if (!trimmed) {
            return { success: false, error: '上下文超长且无法裁剪' }
          }
          continue
        }

        // 其他错误直接返回
        return {
          success: false,
          error: `LLM 调用失败: ${llmError.message}`,
        }
      }
    }

    if (iterations >= maxIterations) {
      return {
        success: false,
        error: `达到最大迭代次数 (${maxIterations})，生成未完成`,
      }
    }

    return {
      success: true,
      content: finalResponse || '',
    }
  }
}

/**
 * 裁剪消息历史，保留 system message 和最近的消息
 */
function trimMessages(messages: AgentMessage[]): boolean {
  // 保留 system message（索引 0）和最近 4 条消息
  if (messages.length <= 5) return false

  const systemMsg = messages[0]
  const recent = messages.slice(-4)
  messages.length = 0
  messages.push(systemMsg, ...recent)
  logger.info(`[NexusProfileAgent] 消息已裁剪，保留 system + 最近 4 条`)
  return true
}
