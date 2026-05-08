/**
 * 智能体 LLM 调用桥接层
 *
 * 职责：封装 LLM 调用（流式/非流式）、系统提示构建、API 消息构建。
 * 从 ai-agent.ts 拆分出来，减少主文件体积。
 */

import { AgentMessage } from '../../core/types/agent'
import { LLMClient, LLMResponse, StreamCallbacks } from './llm-client'
import { ToolRegistry } from './tool-registry'
import { buildSystemPrompt, BuildSystemPromptOptions } from './prompt-builder'
import { AgentEventManager, createEvent } from './agent-events'
import { logger } from '../utils/logger'

/**
 * LLM 桥接配置
 */
interface LlmBridgeConfig {
  model: string
  promptBuilderOptions?: Omit<BuildSystemPromptOptions, 'model'>
}

/**
 * 创建 LLM 桥接实例
 */
export function createLlmBridge(
  config: LlmBridgeConfig,
  llmClient: LLMClient,
  toolRegistry: ToolRegistry,
  eventManager: AgentEventManager,
  skillBlockFn?: () => string,
) {
  /**
   * 构建系统提示词
   */
  function getSystemPrompt(): string {
    return buildSystemPrompt({
      model: config.model,
      platform: config.promptBuilderOptions?.platform || 'cli',
      extraPrompt: config.promptBuilderOptions?.extraPrompt,
      memoryBlock: config.promptBuilderOptions?.memoryBlock,
      skillBlock: skillBlockFn?.(),
    })
  }

  /**
   * 构建 API 消息（系统提示 + 消息历史）
   */
  function buildApiMessages(systemPrompt: string): AgentMessage[] {
    return [
      { role: 'system', content: systemPrompt, timestamp: Date.now() },
      ...[], // 消息历史由调用方提供
    ]
  }

  /**
   * 非流式 LLM 调用
   */
  async function callLLMNonStream(
    systemPrompt: string,
    messages: AgentMessage[],
  ): Promise<LLMResponse> {
    const apiMessages: AgentMessage[] = [
      { role: 'system' as const, content: systemPrompt, timestamp: Date.now() },
      ...messages,
    ]
    const toolDefs = await toolRegistry.getDefinitions()

    // 打印发送给大模型的完整消息
    logger.info('===== 发送给大模型的完整消息 (非流式) =====')
    logger.info(`[LLM Bridge] 消息总数: ${apiMessages.length}, 工具数: ${toolDefs.length}`)
    for (let i = 0; i < apiMessages.length; i++) {
      const msg = apiMessages[i]
      const contentPreview = typeof msg.content === 'string'
        ? msg.content.substring(0, 500) + (msg.content!.length > 500 ? '...' : '')
        : JSON.stringify(msg.content).substring(0, 500)
      logger.info(`[LLM Bridge] [${i}] role=${msg.role}, content_length=${msg.content?.length || 0}, preview=${contentPreview}`)
    }
    if (toolDefs.length > 0) {
      logger.info(`[LLM Bridge] 工具列表: ${toolDefs.map(t => t.name).join(', ')}`)
    }
    logger.info('==========================================')

    return llmClient.chat(apiMessages, {
      tools: toolDefs.length > 0 ? toolDefs : undefined,
    })
  }

  /**
   * 流式 LLM 调用
   */
  async function callLLMStream(
    systemPrompt: string,
    messages: AgentMessage[],
  ): Promise<LLMResponse> {
    const toolDefs = await toolRegistry.getDefinitions()

    let fullContent = ''

    const callbacks: StreamCallbacks = {
      onChunk: (text: string) => {
        fullContent += text
        eventManager.emit(createEvent('message_delta', { text }))
      },
      onThinking: (text: string) => {
        eventManager.emit(createEvent('thinking', { text }))
      },
      onDone: () => {
        // 完成（实际返回值通过 streamChat 的 Promise 获取）
      },
      onError: (error: Error) => {
        throw error
      },
    }

    const apiMessages: AgentMessage[] = [
      { role: 'system' as const, content: systemPrompt, timestamp: Date.now() },
      ...messages,
    ]

    // 打印发送给大模型的完整消息
    logger.info('===== 发送给大模型的完整消息 (流式) =====')
    logger.info(`[LLM Bridge] 消息总数: ${apiMessages.length}, 工具数: ${toolDefs.length}`)
    for (let i = 0; i < apiMessages.length; i++) {
      const msg = apiMessages[i]
      const contentPreview = typeof msg.content === 'string'
        ? msg.content.substring(0, 500) + (msg.content!.length > 500 ? '...' : '')
        : JSON.stringify(msg.content).substring(0, 500)
      logger.info(`[LLM Bridge] [${i}] role=${msg.role}, content_length=${msg.content?.length || 0}, preview=${contentPreview}`)
    }
    if (toolDefs.length > 0) {
      logger.info(`[LLM Bridge] 工具列表: ${toolDefs.map(t => t.name).join(', ')}`)
    }
    logger.info('==========================================')

    return llmClient.streamChat(apiMessages, callbacks, {
      tools: toolDefs.length > 0 ? toolDefs : undefined,
    })
  }

  return {
    getSystemPrompt,
    buildApiMessages,
    callLLMNonStream,
    callLLMStream,
  }
}

export type LlmBridge = ReturnType<typeof createLlmBridge>
