/**
 * 智能体工具执行
 *
 * 职责：并行执行一组工具调用，将结果追加到消息历史，触发事件。
 * 从 ai-agent.ts 拆分出来，减少主文件体积。
 */

import { AgentEvent, AgentMessage, ContentBlock, ToolCall, ToolResult } from '../../core/types/agent'
import { ToolRegistry } from './tool-registry'
import { createEvent } from './agent-events'
import { logger } from '../utils/logger'

/**
 * 工具执行所需的依赖（避免直接耦合到 AIAgent 类）
 */
interface ToolExecutionDeps {
  toolRegistry: ToolRegistry
  messages: AgentMessage[]
  interruptRequested: () => boolean
  /** 工具执行中止信号，interrupt() 时触发 */
  toolAbortSignal: AbortSignal
  emit: (event: AgentEvent) => void
  /** 计划模式标记，为 true 时拦截写操作工具 */
  planMode?: boolean
}

/**
 * 执行一组工具调用
 *
 * 使用 Promise.all 并行执行独立工具调用。
 *
 * @param toolCalls 工具调用列表（来自 LLM 响应）
 * @param deps 执行依赖
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  deps: ToolExecutionDeps,
): Promise<void> {
  if (toolCalls.length === 0) return

  const toolNames = toolCalls.map(tc => tc.name).join(', ')
  logger.info(`[AIAgent] 执行 ${toolCalls.length} 个工具调用: ${toolNames}`)

  // 预先解析所有工具参数（避免在事件循环和执行循环中重复解析）
  const parsedArgs: Record<string, Record<string, unknown>> = {}
  for (const tc of toolCalls) {
    try {
      parsedArgs[tc.id] = JSON.parse(tc.arguments)
    } catch {
      parsedArgs[tc.id] = {}
    }
  }

  // 发送工具开始事件
  for (const tc of toolCalls) {
    deps.emit(createEvent('tool_start', {
      toolCallId: tc.id,
      toolName: tc.name,
      toolArgs: parsedArgs[tc.id],
    }))
  }

  // 并行执行所有工具调用
  const results = await Promise.all(
    toolCalls.map(async (tc) => {
      if (deps.interruptRequested()) {
        return {
          toolCallId: tc.id,
          result: {
            success: false,
            output: `[工具执行被中断 — ${tc.name} 已跳过]`,
          } as ToolResult,
        }
      }

      const args = parsedArgs[tc.id]

      if (!deps.toolRegistry.has(tc.name)) {
        return {
          toolCallId: tc.id,
          result: {
            success: false,
            output: `错误: 工具 '${tc.name}' 未注册`,
          } as ToolResult,
        }
      }

      let result: ToolResult
      try {
        result = await deps.toolRegistry.dispatch(tc.name, args, undefined, deps.toolAbortSignal, deps.planMode)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result = {
          success: false,
          output: `执行工具 '${tc.name}' 时发生异常: ${message}`,
        }
      }

      return { toolCallId: tc.id, result }
    })
  )

  // 将工具结果追加到消息历史
  for (const { toolCallId, result } of results) {
    const tc = toolCalls.find(t => t.id === toolCallId)

    // 如果工具结果包含图片数据，构建 ContentBlock 数组
    let content: string | ContentBlock[]
    if (result.imageData) {
      content = [
        { type: 'text', text: result.output },
        { type: 'image', image: { data: result.imageData.base64, mimeType: result.imageData.mimeType } },
      ]
    } else {
      content = result.output
    }

    const toolMsg: AgentMessage = {
      role: 'tool',
      content,
      tool_call_id: toolCallId,
      name: tc?.name || 'unknown',
      timestamp: Date.now(),
    }
    deps.messages.push(toolMsg)

    // 对于包含图片的工具结果，额外追加一条 user 消息携带图片
    // 这样 OpenAI 适配器也能将图片发送给模型（OpenAI tool 角色不支持 image_url）
    if (result.imageData) {
      const imageUserMsg: AgentMessage = {
        role: 'user',
        content: [
          {
            type: 'image',
            image: { data: result.imageData.base64, mimeType: result.imageData.mimeType },
          },
        ],
        timestamp: Date.now(),
      }
      deps.messages.push(imageUserMsg)
    }

    deps.emit(createEvent('tool_result', {
      toolCallId,
      toolName: tc?.name || 'unknown',
      success: result.success,
      outputLength: result.output.length,
      ...(result.data ? { data: result.data } : {}),
    }))

    logger.debug(
      `[AIAgent] 工具 '${tc?.name}' 完成: ` +
      `success=${result.success} output=${result.output.slice(0, 100)}${result.output.length > 100 ? '...' : ''}`
    )
  }
}
