/**
 * 智能体事件监听 hook
 *
 * 负责注册和清理所有智能体事件监听器：
 * - 流式文本输出（自动滚动）
 * - 思考过程输出（自动滚动）
 * - 新迭代开始（清空当前状态）
 * - 工具调用 / 工具结果
 * - 状态变更（处理最终响应和错误）
 */

import { useEffect, RefObject } from 'react'
import type { AgentState, AgentUIState } from './use-dynamic-island-types'
import { t } from '../i18n'

/**
 * 注册智能体事件监听
 * @param setAgentUI - AgentUIState 的 setState
 * @param thinkingRef - 思考区域的 ref（思考文字自动滚动）
 */
export function useAgentEvents(
  setAgentUI: React.Dispatch<React.SetStateAction<AgentUIState>>,
  thinkingRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const agent = window.electronAPI?.agent
    if (!agent) return

    const cleanupStreaming = agent.onStreaming((data: { text: string }) => {
      setAgentUI(prev => ({
        ...prev,
        streamingText: prev.streamingText + data.text,
        isAnalyzing: false,
        isPreparingToolCall: false,
      }))
    })

    const cleanupThinking = agent.onThinking((data: { text: string }) => {
      setAgentUI(prev => ({
        ...prev,
        thinkingText: prev.thinkingText + data.text,
        isAnalyzing: false,
        isPreparingToolCall: false,
      }))
    })

    const cleanupNewIteration = agent.onNewIteration(() => {
      setAgentUI(prev => ({
        ...prev,
        streamingText: '',
        thinkingText: '',
        toolCallIds: new Set(),
        toolCalls: [],
        toolResults: [],
        eventOrder: 0,
        isAnalyzing: true,
        isPreparingToolCall: false,
      }))
    })

    const cleanupToolCallingStarted = agent.onToolCallingStarted((data: {
      toolCallId: string
      toolName: string
    }) => {
      setAgentUI(prev => ({
        ...prev,
        isAnalyzing: false,
        isPreparingToolCall: true,
      }))
    })

    const cleanupToolCall = agent.onToolCall((data: {
      toolCallId: string
      toolName: string
      toolArgs?: Record<string, unknown>
    }) => {
      setAgentUI(prev => {
        const ids = new Set(prev.toolCallIds)
        ids.add(data.toolCallId)
        const nextOrder = prev.eventOrder + 1
        return {
          ...prev,
          eventOrder: nextOrder,
          toolCallIds: ids,
          toolCalls: [...prev.toolCalls, { ...data, order: nextOrder }],
          streamingText: '',
          thinkingText: '',
          isPreparingToolCall: false,
        }
      })
    })

    const cleanupToolResult = agent.onToolResult((data: {
      toolCallId: string
      toolName: string
      success: boolean
      output: string
      data?: Record<string, unknown>
    }) => {
      setAgentUI(prev => {
        const nextOrder = prev.eventOrder + 1
        // 提取 write_plan 结果到 planDocuments（跨迭代保留）
        let newPlanDocs = prev.planDocuments
        if (data.toolName === 'write_plan' && data.success && data.data?.content) {
          newPlanDocs = [...prev.planDocuments, {
            toolCallId: data.toolCallId,
            filename: (data.data.filename as string) || 'plan',
            content: data.data.content as string,
            filePath: (data.data.filePath as string) || '',
          }]
        }
        return {
          ...prev,
          eventOrder: nextOrder,
          toolResults: [...prev.toolResults, { ...data, order: nextOrder }],
          planDocuments: newPlanDocs,
        }
      })
    })

    const cleanupStateChange = agent.onStateChange((data: {
      state: string
      apiCall?: number
      budgetRemaining?: number
      finalResponse?: string | null
      errorMessage?: string | null
    }) => {
      const newState = data.state as AgentState
      setAgentUI(prev => {
        // 处理最终响应和错误信息
        // 注意：errorMessage 必须在 finalResponse 之前判断，
        // 因为出错时 finalResponse 可能包含 LLM 报错前已输出的部分文本，
        // 如果先判断 finalResponse 会导致错误信息被部分响应覆盖而不会显示
        let newStreamingText = prev.streamingText
        let newThinkingText = prev.thinkingText

        if (data.errorMessage && (newState === 'error' || newState === 'stopped')) {
          // 错误状态，显示错误信息（覆盖之前的流式文本）
          newStreamingText = `${t('agent.error')}: ${data.errorMessage}`
          // 错误时也清空思考内容
          newThinkingText = ''
        } else if (data.finalResponse && newState !== 'running') {
          // 运行结束时有最终回复，直接展示
          newStreamingText = data.finalResponse
          // 任务完成时清空思考内容，防止残留上一个任务的思考
          newThinkingText = ''
        }

        // 对话完成时，将当前轮归档到历史
        // 条件：有 finalResponse、有已发送消息、状态非 running
        const shouldArchive = data.finalResponse != null
          && newState !== 'running'
          && prev.sentMessages.length > 0
          && !data.errorMessage
        const newHistory = shouldArchive
          ? [...prev.conversationHistory, {
              question: prev.sentMessages[prev.sentMessages.length - 1].text,
              answer: data.finalResponse as string,
              timestamp: Date.now(),
            }]
          : prev.conversationHistory

        // 终端状态时记录计时结束时间
        const isTerminal = newState === 'idle' || newState === 'error' || newState === 'stopped' || newState === 'completed'
        const newPlanItems = isTerminal ? [] : prev.planItems
        const newTimerEnd = isTerminal && prev.timerStart != null && prev.timerEnd == null
          ? Date.now()
          : prev.timerEnd

        return {
          ...prev,
          agentState: newState,
          streamingText: newStreamingText,
          thinkingText: newThinkingText,
          planItems: newPlanItems,
          conversationHistory: newHistory,
          timerEnd: newTimerEnd,
          // 状态结束（非 running）时清除"正在分析"和"准备工具调用"标记
          isAnalyzing: newState !== 'running' ? false : prev.isAnalyzing,
          isPreparingToolCall: newState !== 'running' ? false : prev.isPreparingToolCall,
          // 归档后清空当前轮的消息展示（已存入历史）
          sentMessages: shouldArchive ? [] : prev.sentMessages,
        }
      })
    })

    const cleanupPlanUpdate = agent.onPlanUpdate((data: {
      todos: Array<{ id: string; content: string; status: string }>
    }) => {
      setAgentUI(prev => ({
        ...prev,
        planItems: data.todos as import('./use-dynamic-island-types').TodoItem[],
      }))
    })

    return () => {
      cleanupStreaming()
      cleanupThinking()
      cleanupNewIteration()
      cleanupToolCallingStarted()
      cleanupToolCall()
      cleanupToolResult()
      cleanupStateChange()
      cleanupPlanUpdate()
    }
  }, [])
}
