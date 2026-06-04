/**
 * 灵动岛可滚动内容区域组件
 *
 * 展示智能体的输出内容，按时间顺序自上而下排列：
 * - 历史对话展开区
 * - 用户已发送消息
 * - 任务计划（TodoList）
 * - 思考/推理过程
 * - LLM 分析中过渡提示
 * - 工具调用与结果（按时序混合）
 * - 流式文本输出（含计划文档）
 * - 准备工具调用过渡提示
 * - 拖拽提示层
 */

import React from 'react'
import { useI18n } from '../../i18n'
import type { AgentUIState, ToolCallInfo, ToolResultInfo } from '../../hooks/use-dynamic-island-types'
import { truncate } from './use-dynamic-island-utils'
import { PlanDocumentCard } from './DynamicIslandPlanDoc'
import { ElapsedTimer } from './ElapsedTimer'

interface DynamicIslandContentProps {
  agentUI: AgentUIState
  isAgentRunning: boolean
  enableVision: boolean
  isDragOver: boolean
  expandedHistory: boolean
  setExpandedHistory: React.Dispatch<React.SetStateAction<boolean>>
  expandedMsgIndex: number | null
  setExpandedMsgIndex: React.Dispatch<React.SetStateAction<number | null>>
  planExpanded: boolean
  setPlanExpanded: React.Dispatch<React.SetStateAction<boolean>>
  thinkingRef: React.MutableRefObject<HTMLDivElement | null>
  streamingRef: React.MutableRefObject<HTMLDivElement | null>
}

