/**
 * 灵动岛输入栏组件
 *
 * 固定输入栏包含：
 * - 拖动手柄
 * - 输入框 + 发送/停止按钮 + 历史按钮 + 关闭按钮
 * - 计划模式提示条
 * - 底部工具栏：计划模式按钮 + 任务/技能/附件按钮 + 上下文使用率 + 清除/压缩/记忆按钮
 * - 清除/压缩确认行
 */

import React from 'react'
import { useI18n } from '../../i18n'
import { AttachedFileBadge } from '../agent/AttachedFileBadge'
import type { AttachedFile } from '../../../core/types/agent'
import type { AgentUIState, IslandState } from '../../hooks/use-dynamic-island-types'
import type { UseDynamicIslandAgentOutput } from './use-dynamic-island-agent'
import type { UseDynamicIslandPanelsOutput } from './use-dynamic-island-panels'
import type { UseDynamicIslandHistoryOutput } from './use-dynamic-island-history'

interface DynamicIslandInputBarProps {
  agentUI: AgentUIState
  isAgentRunning: boolean
  planMode: boolean
  togglePlanMode: () => void
  inputRef: React.MutableRefObject<HTMLTextAreaElement | null>
  enableVision: boolean
  bgActivityActive: boolean
  contextUsagePercent: number
  agent: UseDynamicIslandAgentOutput
  panels: UseDynamicIslandPanelsOutput
  history: UseDynamicIslandHistoryOutput
  handlePaste: (e: React.ClipboardEvent) => void
  handleFilePicker: () => void
  attachedFiles: AttachedFile[]
  removeAttachedFile: (id: string) => void
  setIslandState: React.Dispatch<React.SetStateAction<IslandState>>
}

