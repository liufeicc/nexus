/**
 * 关于对话框组件
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useAppStore, captureAllBrowsersBeforeModal, clearAllBrowserSnapshots } from '../../store'
import { useI18n } from '../../i18n'

type UpdateStateType = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'

/**
 * 关于对话框
 */
export function AboutModal() {
  const { aboutModalVisible, setAboutModalVisible } = useAppStore()
  const { t } = useI18n()
  const [appVersion, setAppVersion] = useState('')

  // 更新相关状态
  const [updateState, setUpdateState] = useState<UpdateStateType>('idle')
  const [updateVersion, setUpdateVersion] = useState<string>('')
  const [updateProgress, setUpdateProgress] = useState<number>(0)
  const [updateError, setUpdateError] = useState<string>('')

  // 获取应用版本号
  useEffect(() => {
    if (aboutModalVisible && window.electronAPI?.app?.getVersion) {
      window.electronAPI.app.getVersion().then((version) => {
        setAppVersion(`v${version}`)
      }).catch(() => {
        setAppVersion('V1.0.0')
      })
    }
  }, [aboutModalVisible])

  // 弹窗打开时截图占位
  React.useEffect(() => {
    if (aboutModalVisible) {
      captureAllBrowsersBeforeModal()
    } else {
      clearAllBrowserSnapshots()
    }
  }, [aboutModalVisible])

  // 键盘事件: Esc 关闭
  React.useEffect(() => {
    if (!aboutModalVisible) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setAboutModalVisible(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [aboutModalVisible, setAboutModalVisible])

  // 注册更新状态监听
  useEffect(() => {
    if (!aboutModalVisible) return

    const cleanupState = window.electronAPI?.update?.onUpdateState((data) => {
      setUpdateState(data.state as UpdateStateType)
      if (data.version) setUpdateVersion(data.version)
      if (data.progress !== undefined) setUpdateProgress(data.progress)
      if (data.state === 'downloading' && data.progress !== undefined) {
        setUpdateProgress(data.progress)
      }
    })

    const cleanupError = window.electronAPI?.update?.onUpdateError((data) => {
      setUpdateState('error')
      setUpdateError(data.error)
    })

    return () => {
      cleanupState?.()
      cleanupError?.()
    }
  }, [aboutModalVisible])

  // 检查更新
  const handleCheckUpdate = useCallback(() => {
    setUpdateError('')
    window.electronAPI?.update?.checkForUpdate()
  }, [])

  // 下载更新
  const handleDownload = useCallback(() => {
    setUpdateError('')
    window.electronAPI?.update?.downloadUpdate()
  }, [])

  // 安装并重启
  const handleInstall = useCallback(() => {
    window.electronAPI?.update?.installAndRestart()
  }, [])

  if (!aboutModalVisible) {
    return null
  }

  // 根据状态渲染版本行的右侧内容
  const renderVersionValue = () => {
    // idle 或 not-available 时显示版本号 + 可点击的检查更新文字
    if (updateState === 'idle' || updateState === 'not-available') {
      const isUpToDate = updateState === 'not-available'
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="about-value">{appVersion}</span>
          <span
            className="about-value"
            style={{
              color: isUpToDate ? '#52c41a' : 'var(--primary-color)',
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
              fontSize: '13px',
            }}
            onClick={handleCheckUpdate}
          >
            {isUpToDate ? t('update.upToDate') : t('update.checkForUpdates')}
          </span>
        </div>
      )
    }

    // checking: 显示加载提示
    if (updateState === 'checking') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="about-value">{appVersion}</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
            {t('update.checking')}
          </span>
        </div>
      )
    }

    // downloading: 显示版本号 + 进度条
    if (updateState === 'downloading') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="about-value">{appVersion}</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
            {t('update.downloading').replace('{progress}', String(updateProgress))}
          </span>
        </div>
      )
    }

    // available: 显示新版本号
    if (updateState === 'available') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="about-value">{appVersion}</span>
          <span style={{ color: 'var(--primary-color)', fontSize: '13px' }}>
            {t('update.updateAvailable').replace('{version}', updateVersion)}
          </span>
        </div>
      )
    }

    // downloaded: 显示已就绪
    if (updateState === 'downloaded') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="about-value">{appVersion}</span>
          <span style={{ color: '#52c41a', fontSize: '13px' }}>
            {t('update.downloaded')}
          </span>
        </div>
      )
    }

    // error: 显示错误
    if (updateState === 'error') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="about-value">{appVersion}</span>
          <span style={{ color: '#ff4d4f', fontSize: '13px' }}>
            {t('update.error').replace('{error}', updateError)}
          </span>
        </div>
      )
    }

    return <span className="about-value">{appVersion}</span>
  }

  // 渲染操作按钮（需要按钮的状态）
  const renderUpdateAction = () => {
    if (updateState === 'available') {
      return (
        <button className="modal-btn modal-btn-primary" onClick={handleDownload}>
          {t('update.download')}
        </button>
      )
    }
    if (updateState === 'downloaded') {
      return (
        <button className="modal-btn modal-btn-primary" onClick={handleInstall}>
          {t('update.installAndRestart')}
        </button>
      )
    }
    if (updateState === 'error') {
      return (
        <button className="modal-btn" onClick={handleCheckUpdate}>
          {t('update.retry')}
        </button>
      )
    }
    return null
  }

  return (
    <div className="modal-overlay" onClick={() => setAboutModalVisible(false)}>
      <div className="modal-container about-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{t('about.title')}</h3>
        </div>
        <div className="modal-body about-body">
          <div className="about-info">
            <div className="about-info-item">
              <span className="about-label">{t('about.productName')}</span>
            </div>
            <div className="about-info-item">
              <span className="about-label">{t('about.version')}</span>
              {renderVersionValue()}
            </div>
            <div className="about-info-item">
              <span className="about-label">{t('about.author')}</span>
              <span className="about-value">{t('about.authorName')}</span>
            </div>
            <div className="about-info-item">
              <span className="about-label">{t('about.license')}</span>
              <span className="about-value">{t('about.licenseName')}</span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          {renderUpdateAction()}
          <button className="modal-btn modal-btn-confirm" onClick={() => setAboutModalVisible(false)} autoFocus>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AboutModal
