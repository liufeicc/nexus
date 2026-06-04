/**
 * 灵动岛输入历史面板组件
 *
 * 全屏覆盖层模式，展示用户历史输入记录。
 * 支持选择历史记录填入输入框、单条删除、全部清空。
 */

import React from 'react'
import { useI18n } from '../../i18n'
import { truncate, formatRelativeTime } from './use-dynamic-island-utils'
import type { UseDynamicIslandHistoryOutput } from './use-dynamic-island-history'

interface DynamicIslandHistoryProps {
  history: UseDynamicIslandHistoryOutput
  onSelectHistory: (entry: { id: number; text: string }) => void
}

export function DynamicIslandHistory({ history, onSelectHistory }: DynamicIslandHistoryProps) {
  const { t } = useI18n()

  if (!history.showHistoryPanel) return null

  return (
    <div className="island-history-overlay" onClick={() => history.handleToggleHistory()}>
      <div className="island-history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="island-history-header">
          <h3>{t('dynamicIsland.inputHistoryTitle')}</h3>
          <div className="island-history-header-actions">
            <button className="island-history-clear-all" onClick={() => history.handleClearAllHistory()} title={t('dynamicIsland.clearAll') ?? '全部删除'}>
              🗑
            </button>
            <button className="island-history-close" onClick={() => history.handleToggleHistory()}>✕</button>
          </div>
        </div>
        <div className="island-history-list">
          {history.historyEntries.length === 0 ? (
            <div className="island-history-empty">{t('dynamicIsland.noHistory')}</div>
          ) : (
            history.historyEntries.map(entry => (
              <div
                key={entry.id}
                className="island-history-item"
              >
                <span
                  className="island-history-item-text"
                  onClick={(e) => { e.stopPropagation(); onSelectHistory(entry) }}
                >
                  {truncate(entry.text, 80)}
                </span>
                <div className="island-history-item-actions">
                  <span className="island-history-item-time">
                    {formatRelativeTime(entry.createdAt)}
                  </span>
                  <button
                    className="island-history-item-delete"
                    onClick={(e) => { e.stopPropagation(); history.handleDeleteHistory(entry.id) }}
                    title={t('dynamicIsland.delete')}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
