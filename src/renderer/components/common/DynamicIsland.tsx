/**
 * 灵动岛组件（纯 React 浮层组件）
 *
 * 设计理念：
 * - 现代科幻 HUD 风格
 * - 智能体模式：Agent 交互、流式文字、思考、工具调用展示
 * - 无消息时自动收起，有消息时平滑展开
 * - 作为主窗口内的固定定位浮层，z-index 高于普通内容
 *
 * Hooks 拆分：
 * - useAgentEvents — 智能体事件监听
 * - useFileAttachments — 文件附件管理
 * - useWindowDrag — 窗口拖动和点击切换
 * - useBackgroundAgentActivity — 后台智能体活动监听
 * - useDynamicIslandConfig — enableVision 配置 + 上下文使用率
 * - useDynamicIslandHistory — 输入历史面板
 * - useDynamicIslandPanels — 任务/技能/记忆面板状态
 * - useDynamicIslandAgent — 智能体操作（发送/停止/清除/压缩）
 * - useDynamicIslandUI — 展开/收起 + 窗口自适应 + 自动聚焦
 * - useDynamicIslandUtils — 纯工具函数
 *
 * 子组件拆分：
 * - DynamicIslandInputBar — 固定输入栏（输入框 + 工具栏 + 确认行）
 * - DynamicIslandContent — 可滚动内容区域（对话、计划、工具、流式文本）
 * - DynamicIslandHistory — 输入历史面板（全屏覆盖层）
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../../store'
import TaskPanel from './TaskPanel'
import SkillPanel from './SkillPanel'
import MemoryPanel from './MemoryPanel'
import { UserPrefPopup } from './UserPrefPopup'
import { useAutoScroll } from '../../hooks/use-auto-scroll'
import { useAgentEvents } from '../../hooks/use-agent-events'
import { useFileAttachments } from '../../hooks/use-file-attachments'
import { useWindowDrag } from '../../hooks/use-window-drag'
import { useBackgroundAgentActivity } from '../../hooks/use-background-agent-activity'
import type { AgentUIState } from '../../hooks/use-dynamic-island-types'
import { useDynamicIslandConfig } from './use-dynamic-island-config'
import { useDynamicIslandHistory } from './use-dynamic-island-history'
import { useDynamicIslandPanels } from './use-dynamic-island-panels'
import { useDynamicIslandAgent, getEffectiveSessionId } from './use-dynamic-island-agent'
import { useDynamicIslandUI } from './use-dynamic-island-ui'
import { useDynamicIslandPlanMode } from './use-dynamic-island-plan-mode'
import { agentStateToType } from './use-dynamic-island-utils'
import { DynamicIslandInputBar } from './DynamicIslandInputBar'
import { DynamicIslandContent } from './DynamicIslandContent'
import { DynamicIslandHistory } from './DynamicIslandHistory'
import '../../styles/dynamic-island.css'
import '../../styles/task-panel.css'
import '../../styles/skill-panel.css'
import '../../styles/memory-panel.css'

// ==================== 主组件 ====================

export function DynamicIsland({ standalone = false }: { standalone?: boolean }) {
  // ==================== Store 读取 ====================

  const attachedFiles = useAppStore(s => s.attachedFiles)
  const removeAttachedFile = useAppStore(s => s.removeAttachedFile)

  // ==================== 智能体 UI 状态 ====================

  const [agentUI, setAgentUI] = useState<AgentUIState>({
    agentState: 'idle',
    streamingText: '',
    thinkingText: '',
    toolCallIds: new Set(),
    toolCalls: [],
    toolResults: [],
    eventOrder: 0,
    inputText: '',
    sessionId: null,
    sentMessages: [],
    isAnalyzing: false,
    isPreparingToolCall: false,
    planItems: [],
    planDocuments: [],
    conversationHistory: [],
    timerStart: null,
    timerEnd: null,
  })

  // 已发送消息的展开状态
  const [expandedMsgIndex, setExpandedMsgIndex] = useState<number | null>(null)

  // 历史对话展开/收起状态
  const [expandedHistory, setExpandedHistory] = useState(false)

  // 计划区域展开/收起状态（默认收起）
  const [planExpanded, setPlanExpanded] = useState(false)

  // 用户偏好弹窗
  const [showUserPref, setShowUserPref] = useState(false)

  // ==================== Hooks ====================

  // UI 状态（展开/收起、窗口自适应、自动聚焦）
  const panels = useDynamicIslandPanels()

  // 计划模式状态
  const { planMode, togglePlanMode } = useDynamicIslandPlanMode()

  // 输入历史
  const history = useDynamicIslandHistory()

  const { islandState, setIslandState, inputRef, contentRef, thinkingRef, streamingRef } = useDynamicIslandUI({
    standalone,
    taskPanelOpen: panels.taskPanelOpen,
    skillPanelOpen: panels.skillPanelOpen,
    memoryPanelOpen: panels.memoryPanelOpen,
    historyPanelOpen: history.showHistoryPanel,
    userPrefOpen: showUserPref,
  })

  // 配置管理（enableVision + 上下文使用率）
  const { enableVision, contextUsagePercent } = useDynamicIslandConfig(islandState)

  // 智能体操作
  const { isActive: bgActivityActive } = useBackgroundAgentActivity()
  const agent = useDynamicIslandAgent({
    agentUI,
    setAgentUI,
    bgActivityActive,
  })

  // 智能体事件监听
  useAgentEvents(setAgentUI, thinkingRef)

  // 自动滚动（useEffect 方式，确保 DOM 更新后滚动）
  const isAgentRunning = agentUI.agentState === 'running' || agentUI.agentState === 'stopping'
  useAutoScroll({
    streamingText: agentUI.streamingText,
    thinkingText: agentUI.thinkingText,
    isRunning: isAgentRunning,
    streamingRef,
    thinkingRef,
  })

  // 组件挂载时从数据库加载历史对话
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const sid = await getEffectiveSessionId()
        const history = await window.electronAPI?.agent?.loadHistory?.(sid)
        if (history && history.length > 0) {
          setAgentUI(prev => ({ ...prev, conversationHistory: history }))
        }
      } catch {
        // 加载失败不影响主流程
      }
    }
    loadHistory()
  }, [])

  // 文件附件管理
  const {
    handleFilePicker,
    handlePaste,
    handleDrop,
    handleDropImage,
    handleDropPath,
    isDragOver,
    handleDragOver,
    handleDragLeave,
  } = useFileAttachments(agentUI.inputText, setAgentUI, enableVision)

  // 窗口拖动 + 点击切换
  const {
    handleStandaloneMouseDown,
    handleMouseDown,
    handleClick,
    position,
  } = useWindowDrag(standalone, islandState, setIslandState)

  // ==================== 选择历史记录 ====================

  const handleSelectHistory = useCallback((entry: { id: number; text: string }) => {
    setAgentUI(prev => ({ ...prev, inputText: entry.text }))
    history.handleToggleHistory() // 关闭面板
    setTimeout(() => {
      inputRef.current?.focus()
      agent.adjustTextareaHeight()
    }, 50)
  }, [history, agent, inputRef])

  // ==================== 执行任务 ====================

  const handleTaskSelect = useCallback((taskContent: string) => {
    agent.executeTask(taskContent)
    panels.setTaskPanelOpen(false)
  }, [agent, panels])

  // ==================== 渲染 ====================

  const dataMode = agentStateToType(agentUI.agentState)

  // 独立窗口模式下不需要 CSS 定位（窗口由 Electron 管理位置）
  const containerStyle = standalone
    ? { position: 'fixed' as const, top: 0, left: 0, transform: 'none' as const, width: '100%' }
    : (position
        ? { left: position.left, top: position.top, transform: 'none' as const }
        : undefined)

  const containerClass = `dynamic-island${islandState !== 'idle' ? ' visible' : ''}${standalone ? ' island-standalone' : ''}`

  return (
    <div
      className={containerClass}
      onMouseDown={standalone ? handleStandaloneMouseDown : handleMouseDown}
      style={containerStyle}
    >
      <div
        className={`island-container ${islandState === 'idle' ? 'idle' : ''} ${
          islandState === 'showing' ? 'visible' : ''
        } ${islandState === 'hiding' ? 'collapsing' : ''} ${isDragOver ? 'drag-over' : ''}`}
        data-type={dataMode}
        onClick={handleClick}
        onDrop={(e) => {
          if (!enableVision) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          const files = Array.from(e.dataTransfer.files)
          const items = Array.from(e.dataTransfer.items)
          const hasLocalFiles = files.some(f => f.path)
          const hasImages = items.some(item => item.type.startsWith('image/'))
          const textPath = e.dataTransfer.getData('text/plain')

          if (textPath && !hasLocalFiles && !hasImages) {
            handleDropPath(e, textPath)
          } else if (hasLocalFiles) {
            handleDrop(e)
          } else if (hasImages) {
            handleDropImage(e)
          } else {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* 左侧彩色竖条 */}
        <div className="island-accent-bar" />

        {/* 收起时的指示器行 */}
        <div className="island-indicator-row">
          <div className="island-pip" />
          <span className="island-label">NEXUS</span>
          <div className="island-pulse-ring" />
        </div>

        {/* 智能体模式内容 — 展开时显示 */}
        {islandState === 'showing' && (
          <div className="island-content island-agent-content" ref={contentRef} onClick={(e) => e.stopPropagation()}>
            {/* 固定输入栏 */}
            <DynamicIslandInputBar
              agentUI={agentUI}
              isAgentRunning={isAgentRunning}
              planMode={planMode}
              togglePlanMode={togglePlanMode}
              inputRef={inputRef}
              enableVision={enableVision}
              bgActivityActive={bgActivityActive}
              contextUsagePercent={contextUsagePercent}
              agent={agent}
              panels={panels}
              history={history}
              handlePaste={handlePaste}
              handleFilePicker={handleFilePicker}
              attachedFiles={attachedFiles}
              removeAttachedFile={removeAttachedFile}
              setIslandState={setIslandState}
              onOpenUserPref={() => setShowUserPref(true)}
            />

            {/* 可滚动内容区域 */}
            <DynamicIslandContent
              agentUI={agentUI}
              isAgentRunning={isAgentRunning}
              enableVision={enableVision}
              isDragOver={isDragOver}
              expandedHistory={expandedHistory}
              setExpandedHistory={setExpandedHistory}
              expandedMsgIndex={expandedMsgIndex}
              setExpandedMsgIndex={setExpandedMsgIndex}
              planExpanded={planExpanded}
              setPlanExpanded={setPlanExpanded}
              thinkingRef={thinkingRef}
              streamingRef={streamingRef}
            />
          </div>
        )}
      </div>

      {/* 输入历史面板 */}
      <DynamicIslandHistory
        history={history}
        onSelectHistory={handleSelectHistory}
      />

      {/* 任务面板 */}
      <TaskPanel
        visible={panels.taskPanelOpen}
        onSelect={handleTaskSelect}
        onClose={() => panels.setTaskPanelOpen(false)}
        disabled={isAgentRunning}
      />

      {/* 技能面板 */}
      <SkillPanel
        visible={panels.skillPanelOpen}
        onClose={() => panels.setSkillPanelOpen(false)}
      />

      {/* 记忆面板 */}
      <MemoryPanel
        visible={panels.memoryPanelOpen}
        onClose={() => panels.setMemoryPanelOpen(false)}
      />

      {/* 用户偏好弹窗 */}
      <UserPrefPopup
        visible={showUserPref}
        onClose={() => setShowUserPref(false)}
      />
    </div>
  )
}

export default DynamicIsland
