/**
 * 用户偏好弹窗组件
 *
 * 功能：
 * - 显示一个弹窗，让用户编辑个人偏好设置
 * - 最大 1000 字符限制
 * - 打开时自动加载已有偏好内容
 * - 点击"应用"保存到 memory_entries 表 (scope='user')
 */

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n'

interface UserPrefPopupProps {
  visible: boolean
  onClose: () => void
}

/** 最大字符数限制 */
const MAX_CHARS = 1000

export function UserPrefPopup({ visible, onClose }: UserPrefPopupProps) {
  const { t } = useI18n()
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  /**
   * 弹窗打开时加载已有偏好内容
   */
  useEffect(() => {
    if (!visible) return

    setLoading(true)
    setContent('')

    window.electronAPI.memory.getUserPref()
      .then((result) => {
        if (result.success && result.content) {
          setContent(result.content)
        }
      })
      .catch((err) => {
        console.error('[UserPrefPopup] 加载用户偏好失败:', err)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [visible])

  /**
   * 处理内容变化，限制最大字符数
   */
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    if (value.length <= MAX_CHARS) {
      setContent(value)
    }
  }, [])

  /**
   * 保存用户偏好
   */
  const handleApply = useCallback(async () => {
    setSaving(true)
    try {
      const result = await window.electronAPI.memory.saveUserPref(content)
      if (!result.success) {
        console.error('[UserPrefPopup] 保存失败:', result.error)
      }
    } catch (err) {
      console.error('[UserPrefPopup] 保存异常:', err)
    } finally {
      setSaving(false)
    }
  }, [content])

  /**
   * 处理取消
   */
  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

  /**
   * 处理遮罩层点击
   */
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }, [onClose])

  if (!visible) return null

  return createPortal(
    <div className="island-user-pref-overlay" onClick={handleOverlayClick}>
      <div className="island-user-pref-modal">
        {/* 头部 */}
        <div className="island-user-pref-header">
          <h3>{t('dynamicIsland.userPreferences')}</h3>
          <button
            className="island-user-pref-close"
            onClick={onClose}
            title={t('common.close')}
          >
            ✕
          </button>
        </div>

        {/* 按钮行 - 放在输入框上面 */}
        {!loading && (
          <div className="island-user-pref-actions-row">
            <button
              className="island-user-pref-btn cancel"
              onClick={handleCancel}
              disabled={saving}
            >
              ← {t('common.cancel')}
            </button>
            <button
              className="island-user-pref-btn apply"
              onClick={handleApply}
              disabled={saving}
            >
              {saving ? '...' : t('dynamicIsland.userPrefApply')}
            </button>
          </div>
        )}

        {/* 内容区 */}
        <div className="island-user-pref-body">
          {loading ? (
            <div className="island-user-pref-loading">加载中...</div>
          ) : (
            <textarea
              className="island-user-pref-textarea"
              value={content}
              onChange={handleChange}
              placeholder={t('dynamicIsland.userPrefPlaceholder')}
              maxLength={MAX_CHARS}
              autoFocus
            />
          )}
        </div>

        {/* 字符计数 - 放在下面 */}
        {!loading && (
          <div className="island-user-pref-footer">
            <span className="island-user-pref-char-count">
              {t('dynamicIsland.userPrefCharCount', { count: content.length })}
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
