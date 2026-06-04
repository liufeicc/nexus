/**
 * 会话列表项组件
 */

import React from 'react'
import { useAppStore } from '../../store'
import type { Session } from '@core/types'
import { restoreSessionPanels } from '../../utils/session-snapshot'
import { useI18n } from '../../i18n'

interface SessionListItemProps {
  session: Session
  showActive?: boolean
}

export function SessionListItem({ session, showActive = true }: SessionListItemProps) {
  const { activeSessionId, setActiveSessionId, showConfirmModal, setSessionIds, deleteSessionCache, showRenameModal } = useAppStore()
  const { t } = useI18n()
  const isActive = showActive && activeSessionId === session.id

  // 恢复会话快照
  const restoreSnapshot = async (sessionId: string) => {
    await restoreSessionPanels(sessionId)
  }

  const handleClick = async () => {
    await window.electronAPI.session.setActive(session.id)
    setActiveSessionId(session.id)
    window.dispatchEvent(new CustomEvent('sessions-change'))
    await restoreSnapshot(session.id)
  }

  // 删除会话
  const handleDelete = async () => {
    showConfirmModal(
      t('session.deleteSession'),
      t('session.confirmDelete').replace('{name}', session.name),
      async () => {
        try {
          const sessions = await window.electronAPI.session.list()
          const deletedIndex = sessions.findIndex(s => s.id === session.id)

          await window.electronAPI.session.delete(session.id)

          const newSessions = await window.electronAPI.session.list()
          setSessionIds(newSessions.map((s: Session) => s.id))
          window.dispatchEvent(new CustomEvent('sessions-change'))

          // 清理被删除会话的缓存
          deleteSessionCache(session.id)

          // 如果删除的是当前激活的会话，选中上一个会话并恢复其面板
          if (isActive && newSessions.length > 0) {
            const prevSession = newSessions[deletedIndex - 1] || newSessions[0]
            if (prevSession) {
              await window.electronAPI.session.setActive(prevSession.id)
              setActiveSessionId(prevSession.id)
              await restoreSnapshot(prevSession.id)
            }
          } else if (newSessions.length === 0) {
            setActiveSessionId(null)
            useAppStore.getState().setPanelsFromSnapshot([], null)
          }
        } catch (error) {
          console.error('[SessionListItem] 删除会话失败:', error)
        }
      }
    )
  }

  // 重命名会话
  const handleRename = async () => {
    try {
      const sessionData = await window.electronAPI.session.get(session.id)
      if (!sessionData) {
        console.warn('[SessionListItem] 未找到会话')
        return
      }
      showRenameModal(sessionData.id, sessionData.name)
    } catch (error) {
      console.error('[SessionListItem] 获取会话信息失败:', error)
    }
  }

  return (
    <div
      className={`session-item ${isActive ? 'active' : ''}`}
      onClick={handleClick}
      data-session-id={session.id}
    >
      <div className="session-item-content">
        <span className="session-name">{session.name}</span>
      </div>
      <div className="session-actions">
        <button
          className="session-action-btn"
          title={t('common.rename')}
          onClick={(e) => {
            e.stopPropagation()
            handleRename()
          }}
        >
          <svg className="icon" viewBox="0 0 24 24">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
          </svg>
        </button>
        <button
          className="session-action-btn delete-btn"
          title={t('common.delete')}
          onClick={(e) => {
            e.stopPropagation()
            handleDelete()
          }}
        >
          <svg className="icon" viewBox="0 0 24 24">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default SessionListItem
