/**
 * Clarify 提问弹窗组件
 *
 * 当智能体调用 clarify 工具时弹出，支持两种模式：
 * 1. 多选模式：显示最多 4 个选项 + "其他（自行输入）"
 * 2. 开放式问答：显示文本输入框
 *
 * 样式风格：与灵动岛一致的 HUD 科幻风
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useI18n } from '../../i18n'
import { useAppStore, captureAllBrowsersBeforeModal, clearAllBrowserSnapshots } from '../../store'

export function ClarifyModal() {
  const { t } = useI18n()
  const { clarifyModal, hideClarifyModal } = useAppStore()
  const [selectedChoice, setSelectedChoice] = useState('')
  const [customInput, setCustomInput] = useState('')
  const [openText, setOpenText] = useState('')

  const handleSubmit = useCallback(() => {
    let response = ''
    if (clarifyModal!.choices) {
      if (selectedChoice === '__custom__') {
        response = customInput.trim()
      } else {
        response = selectedChoice.trim()
      }
      if (!response) return
    } else {
      response = openText.trim()
      if (!response) return
    }

    window.electronAPI.agent.sendClarifyResult({ response })
    hideClarifyModal()
  }, [clarifyModal, selectedChoice, customInput, openText, hideClarifyModal])

  const handleCancel = useCallback(() => {
    window.electronAPI.agent.sendClarifyResult({ response: '' })
    hideClarifyModal()
  }, [hideClarifyModal])

  // 使用 ref 始终持有最新回调，避免闭包陈旧
  const handleSubmitRef = useRef(handleSubmit)
  handleSubmitRef.current = handleSubmit
  const handleCancelRef = useRef(handleCancel)
  handleCancelRef.current = handleCancel

  // 弹窗打开时截图占位
  useEffect(() => {
    if (clarifyModal?.visible) {
      captureAllBrowsersBeforeModal()
    } else {
      clearAllBrowserSnapshots()
    }
  }, [clarifyModal?.visible])

  // 弹窗打开/关闭时重置内部状态
  useEffect(() => {
    if (clarifyModal?.visible) {
      setSelectedChoice('')
      setCustomInput('')
      setOpenText('')
    }
  }, [clarifyModal?.visible])

  // 键盘事件（使用 ref 避免闭包陈旧，无需追踪状态依赖）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!clarifyModal?.visible) return
      const hasChoices = Array.isArray(clarifyModal.choices) && clarifyModal.choices.length > 0
      if (e.key === 'Enter' && !e.shiftKey && !hasChoices) {
        e.preventDefault()
        handleSubmitRef.current()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [clarifyModal?.visible, clarifyModal?.choices])

  if (!clarifyModal || !clarifyModal.visible) {
    return null
  }

  const hasChoices = Array.isArray(clarifyModal.choices) && clarifyModal.choices.length > 0

  return (
    <div className="hud-overlay" onClick={handleCancel}>
      <div
        className="hud-clarify-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部左侧彩色竖条 — info 青色 */}
        <div className="hud-accent-bar hud-accent-info" />

        {/* 顶部拖动手柄 */}
        <div className="hud-drag-handle" />

        {/* 头部 */}
        <div className="hud-header">
          <svg className="hud-icon hud-icon-info" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
          </svg>
          <span className="hud-title">
            {hasChoices ? t('clarify.selectTitle') : t('clarify.answerTitle')}
          </span>
          <span className="hud-tag hud-tag-info">{t('clarify.queryTag')}</span>
        </div>

        {/* 内容区 */}
        <div className="hud-body">
          <p className="hud-question">{clarifyModal.question}</p>

          {hasChoices ? (
            // 多选模式
            <div className="hud-choices">
              {clarifyModal.choices!.map((choice, i) => (
                <label
                  key={i}
                  className={`hud-choice ${selectedChoice === choice ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="clarify-choice"
                    value={choice}
                    checked={selectedChoice === choice}
                    onChange={() => { setSelectedChoice(choice); setCustomInput('') }}
                  />
                  <span className="hud-choice-label">{choice}</span>
                </label>
              ))}
              {/* 其他选项 */}
              <label className={`hud-choice hud-choice-custom ${selectedChoice === '__custom__' ? 'selected' : ''}`}>
                <div className="hud-choice-row">
                  <input
                    type="radio"
                    name="clarify-choice"
                    value="__custom__"
                    checked={selectedChoice === '__custom__'}
                    onChange={() => setSelectedChoice('__custom__')}
                  />
                  <span className="hud-choice-text">{t('clarify.other')}</span>
                </div>
                {selectedChoice === '__custom__' && (
                  <input
                    className="hud-custom-input"
                    type="text"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    placeholder={t('clarify.answerPlaceholder')}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </label>
            </div>
          ) : (
            // 开放式问答
            <textarea
              className="hud-textarea"
              value={openText}
              onChange={(e) => setOpenText(e.target.value)}
              placeholder={t('clarify.answerOpenPlaceholder')}
              rows={4}
              autoFocus
            />
          )}
        </div>

        {/* 底部操作区 */}
        <div className="hud-clarify-footer">
          <button className="hud-btn hud-btn-cancel" onClick={handleCancel}>
            {t('common.cancel')}
          </button>
          <button className="hud-btn hud-btn-submit" onClick={handleSubmit}>
            {hasChoices ? t('clarify.confirm') : t('clarify.send')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ClarifyModal
