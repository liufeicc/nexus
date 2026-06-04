/**
 * 危险命令审批弹窗组件
 *
 * 当智能体尝试执行危险命令时弹出，用户可选择：
 * - 确认执行（仅放行当前命令）
 * - 本次会话批准（本次会话内相同模式自动放行）
 * - 高级选项（点击展开）：永久批准、全部危险操作放行
 * - 拒绝（阻止执行）
 *
 * 样式风格：与灵动岛一致的 HUD 科幻风
 */

import React, { useEffect, useCallback, useState } from 'react'
import { useAppStore, captureAllBrowsersBeforeModal, clearAllBrowserSnapshots } from '../../store'
import { useI18n } from '../../i18n'

export function ApprovalModal() {
  const { approvalModal, hideApprovalModal } = useAppStore()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const { t } = useI18n()

  // 弹窗打开时截图占位
  useEffect(() => {
    if (approvalModal?.visible) {
      captureAllBrowsersBeforeModal()
    } else {
      clearAllBrowserSnapshots()
      setShowAdvanced(false) // 关闭时重置高级选项状态
    }
  }, [approvalModal?.visible])

  // 键盘事件: Esc 拒绝
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!approvalModal?.visible) return
      if (e.key === 'Escape') {
        e.preventDefault()
        handleAction('reject')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [approvalModal?.visible])

  const handleAction = useCallback((action: string) => {
    window.electronAPI.agent.sendApprovalResult({ action })
    hideApprovalModal()
  }, [hideApprovalModal])

  if (!approvalModal || !approvalModal.visible) {
    return null
  }

  return (
    <div className="hud-overlay" onClick={handleAction.bind(null, 'reject')}>
      <div
        className="hud-approval-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部左侧彩色竖条 */}
        <div className="hud-accent-bar hud-accent-warning" />

        {/* 顶部拖动手柄 */}
        <div className="hud-drag-handle" />

        {/* 头部 */}
        <div className="hud-header">
          <svg className="hud-icon" viewBox="0 0 24 24">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
          </svg>
          <span className="hud-title">{t('approval.title')}</span>
          <span className="hud-tag hud-tag-warning">{t('approval.warning')}</span>
        </div>

        {/* 内容区 */}
        <div className="hud-body">
          <p className="hud-label">{t('approval.description')}</p>
          <pre className="hud-command">{approvalModal.command}</pre>
          <p className="hud-risk">
            <span className="hud-risk-icon">⚡</span>
            {t('approval.risk')}{approvalModal.description}
          </p>
        </div>

        {/* 操作按钮区 */}
        <div className="hud-footer">
          {/* 主操作按钮 */}
          <div className="hud-actions">
            <button className="hud-btn hud-btn-primary" onClick={() => handleAction('approve')} autoFocus>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {t('approval.confirmExecute')}
            </button>
            <button className="hud-btn hud-btn-session" onClick={() => handleAction('approve_session')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {t('approval.approveSession')}
            </button>
            <button className="hud-btn hud-btn-reject" onClick={() => handleAction('reject')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              {t('approval.reject')}
            </button>
          </div>

          {/* 高级选项 */}
          <div className="hud-advanced">
            <button className="hud-advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
              <svg className={`hud-advanced-icon ${showAdvanced ? 'rotated' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {t('approval.advanced')}
            </button>

            {showAdvanced && (
              <div className="hud-advanced-content">
                <button className="hud-btn hud-btn-permanent" onClick={() => handleAction('approve_permanent')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  {t('approval.approvePermanent')}
                </button>
                <button className="hud-btn hud-btn-yolo" onClick={() => handleAction('yolo')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                  {t('approval.approveAll')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ApprovalModal
