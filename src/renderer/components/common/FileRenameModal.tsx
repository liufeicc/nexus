/**
 * 文件重命名对话框组件
 *
 * 用于文件面板中的文件重命名操作。
 * 打开时输入框显示完整文件名（含扩展名），但自动选中文件名部分（不含扩展名），
 * 方便用户直接输入新名称而不修改扩展名。
 * Enter 确认 / Esc 取消。
 */

import React, { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../../store'
import { getBasename, getDirname } from '../../../core/utils/path-utils'
import { useI18n } from '../../i18n'

/**
 * 文件重命名对话框
 */
export function FileRenameModal() {
  const { fileRenameModal, hideFileRenameModal, showToast } = useAppStore()
  const { t } = useI18n()
  const [fullName, setFullName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 当对话框打开时，初始化完整文件名并选中名称部分
  useEffect(() => {
    if (fileRenameModal?.visible) {
      const fileName = fileRenameModal.fileName || ''
      setFullName(fileName)
      // 对话框打开后全选名称部分（不含扩展名）
      setTimeout(() => {
        const input = inputRef.current
        if (!input) return
        input.focus()
        const lastDotIdx = fileName.lastIndexOf('.')
        // 如果有扩展名（且不是隐藏文件如 .gitignore），选中名称部分
        if (lastDotIdx > 0) {
          input.setSelectionRange(0, lastDotIdx)
        } else {
          input.select()
        }
      }, 0)
    }
  }, [fileRenameModal?.visible, fileRenameModal?.filePath])

  if (!fileRenameModal || !fileRenameModal.visible) {
    return null
  }

  const handleConfirm = async () => {
    const trimmedName = fullName.trim()
    if (!trimmedName) {
      showToast(t('fileRename.title'))
      return
    }

    // 检查是否包含非法字符
    if (/[\\/:*?"<>|]/.test(trimmedName)) {
      showToast(t('fileRename.title'))
      return
    }

    // 构建新路径：同目录下的新文件名
    const oldPath = fileRenameModal.filePath!
    const dir = getDirname(oldPath)
    const newPath = `${dir}/${trimmedName}`

    // 如果名称没变，直接关闭
    if (newPath === oldPath) {
      hideFileRenameModal()
      return
    }

    try {
      const result = await window.electronAPI.fs.rename(oldPath, newPath)
      if (result.error) {
        // 将主进程返回的错误消息映射为 i18n 翻译
        const errorMap: Record<string, string> = {
          '原文件不存在': t('fileOps.sourceFileNotExist'),
          '目标名称已存在': t('fileOps.targetNameExists'),
        }
        showToast(errorMap[result.error] || result.error)
        return
      }
      // 通知对应面板刷新目录
      if (fileRenameModal.panelId) {
        window.dispatchEvent(new CustomEvent('file-rename-completed', {
          detail: { panelId: fileRenameModal.panelId, oldPath, newPath },
        }))
      }
      showToast(t('fileRename.confirm'))
      hideFileRenameModal()
    } catch (error) {
      console.error('[FileRenameModal] 重命名失败:', error)
      showToast(t('fileRename.title'))
    }
  }

  const handleCancel = () => {
    hideFileRenameModal()
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
          <h3 className="modal-title">{t('fileRename.title')}</h3>
        </div>
        <div className="modal-body">
          <input
            ref={inputRef}
            type="text"
            className="rename-input"
            placeholder={t('fileRename.placeholder')}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
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
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default FileRenameModal
