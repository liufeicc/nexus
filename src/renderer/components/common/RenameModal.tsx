/**
 * 重命名对话框组件
 */

import React from 'react'
import { useAppStore, captureAllBrowsersBeforeModal, clearAllBrowserSnapshots } from '../../store'
import type { Session } from '@core/types'
import { useI18n } from '../../i18n'

/**
 * 重命名对话框
 */
export function RenameModal() {
  const { renameModal, hideRenameModal, setSessionIds } = useAppStore()
  const { t } = useI18n()
  const [name, setName] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  // 当对话框打开时，更新名称并全选文本 + 截图占位
  React.useEffect(() => {
    if (renameModal?.visible) {
      setName(renameModal.sessionName || '')
      // 对话框打开后全选文本
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
      // 截图占位
      captureAllBrowsersBeforeModal()
    } else {
      // 关闭时清除截图
      clearAllBrowserSnapshots()
    }
  }, [renameModal?.visible, renameModal?.sessionId])

  if (!renameModal || !renameModal.visible) {
    return null
  }

  const handleConfirm = async () => {
    if (!name.trim()) {
      console.warn('[RenameModal] 会话名称不能为空')
      return
    }
    try {
      await window.electronAPI.session.update(renameModal.sessionId!, name)
      const sessions = await window.electronAPI.session.list()
      setSessionIds(sessions.map((s: Session) => s.id))
      window.dispatchEvent(new CustomEvent('sessions-change'))
      hideRenameModal()
    } catch (error) {
      console.error('[RenameModal] 重命名会话失败:', error)
    }
  }

  const handleCancel = () => {
    hideRenameModal()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleConfirm()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div className="modal-header">
          <svg className="modal-icon" style={{ color: '#60a5fa' }} viewBox="0 0 24 24">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
          </svg>
          <h3 className="modal-title">{t('rename.title')}</h3>
        </div>
        <div className="modal-body">
          <input
            ref={inputRef}
            type="text"
            className="rename-input"
            placeholder={t('rename.placeholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>
        <div className="modal-footer">
          <button className="modal-btn modal-btn-cancel" onClick={handleCancel}>
            {t('common.cancel')}
          </button>
          <button
            className="modal-btn modal-btn-confirm"
            style={{ backgroundColor: '#2563eb' }}
            onClick={handleConfirm}
          >
            {t('rename.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default RenameModal