export function DynamicIslandContent({
  agentUI,
  isAgentRunning,
  enableVision,
  isDragOver,
  expandedHistory,
  setExpandedHistory,
  expandedMsgIndex,
  setExpandedMsgIndex,
  planExpanded,
  setPlanExpanded,
  thinkingRef,
  streamingRef,
}: DynamicIslandContentProps) {
  const { t } = useI18n()

  // 判断是否有内容可展示
  const hasContent = agentUI.sentMessages.length > 0
    || agentUI.thinkingText
    || agentUI.isAnalyzing
    || agentUI.toolCalls.length > 0
    || agentUI.toolResults.length > 0
    || agentUI.streamingText
    || agentUI.planItems.length > 0
    || agentUI.planDocuments.length > 0
    || agentUI.conversationHistory.length > 0
    || isDragOver

  if (!hasContent) return null

  return (
    <div className="island-agent-scrollable">

      {/* 历史对话切换条 */}
      {agentUI.conversationHistory.length > 0 && (
        <div
          className={`island-history-toggle${expandedHistory ? ' expanded' : ''}`}
          onClick={(e) => { e.stopPropagation(); setExpandedHistory(prev => !prev) }}
        >
          <span className="island-history-toggle-label">{t('dynamicIsland.historyToggle', { count: agentUI.conversationHistory.length })}</span>
          <span className="island-history-toggle-action">{t('dynamicIsland.historyClickView')}</span>
        </div>
      )}

      {/* 展开的历史对话列表 */}
      {expandedHistory && (
        <div className="island-history-expanded">
          {agentUI.conversationHistory.map((turn, idx) => (
            <div key={idx} className="island-history-pair">
              <div className="island-history-question">
                <span className="island-role-label-q">{t('dynamicIsland.you')}</span>
                <span className="island-role-text">{turn.question}</span>
              </div>
              <div className="island-history-answer">
                <span className="island-role-label-a">{t('dynamicIsland.nexus')}</span>
                <span className="island-role-text">{turn.answer}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 用户已发送的消息 */}
      {agentUI.sentMessages.length > 0 && (
      <div className="island-sent-messages">
        {agentUI.sentMessages.map((msg, idx) => (
          <div
            key={idx}
            className={`island-sent-msg${expandedMsgIndex === idx ? ' expanded' : ''}`}
            onClick={(e) => { e.stopPropagation(); setExpandedMsgIndex(prev => prev === idx ? null : idx) }}
          >
            <span className="island-sent-msg-label">{t('dynamicIsland.you')}</span>
            <span className="island-sent-msg-text">{msg.text}</span>
            {/* 计时器显示在最后一条消息右侧 */}
            {idx === agentUI.sentMessages.length - 1 && agentUI.timerStart != null && (
              <ElapsedTimer startTime={agentUI.timerStart} endTime={agentUI.timerEnd} />
            )}
          </div>
        ))}
      </div>
    )}

    {/* 任务计划 */}
    {agentUI.planItems.length > 0 && (
      <div className="island-plan">
        <div
          className="island-plan-header"
          onClick={() => setPlanExpanded(prev => !prev)}
          style={{ cursor: 'pointer' }}
        >
          <span className="island-plan-title">{t('dynamicIsland.plan')}</span>
          <span className="island-plan-progress">
            {agentUI.planItems.filter(i => i.status === 'completed').length}/{agentUI.planItems.length}
            <span className={`island-plan-toggle-icon ${planExpanded ? 'expanded' : ''}`}></span>
          </span>
        </div>
        {/* 收起时只显示 in_progress 项 */}
        {!planExpanded && agentUI.planItems.filter(i => i.status === 'in_progress').map(item => (
          <div key={item.id} className={`island-plan-item ${item.status}`}>
            <span className="island-plan-marker">{'[>]'}</span>
            <span className="island-plan-id">[{item.id}]</span>
            <span className="island-plan-content">{item.content}</span>
          </div>
        ))}
        {/* 展开时显示全部项 */}
        {planExpanded && agentUI.planItems.map(item => (
          <div key={item.id} className={`island-plan-item ${item.status}`}>
            <span className="island-plan-marker">
              {item.status === 'in_progress' ? '[>]' :
               item.status === 'completed' ? '[x]' :
               item.status === 'cancelled' ? '[~]' : '[ ]'}
            </span>
            <span className="island-plan-id">[{item.id}]</span>
            <span className="island-plan-content">{item.content}</span>
          </div>
        ))}
      </div>
    )}

    {/* 思考状态 */}
    {agentUI.thinkingText && (
      <div className="island-thinking">
        <div className="island-thinking-label"> {t('dynamicIsland.thinking')}</div>
        <div className="island-thinking-text" ref={thinkingRef}>{agentUI.thinkingText}</div>
      </div>
    )}

    {/* LLM 正在分析中的过渡提示 */}
    {agentUI.isAnalyzing && (
      <div className="island-analyzing">
        <div className="island-analyzing-text">{t('dynamicIsland.analyzing')}</div>
      </div>
    )}

    {/* 工具执行 — 按 event order 时序混合渲染 */}
    <ToolEventsList agentUI={agentUI} />

    {/* 流式文本输出（含计划文档） */}
    {(agentUI.planDocuments.length > 0 || agentUI.streamingText) && (
      <div className="island-agent-text" ref={streamingRef}>
        {/* 计划文档内容（write_plan 生成，直接渲染在输出区） */}
        {agentUI.planDocuments.map(doc => (
          <PlanDocumentCard
            key={`plan-doc-${doc.toolCallId}`}
            doc={doc}
            planDocumentLabel={t('dynamicIsland.planDocument')}
          />
        ))}
        {agentUI.streamingText}
        {isAgentRunning && <span className="typewriter-cursor" />}
      </div>
    )}

    {/* 准备工具调用的过渡提示（在流式文字之后显示） */}
    {agentUI.isPreparingToolCall && agentUI.toolCalls.length === 0 && (
      <div className="island-analyzing">
        <div className="island-analyzing-text">{t('dynamicIsland.preparingToolCall')}</div>
      </div>
    )}

    {/* 拖拽提示层（仅视觉开启时显示） */}
    {isDragOver && enableVision && (
      <div className="island-drop-overlay">
        <div className="island-drop-text">{t('dynamicIsland.dropImage')}</div>
      </div>
    )}
    </div>
  )
}

// ==================== 工具调用时序列表 ====================

/**
 * 按时序混合渲染工具调用和工具结果
 * 从 DynamicIsland 内联 IIFE 提取为独立组件，提高可读性
 */
function ToolEventsList({ agentUI }: { agentUI: AgentUIState }) {
  if (agentUI.toolCalls.length === 0 && agentUI.toolResults.length === 0) return null

  const resultMap = new Map<string, ToolResultInfo>()
  for (const r of agentUI.toolResults) {
    resultMap.set(r.toolCallId, r)
  }

  interface ToolEvent {
    type: 'call' | 'result'
    order: number
    call?: ToolCallInfo
    result?: ToolResultInfo
  }
  const events: ToolEvent[] = []
  const renderedCalls = new Set<string>()

  for (const call of agentUI.toolCalls) {
    const result = resultMap.get(call.toolCallId)
    if (result) {
      events.push({ type: 'result', order: result.order, result })
      renderedCalls.add(call.toolCallId)
    } else {
      events.push({ type: 'call', order: call.order, call })
    }
  }

  for (const r of agentUI.toolResults) {
    if (!renderedCalls.has(r.toolCallId)) {
      events.push({ type: 'result', order: r.order, result: r })
    }
  }

  events.sort((a, b) => a.order - b.order)

  return (
    <>
      {events.map((ev) => {
        if (ev.type === 'call' && ev.call) {
          return (
            <div key={`call-${ev.call.toolCallId}`} className="island-tool-call">
              <span className="island-tool-icon">🔧</span>
              <span className="island-tool-name">{ev.call.toolName}</span>
              {ev.call.toolArgs && Object.keys(ev.call.toolArgs).length > 0 && (
                <span className="island-tool-args">{truncate(JSON.stringify(ev.call.toolArgs), 60)}</span>
              )}
            </div>
          )
        } else if (ev.type === 'result' && ev.result) {
          return (
            <div key={`result-${ev.result.toolCallId}`} className={`island-tool-result ${ev.result.success ? 'success' : 'error'}`}>
              <span className="island-tool-icon">{ev.result.success ? '✓' : '✕'}</span>
              <span className="island-tool-name">{ev.result.toolName}</span>
              <span className="island-tool-output">{truncate(ev.result.output, 80)}</span>
            </div>
          )
        }
        return null
      })}
    </>
  )
}
