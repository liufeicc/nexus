/**
 * 顶部标题栏组件
 */

import React, { useState, useEffect } from 'react'
import { useAppStore, captureAllBrowsersBeforeModal, clearAllBrowserSnapshots } from '../../store'
import { themes, applyTheme } from '../../../core/constants/themes'
import { useI18n } from '../../i18n'

/**
 * Logo 图片组件 — 开发环境用 /LOGO_rounded.png，生产环境用 electronAPI 获取路径
 */
function LogoImage() {
  const [src, setSrc] = useState('/LOGO_rounded.png')

  useEffect(() => {
    const api = window.electronAPI
    if (api?.app?.getResourcePath) {
      api.app.getResourcePath('LOGO_rounded.png').then((p) => {
        if (p) setSrc(`file://${p}`)
      }).catch(() => {
        // 开发环境下 handler 可能未注册，使用默认路径
      })
    }
  }, [])

  return <img src={src} alt="Nexus Logo" />
}

export function Header() {
  const { currentThemeId, setCurrentThemeId, showConfirmModal, hideConfirmModal, settingsModalVisible, setSettingsModalVisible } = useAppStore()
  const { t } = useI18n()
  const [showThemeDropdown, setShowThemeDropdown] = React.useState(false)
  const dropdownRef = React.useRef<HTMLDivElement>(null)
  const [isMaximized, setIsMaximized] = React.useState(false)

  // 处理关闭窗口
  const handleCloseWindow = () => {
    showConfirmModal(
      t('header.confirmCloseTitle'),
      t('header.confirmCloseMessage'),
      () => {
        hideConfirmModal()
        window.electronAPI?.closeWindow?.()
      }
    )
  }

  // 点击外部关闭下拉菜单
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowThemeDropdown(false)
      }
    }

    if (showThemeDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showThemeDropdown])

  // 主题下拉框打开时截图占位，关闭时清除
  const wasDropdownVisibleRef = React.useRef(false)
  React.useEffect(() => {
    if (showThemeDropdown && !wasDropdownVisibleRef.current) {
      wasDropdownVisibleRef.current = true
      captureAllBrowsersBeforeModal()
    } else if (!showThemeDropdown && wasDropdownVisibleRef.current) {
      wasDropdownVisibleRef.current = false
      clearAllBrowserSnapshots()
    }
  }, [showThemeDropdown])

  // 监听窗口大小变化
  React.useEffect(() => {
    // 初始获取状态
    const updateMaximizedState = async () => {
      const maximized = await window.electronAPI?.isMaximized?.()
      setIsMaximized(maximized)
    }
    updateMaximizedState()

    // 监听最大化/还原事件
    const unsubscribe = window.electronAPI?.onMaximizedChanged?.((isMaximized: boolean) => {
      setIsMaximized(isMaximized)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  // 获取当前主题
  const currentTheme = themes.find((t) => t.id === currentThemeId) || themes[0]

  // 渲染主题图标
  const renderThemeIcon = (iconName: string, className?: string) => {
    switch (iconName) {
      case 'sun':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        )
      case 'moon':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>
          </svg>
        )
      case 'tree':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3L9 9H5L7 15H4L12 21L20 15H17L19 9H15L12 3Z"/>
          </svg>
        )
      case 'wave':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.69l5.66 5.66c2.64 2.64 2.64 6.93 0 9.57s-6.93 2.64-9.57 0-2.64-6.93 0-9.57L12 2.69M12 5.51L8.22 9.29c-1.53 1.53-1.53 4.02 0 5.55s4.02 1.53 5.55 0 1.53-4.02 0-5.55L12 5.51z"/>
          </svg>
        )
      case 'sunset':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
          </svg>
        )
      case 'flower':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 8.5c-1.5-2-3.5-2.5-5-1.5s-2 3-.5 5c-2 .5-3.5 2-3.5 4s2 3 4.5 3c2 0 3.5-1 4.5-2.5 1 1.5 2.5 2.5 4.5 2.5 2.5 0 4.5-1 4.5-3s-1.5-3.5-3.5-4c1.5-2 1-4-.5-5s-3.5-.5-5 1.5z"/>
          </svg>
        )
      default:
        return null
    }
  }

  // 应用主题切换
  const handleThemeChange = (themeId: string) => {
    const theme = themes.find((t) => t.id === themeId)
    if (theme) {
      applyTheme(theme)
      setCurrentThemeId(themeId)
      // 保存主题配置到数据库
      window.electronAPI.config.save('theme', { name: themeId })
      setShowThemeDropdown(false)
    }
  }

  return (
    <header className="app-header">
      <div className="app-header-left">
        <div className="app-logo">
          <span className="app-logo-text">Nexus Workbench</span>
        </div>
      </div>

      <div className="app-header-right">
        {/* 主题切换器 */}
        <div className="theme-switcher" ref={dropdownRef}>
          <button
            className={`theme-toggle-btn ${
              currentThemeId === 'light' ? 'icon-yellow' :
              currentThemeId === 'deepblue' ? 'icon-blue' :
              currentThemeId === 'green' ? 'icon-green' :
              currentThemeId === 'ocean' ? 'icon-cyan' :
              currentThemeId === 'sunset' ? 'icon-orange' : 'icon-pink'
            }`}
            onClick={() => setShowThemeDropdown(!showThemeDropdown)}
            title={t('header.themeToggle')}
          >
            {/* 根据当前主题显示对应图标 */}
            {renderThemeIcon(currentTheme.icon)}
          </button>

          {showThemeDropdown && (
            <div className="theme-dropdown">
              {themes.map((theme) => (
                <div
                  key={theme.id}
                  className={`theme-option ${currentThemeId === theme.id ? 'active' : ''}`}
                  onClick={() => handleThemeChange(theme.id)}
                >
                  {/* 图标 */}
                  <div className={`theme-option-icon ${
                    theme.id === 'light' ? 'icon-yellow' :
                    theme.id === 'deepblue' ? 'icon-blue' :
                    theme.id === 'green' ? 'icon-green' :
                    theme.id === 'ocean' ? 'icon-cyan' :
                    theme.id === 'sunset' ? 'icon-orange' : 'icon-pink'
                  }`}>
                    {renderThemeIcon(theme.icon)}
                  </div>
                  {/* 名称 */}
                  <span className="theme-option-name">{theme.name}</span>
                  {/* 选中标记 - 右侧对齐 */}
                  {currentThemeId === theme.id && (
                    <svg className="theme-check" viewBox="0 0 24 24" fill="currentColor" style={{ width: '14px', height: '14px' }}>
                      <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                    </svg>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 设置图标 */}
        <button
          className="settings-btn"
          onClick={() => setSettingsModalVisible(true)}
          title={t('common.settings')}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '20px', height: '20px' }}>
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </button>

        {/* 关于我们 */}
        <button className="help-btn" title={t('about.title')} onClick={() => useAppStore.getState().setAboutModalVisible(true)}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
          </svg>
        </button>

        {/* 窗口控制按钮组 — macOS 使用原生 traffic lights，不显示 */}
        {!window.electronAPI?.platform?.isMac && (
          <div className="window-controls">
            <button className="window-control-btn" onClick={() => {
              window.electronAPI?.minimizeWindow?.()
            }} title={t('header.minimize')}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 13H5v-2h14v2z"/>
              </svg>
            </button>
            <button className="window-control-btn" onClick={() => {
              if (isMaximized) {
                window.electronAPI?.unmaximizeWindow?.()
              } else {
                window.electronAPI?.maximizeWindow?.()
              }
            }} title={isMaximized ? t('header.restore') : t('header.maximize')}>
              {isMaximized ? (
                // 还原图标
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 8h14v14H4V8zm2 2v10h10V10H6zm12-6v10h-2V6H8V4h10a2 2 0 0 1 2 2z"/>
                </svg>
              ) : (
                // 最大化图标
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18 4H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H6V6h12v12z"/>
                </svg>
              )}
            </button>
            <button className="window-control-btn close-btn" onClick={handleCloseWindow} title={t('header.closeWindow')}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

export default Header