export function DynamicIslandInputBar({
  agentUI,
  isAgentRunning,
  planMode,
  togglePlanMode,
  inputRef,
  enableVision,
  bgActivityActive,
  contextUsagePercent,
  agent,
  panels,
  history,
  handlePaste,
  handleFilePicker,
  attachedFiles,
  removeAttachedFile,
  setIslandState,
}: DynamicIslandInputBarProps) {
  const { t } = useI18n()

  return (
    <div className="island-agent-fixed-bar">
      {/* 拖动手柄 — 放在最顶部 */}
      <div className="island-drag-handle" />

      {/* 输入行 — 输入框 + 发送/停止 + 关闭 */}
      <div className="island-agent-input-row">
        <textarea
          ref={inputRef}
          className="island-agent-input"
          placeholder={planMode ? t('dynamicIsland.planModePlaceholder') : t('dynamicIsland.placeholder')}
          value={agentUI.inputText}
          onChange={(e) => { e.stopPropagation(); agent.handleInputChange(e) }}
          onKeyDown={(e) => { e.stopPropagation(); agent.handleInputKeyDown(e) }}
          onPaste={(e) => { e.stopPropagation(); handlePaste(e) }}
          rows={1}
        />
        {isAgentRunning && !agentUI.inputText.trim() ? (
          <button
            className="island-stop-btn-inline"
            onClick={(e) => { e.stopPropagation(); agent.handleAgentStop() }}
            title={t('dynamicIsland.stop')}
          >
            ■
          </button>
        ) : (
          <button
            className="island-agent-send-btn"
            onClick={(e) => {
              e.stopPropagation()
              if (isAgentRunning) {
                agent.handleAgentSendWhileRunning()
              } else {
                agent.handleAgentSend()
              }
            }}
            disabled={!agentUI.inputText.trim() && !isAgentRunning}
            title="发送 Ctrl+Enter"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        )}
        {/* 输入历史按钮 */}
        <button
          className="island-history-btn"
          onClick={(e) => { e.stopPropagation(); history.handleToggleHistory() }}
          title={t('dynamicIsland.inputHistory')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </button>
        <button
          className="island-close-btn-inline"
          onClick={(e) => { e.stopPropagation(); setIslandState('hiding') }}
          title={t('common.close')}
        >
          ✕
        </button>
      </div>

      {/* 计划模式激活时的提示条 */}
      {planMode && (
        <div className="island-plan-mode-banner">
          <span className="island-plan-mode-banner-icon">📋</span>
          <span className="island-plan-mode-banner-text">
            {t('dynamicIsland.planModeActive')}
          </span>
        </div>
      )}

      {/* 底部工具栏：任务图标 + 附件按钮 + 附件列表 + 后台AGENT指示器 */}
      <div className="island-agent-bottom-bar">
        {/* 左侧：任务图标 + 附件按钮 + 附件列表 */}
        <div className="island-bottom-actions">
          {/* 计划模式按钮 */}
          <button
            className={`island-plan-mode-btn${planMode ? ' active' : ''}${isAgentRunning ? ' disabled' : ''}`}
            onClick={(e) => { e.stopPropagation(); if (!isAgentRunning) togglePlanMode() }}
            disabled={isAgentRunning}
            title={isAgentRunning ? t('dynamicIsland.agentRunning') : t('dynamicIsland.planMode')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="8" y2="9" />
            </svg>
          </button>
          {/* 任务图标按钮 */}
          <button
            className="island-task-btn"
            onClick={(e) => { e.stopPropagation(); panels.handleOpenTask() }}
            title={t('dynamicIsland.tasks')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
          </button>
          {/* 技能图标按钮 */}
          <button
            className="island-skill-btn"
            onClick={(e) => { e.stopPropagation(); panels.handleOpenSkill() }}
            title={t('dynamicIsland.skills')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </button>
          {enableVision && (
          <button
            className="island-file-btn"
            onClick={(e) => { e.stopPropagation(); handleFilePicker() }}
            title={t('dynamicIsland.attachImage')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          )}

          {/* 已附加文件列表 */}
          {attachedFiles.length > 0 && (
            <div className="island-attached-files">
              {attachedFiles.map(file => (
                <AttachedFileBadge key={file.id} file={file} onRemove={removeAttachedFile} />
              ))}
            </div>
          )}
        </div>

        {/* 右侧：上下文使用率 + 清除/压缩/记忆按钮 */}
        <div className="island-bg-agent-indicator">
          {/* 上下文使用百分比进度条 */}
          <div className="island-context-usage-bar">
            {bgActivityActive ? (
              <span className="island-context-usage-text">{t('dynamicIsland.compressing')}</span>
            ) : (
              <>
                <div
                  className="island-context-usage-fill"
                  style={{ width: `${contextUsagePercent}%` }}
                />
                <span className="island-context-usage-text">
                  {Math.round(contextUsagePercent)}%
                </span>
              </>
            )}
          </div>

          {/* 清除对话历史图标 */}
          <button
            className={`island-action-icon-btn${(bgActivityActive || isAgentRunning) ? ' disabled' : ''}`}
            onClick={(e) => { e.stopPropagation(); agent.handleClearHistory() }}
            title={t('dynamicIsland.clearHistory')}
            disabled={bgActivityActive || isAgentRunning}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 17l5-5-5-5" />
              <path d="M6 17l5-5-5-5" />
            </svg>
          </button>

          {/* 总结对话历史图标 */}
          <button
            className={`island-action-icon-btn${(bgActivityActive || isAgentRunning) ? ' disabled' : ''}`}
            onClick={(e) => { e.stopPropagation(); agent.handleCompressHistory() }}
            title={t('dynamicIsland.summarizeHistory')}
            disabled={bgActivityActive || isAgentRunning}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </button>

          {/* 记忆图标 */}
          <button
            className="island-action-icon-btn"
            onClick={(e) => { e.stopPropagation(); panels.handleOpenMemory() }}
            title={t('dynamicIsland.memory')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </button>
        </div>

        {/* 清除确认行 */}
        {agent.clearConfirm && (
          <div className="island-clear-confirm-row">
            <span className="island-clear-confirm-text">{t('dynamicIsland.confirmClearHistory')}</span>
            <button
              className="island-clear-confirm-btn"
              onClick={(e) => { e.stopPropagation(); agent.handleDoClearHistory() }}
              title={t('dynamicIsland.confirm')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
            <button
              className="island-clear-cancel-btn"
              onClick={(e) => { e.stopPropagation(); agent.handleCancelClear() }}
              title={t('dynamicIsland.cancel')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* 压缩确认行 */}
        {agent.compressConfirm && (
          <div className="island-clear-confirm-row">
            <span className="island-clear-confirm-text">{t('dynamicIsland.confirmSummarizeHistory')}</span>
            <button
              className="island-clear-confirm-btn"
              onClick={(e) => { e.stopPropagation(); agent.handleDoCompressHistory() }}
              title={t('dynamicIsland.confirm')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
            <button
              className="island-clear-cancel-btn"
              onClick={(e) => { e.stopPropagation(); agent.handleCancelClear() }}
              title={t('dynamicIsland.cancel')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
