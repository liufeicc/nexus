/**
 * 浏览器面板组件（多标签版本）
 *
 * 使用 Electron WebContentsView 渲染网页内容。
 * 每个浏览器面板内部支持多个标签页，每个标签对应一个独立的 WebContentsView。
 * 标签间共享 session（Cookie、localStorage 等）。
 *
 * 逻辑拆分为以下自定义 Hook：
 * - useBrowserNavigation: 导航操作（前进/后退/刷新/停止）
 * - useBrowserTabs: 标签操作（新建/关闭/切换）
 * - useBrowserAddressBar: 地址栏输入与 URL 自动补全
 * - useBrowserLifecycle: 面板初始化与 Electron 事件监听
 * - useBrowserViewSync: WebContentsView 边界同步与隐藏/恢复
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore, captureAllBrowsersBeforeModal, clearAllBrowserSnapshots } from '../../store'
import { BasePanel } from '../common/BasePanel'
import { BrowserTabBar } from './BrowserTabBar'
import type { Bookmark, BrowserTab } from '@core/types'
import type { BrowserPanel } from '../../store/types'
import { useBrowserNavigation } from './useBrowserNavigation'
import { useBrowserTabs } from './useBrowserTabs'
import { useBrowserAddressBar } from './useBrowserAddressBar'
import { useBrowserLifecycle } from './useBrowserLifecycle'
import { useBrowserViewSync } from './useBrowserViewSync'
import { useI18n } from '../../i18n'

interface BrowserPanelProps {
  /** 面板唯一 ID */
  panelId: string
  /** 初始 URL（仅首个标签使用） */
  initialUrl?: string
}

/**
 * 浏览器面板组件
 */
