/**
 * 确认对话框组件
 */

import React from 'react'
import { useAppStore, captureAllBrowsersBeforeModal, clearAllBrowserSnapshots } from '../../store'
import { useI18n } from '../../i18n'

/**
 * 确认对话框
 */
export function ConfirmModal() {
  const { confirmModal, hideConfirmModal } = useAppStore()
  const { t } = useI18n()

  // 弹窗打开时截图占位
  React.useEffect(() => {
    if (confirmModal?.visible) {
      captureAllBrowsersBeforeModal()
    } else {
      clearAllBrowserSnapshots()
    }
  }, [confirmModal?.visible])

  // 键盘事件: Enter 确认, Esc 取消
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!confirmModal?.visible) return
      if (e.key === 'Enter') {
        e.preventDefault()
        handleConfirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmModal?.visible, confirmModal?.onConfirm])

  if (!confirmModal || !confirmModal.visible) {
    return null
  }

  const handleConfirm = () => {
    confirmModal.onConfirm?.()
    hideConfirmModal()
  }

  const handleCancel = () => {
    hideConfirmModal()
  }

  const showCancel = confirmModal.showCancel !== false

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div className="modal-header">
          <svg className="modal-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          <h3 className="modal-title">{confirmModal.title}</h3>
        </div>
        <div className="modal-body">
          <p className="modal-text">{confirmModal.message}</p>
        </div>
        <div className="modal-footer">
          {showCancel ? (
            <>
              <button className="modal-btn modal-btn-cancel" onClick={handleCancel}>
                {t('common.cancel')}
              </button>
              <button className="modal-btn modal-btn-confirm" onClick={handleConfirm} autoFocus>
                {t('confirmModal.confirm')}
              </button>
            </>
          ) : (
            <button className="modal-btn modal-btn-confirm" onClick={handleConfirm} autoFocus>
              {t('common.confirm')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ConfirmModal