export function BrowserPanel({ panelId, initialUrl = 'about:blank' }: BrowserPanelProps) {
  const {
    updateTabState,
    closePanel,
    browserSnapshots,
    showContextMenu,
    showToast,
    showConfirmModal,
    nexusBrowserPanelId,
    setNexusBrowserPanelId,
  } = useAppStore()
  const { t } = useI18n()

  // 从 store 获取标签列表和活动标签
  const panel = useAppStore((state) => state.panels.find((p) => p.id === panelId)) as BrowserPanel | undefined
  const browserTabs = panel?.browserTabs || new Map<string, BrowserTab>()
  const activeTabId = panel?.activeTabId || null
  const activeTab = activeTabId ? browserTabs.get(activeTabId) : null
  const tabsList = Array.from(browserTabs.values())

  // 截图快照（用于模态/菜单时隐藏浏览器内容）
  const browserSnapshot = browserSnapshots.get(panelId)

  // 内容区域 ref（WebContentsView 嵌入区域）
  const contentRef = useRef<HTMLDivElement>(null)

  // 显示状态 — 如果 store 中的标题是未翻译的 i18n key（如 "panel.newTab"），用组件内的 t() 正确翻译
  const resolvedInitialTitle = (() => {
    const raw = activeTab?.title
    if (!raw) return t('browser.browserTitle')
    // 检测是否为未翻译的 i18n key（包含点号且不含空格）
    if (raw.includes('.') && !raw.includes(' ') && raw.length < 40) {
      return t(raw)
    }
    return raw
  })()
  const [pageTitle, setPageTitle] = useState(resolvedInitialTitle)
  const [isLoading, setIsLoading] = useState(false)
  const [currentUrl, setCurrentUrl] = useState(activeTab?.url || 'about:blank')

  // 书签下拉框状态
  const [bookmarkDropdownVisible, setBookmarkDropdownVisible] = useState(false)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const bookmarkDropdownRef = useRef<HTMLDivElement>(null)

  // 默认网址状态
  const [defaultUrl, setDefaultUrl] = useState('')

  // 刷新书签列表（用于地址栏按钮切换后更新状态）
  const refreshBookmarks = useCallback(async () => {
    try {
      const list = await window.electronAPI.browser.bookmark.list()
      setBookmarks(list)
    } catch {
      setBookmarks([])
    }
  }, [])

  // 初始化：加载默认网址配置
  useEffect(() => {
    window.electronAPI.config.get('browserDefaultUrl').then((url) => {
      setDefaultUrl(typeof url === 'string' ? url : '')
    }).catch(() => {})
    // 初始加载书签列表（供地址栏按钮判断状态）
    refreshBookmarks()
  }, [refreshBookmarks])

  // 拖动排序状态
  const dragItemRef = useRef<number | null>(null)
  const dragOverItemRef = useRef<number | null>(null)

  // Nexus 连接状态（浏览器使用浏览器轨）
  const isConnected = nexusBrowserPanelId === panelId
  // 不再禁用其他面板的按钮，点击即可"抢占"连接

  // 点击外部关闭书签下拉框
  useEffect(() => {
    if (!bookmarkDropdownVisible) return

    const handleClickOutside = (e: MouseEvent) => {
      if (bookmarkDropdownRef.current && !bookmarkDropdownRef.current.contains(e.target as Node)) {
        setBookmarkDropdownVisible(false)
        clearAllBrowserSnapshots()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [bookmarkDropdownVisible])

  // 执行连接操作（清场 + 锁定）
  const doConnect = useCallback(async () => {
    // 第1步：先建立连接，按钮立即变为选中状态
    await window.electronAPI.nexus.connectBrowser(panelId)
    setNexusBrowserPanelId(panelId)
    showToast(t('filePanel.connectNexus'), 1500)

    // 后续清场操作独立容错，不影响连接状态
    try {
      const getPanel = () =>
        useAppStore.getState().panels.find((p) => p.id === panelId) as BrowserPanel | undefined

      // 第2步：先创建新空白标签（保证面板始终有标签）
      const rect = contentRef.current?.getBoundingClientRect()
      const newTabId = useAppStore.getState().addBrowserTab(panelId, 'about:blank')
      if (rect) {
        await window.electronAPI.browser.createTab(panelId, newTabId, {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })
        await window.electronAPI.browser.setActiveView(panelId, newTabId)
      }
      useAppStore.getState().switchBrowserTab(panelId, newTabId)

      // 第3步：关闭所有旧标签（新标签已在显示）
      const oldTabs = Array.from(getPanel()?.browserTabs?.values() || [])
        .filter((tab) => tab.id !== newTabId)
      for (const tab of oldTabs) {
        try {
          await window.electronAPI.browser.removeTab(panelId, tab.id)
        } catch {
          // 标签可能已销毁
        }
        useAppStore.getState().closeBrowserTab(panelId, tab.id)
      }

      // 第4步：锁定新标签（注入 CSS/JS 阻止用户交互）
      await window.electronAPI.browser.lockTab(panelId, newTabId)
    } catch (error) {
      console.error('[Nexus] 浏览器清场操作部分失败:', error)
    }
  }, [panelId, contentRef, setNexusBrowserPanelId, showToast, t])

  // Nexus 连接切换处理
  const handleToggleNexus = useCallback(async () => {
    if (isConnected) {
      // === 断开：解锁 + 恢复 ===
      if (activeTabId) {
        try {
          await window.electronAPI.browser.unlockTab(panelId, activeTabId)
        } catch {
          // 标签可能已被关闭
        }
      }
      window.electronAPI.nexus.disconnectBrowser()
      setNexusBrowserPanelId(null)
      showToast(t('filePanel.disconnectNexus'), 1500)
    } else {
      // === 连接：先截图隐藏 WebContentsView，再弹出确认框 ===
      await captureAllBrowsersBeforeModal()
      showConfirmModal(
        t('filePanel.nexusConnectConfirmTitle'),
        t('filePanel.nexusConnectConfirmMsg'),
        () => { doConnect() },
      )
    }
  }, [isConnected, panelId, activeTabId, setNexusBrowserPanelId, showToast, t, showConfirmModal, doConnect])

  // 监听连接状态变化（主进程通知，只处理浏览器轨事件）
  useEffect(() => {
    const cleanup = window.electronAPI.nexus.onConnectionStateChanged((data) => {
      if (data.track !== 'browser') return
      if (data.connected) {
        setNexusBrowserPanelId(data.panelId)
      } else {
        setNexusBrowserPanelId(null)
      }
    })
    return cleanup
  }, [setNexusBrowserPanelId])

  // 组件卸载时自动断开连接
  useEffect(() => {
    return () => {
      const state = useAppStore.getState()
      if (state.nexusBrowserPanelId === panelId) {
        // 解锁所有标签
        const panel = state.panels.find((p) => p.id === panelId) as BrowserPanel | undefined
        if (panel?.browserTabs) {
          for (const tabId of panel.browserTabs.keys()) {
            window.electronAPI.browser.unlockTab(panelId, tabId).catch(() => {})
          }
        }
        window.electronAPI.nexus.disconnectBrowser()
        state.setNexusBrowserPanelId(null)
      }
    }
  }, [panelId])

  // ==================== Hooks ====================

  const { navigateTo, handleGoBack, handleGoForward, handleReload, handleStop, canGoBack, canGoForward } =
    useBrowserNavigation({ panelId, activeTabId, updateTabState })

  const addressBar = useBrowserAddressBar({
    activeTabId,
    currentTabUrl: currentUrl,
    navigateTo,
    bookmarks,
    defaultUrl,
    refreshBookmarks,
  })

  const { handleNewTab, handleCloseTab, handleSwitchTab } = useBrowserTabs({
    panelId,
    contentRef,
    navigateTo,
    updateTabState,
    setPageTitle,
    setInputValue: addressBar.setInputValue,
    setCurrentUrl,
    setIsLoading,
  })

  useBrowserLifecycle({
    panelId,
    initialUrl,
    contentRef,
    updateTabState,
    setPageTitle,
    setInputValue: addressBar.setInputValue,
    setCurrentUrl,
    setIsLoading,
  })

  useBrowserViewSync({
    panelId,
    activeTabId,
    contentRef,
  })

  // ==================== 书签操作 ====================

  /**
   * 打开/关闭书签下拉框
   */
  const handleToggleBookmarkDropdown = useCallback(async () => {
    if (bookmarkDropdownVisible) {
      setBookmarkDropdownVisible(false)
      clearAllBrowserSnapshots()
    } else {
      // 先隐藏 WebContentsView（将 bounds 设为 0），避免遮挡下拉框
      if (activeTabId) {
        window.electronAPI.browser.setBounds(panelId, activeTabId, { x: 0, y: 0, width: 0, height: 0 })
      }
      // 再截图占位（与右键菜单一致）
      await captureAllBrowsersBeforeModal()
      try {
        const list = await window.electronAPI.browser.bookmark.list()
        setBookmarks(list)
      } catch {
        setBookmarks([])
      }
      setBookmarkDropdownVisible(true)
    }
  }, [bookmarkDropdownVisible, panelId, activeTabId])

  /**
   * 点击书签，打开新标签页
   */
  const handleOpenBookmark = useCallback(async (bookmark: Bookmark) => {
    setBookmarkDropdownVisible(false)
    clearAllBrowserSnapshots()

    // 创建新标签并导航到书签 URL
    const state = useAppStore.getState()
    const tabId = state.addBrowserTab(panelId, bookmark.url)

    if (contentRef.current) {
      const rect = contentRef.current.getBoundingClientRect()
      await window.electronAPI.browser.createTab(panelId, tabId, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }

    // 切换到新标签
    state.switchBrowserTab(panelId, tabId)
    await window.electronAPI.browser.setActiveView(panelId, tabId)
    updateTabState(panelId, tabId, { isLoading: true })
    setPageTitle(bookmark.title)
    addressBar.setInputValue(bookmark.url)
    setCurrentUrl(bookmark.url)
    setIsLoading(true)

    await window.electronAPI.browser.navigate(panelId, tabId, bookmark.url)
  }, [panelId, contentRef, updateTabState, setPageTitle, addressBar.setInputValue, setCurrentUrl, setIsLoading])

  /**
   * 删除书签
   */
  const handleDeleteBookmark = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await window.electronAPI.browser.bookmark.delete(id)
      setBookmarks((prev) => prev.filter((b) => b.id !== id))
    } catch {
      // 忽略错误
    }
  }, [])

  /**
   * 拖动排序：拖动开始
   */
  const handleDragStart = useCallback((index: number) => {
    dragItemRef.current = index
  }, [])

  /**
   * 拖动排序：拖到目标位置
   */
  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    dragOverItemRef.current = index
  }, [])

  /**
   * 拖动排序：放下，重新排序
   */
  const handleDrop = useCallback(async () => {
    const dragIndex = dragItemRef.current
    const overIndex = dragOverItemRef.current
    if (dragIndex === null || overIndex === null || dragIndex === overIndex) {
      dragItemRef.current = null
      dragOverItemRef.current = null
      return
    }

    // 重新排列数组
    const newBookmarks = [...bookmarks]
    const [draggedItem] = newBookmarks.splice(dragIndex, 1)
    newBookmarks.splice(overIndex, 0, draggedItem)

    // 计算新的 sortOrder
    const reordered = newBookmarks.map((b, i) => ({ id: b.id, sortOrder: i + 1 }))

    setBookmarks(newBookmarks)
    dragItemRef.current = null
    dragOverItemRef.current = null

    try {
      await window.electronAPI.browser.bookmark.reorder(reordered)
    } catch {
      // 忽略错误
    }
  }, [bookmarks])

  // 自定义右键菜单（导航栏和标签条区域）
  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const toolbar =
        target.closest('.browser-nav') || target.closest('.browser-tab-bar')
      if (toolbar) {
        showContextMenu(e.clientX, e.clientY, undefined, panelId, false)
      }
    },
    [panelId, showContextMenu]
  )

  // ==================== 渲染 ====================

  const headerLeft = (
    <>
      <svg className="icon" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '4px' }}>
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
      </svg>
      <span className="terminal-title">{pageTitle}</span>
    </>
  )

  // Nexus 连接按钮 SVG 图标
  const nexusButtonIcon = (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a6 6 0 0 1-12 0V8z" />
    </svg>
  )

  return (
    <BasePanel
      panelId={panelId}
      displayTitle={pageTitle}
      headerLeft={headerLeft}
      headerRightBefore={
        <button
          className={`terminal-nexus-btn ${isConnected ? 'nexus-connected' : ''}`}
          onClick={handleToggleNexus}
          disabled={!activeTabId}
          title={isConnected ? t('filePanel.disconnectNexus') : !activeTabId ? t('browser.noTabOpen') : t('filePanel.connectNexus')}
        >
          {nexusButtonIcon}
        </button>
      }
      onClose={() => closePanel(panelId)}
      onContextMenu={handleContextMenu}
    >
      <div className="browser-panel-container">
        {/* 标签条 */}
        <BrowserTabBar
          panelId={panelId}
          tabs={tabsList}
          activeTabId={activeTabId}
          onSwitchTab={handleSwitchTab}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewTab}
          locked={isConnected}
        />

        {/* 浏览器导航栏（无标签时隐藏） */}
        {tabsList.length > 0 && (
        <div className={`browser-nav${isLoading ? ' loading' : ''}${isConnected ? ' nexus-locked' : ''}`}>
          {/* 书签列表按钮 */}
          <button
            className={`browser-nav-btn${bookmarkDropdownVisible ? ' active' : ''}`}
            title={t('browser.bookmarks')}
            onClick={handleToggleBookmarkDropdown}
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/>
            </svg>
          </button>

          <div className="browser-nav-buttons">
            <button className="browser-nav-btn" title={t('browser.back')} onClick={handleGoBack} disabled={!canGoBack}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
              </svg>
            </button>

            <button className="browser-nav-btn" title={t('browser.forward')} onClick={handleGoForward} disabled={!canGoForward}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/>
              </svg>
            </button>

            <button className="browser-nav-btn browser-nav-btn-refresh" title={t('browser.refresh')} onClick={handleReload}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
              </svg>
            </button>

            <button className="browser-nav-btn browser-nav-btn-stop" title={t('browser.stopLoading')} onClick={handleStop}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h12v12H6z"/>
              </svg>
            </button>
          </div>

          <div className="browser-address-bar-wrapper">
            {addressBar.inlineSuggestion && addressBar.inputValue && (
              <div
                className="browser-inline-suggestion"
                aria-hidden="true"
                style={{ transform: `translateX(${-addressBar.inputScrollLeft}px)` }}
              >
                <span className="browser-inline-suggestion-prefix">{addressBar.inputValue}</span>
                <span className="browser-inline-suggestion-ghost">
                  {addressBar.inlineSuggestion.slice(addressBar.inputValue.length)}
                </span>
              </div>
            )}
            <input
              ref={addressBar.inputRef}
              className="browser-address-bar"
              type="text"
              value={addressBar.inputValue}
              onChange={addressBar.handleInputChange}
              onKeyDown={addressBar.handleUrlSubmit}
              onFocus={addressBar.handleInputFocus}
              onBlur={addressBar.handleInputBlur}
              onScroll={(e) => addressBar.setInputScrollLeft(e.currentTarget.scrollLeft)}
              placeholder={t('browser.enterUrl')}
              autoComplete="off"
            />
            <svg className="browser-address-bar-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM15.1 8H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/>
            </svg>
            {/* 添加/移除书签按钮 */}
            <button
              className={`browser-address-bar-add-bookmark${addressBar.isBookmarked ? ' active' : ''}`}
              title={addressBar.isBookmarked ? t('browser.removeBookmark') : t('browser.addBookmark')}
              onClick={addressBar.handleAddBookmark}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/>
              </svg>
            </button>
            {/* 设置/取消默认网址按钮 */}
            <button
              className={`browser-address-bar-set-default${addressBar.isDefaultUrl ? ' active' : ''}`}
              title={addressBar.isDefaultUrl ? t('browser.unsetDefaultUrl') : t('browser.setDefaultUrl')}
              onClick={addressBar.handleSetDefaultUrl}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.611 3.611 0 0112 15.6z"/>
              </svg>
            </button>
            <button
              className="browser-address-bar-clear"
              title={t('common.clear')}
              onClick={addressBar.handleClearInput}
            >
              ×
            </button>
          </div>
        </div>
        )}

        {/* 书签下拉框 */}
        {bookmarkDropdownVisible && (
          <div ref={bookmarkDropdownRef} className="browser-bookmark-dropdown">
            {bookmarks.length === 0 ? (
              <div className="browser-bookmark-empty">暂无书签</div>
            ) : (
              bookmarks.map((bookmark, index) => (
                <div
                  key={bookmark.id}
                  className="browser-bookmark-item"
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={handleDrop}
                  onClick={() => handleOpenBookmark(bookmark)}
                >
                  <div className="browser-bookmark-item-content">
                    <div className="browser-bookmark-item-title">{bookmark.title}</div>
                    <div className="browser-bookmark-item-url">{bookmark.url}</div>
                  </div>
                  <button
                    className="browser-bookmark-item-delete"
                    title={t('browser.deleteBookmark')}
                    onClick={(e) => handleDeleteBookmark(bookmark.id, e)}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* 加载进度条 */}
        {isLoading && tabsList.length > 0 && (
          <div className="browser-progress-bar-container">
            <div className="browser-progress-bar" style={{ width: '60%' }} />
          </div>
        )}

        {/* 浏览器内容区域 */}
        <div ref={contentRef} className="browser-content">
          {browserSnapshot && (
            <img
              src={browserSnapshot}
              className="browser-snapshot"
              alt=""
            />
          )}
        </div>
      </div>
    </BasePanel>
  )
}

export default BrowserPanel
