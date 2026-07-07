/**
 * 浏览器面板 - 导航 Hook
 *
 * 管理 URL 导航、前进/后退/刷新/停止等操作。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserTab } from '@core/types'
import { normalizeUrl } from '@core/utils/url'

interface UseBrowserNavigationParams {
  panelId: string
  activeTabId: string | null
  updateTabState: (panelId: string, tabId: string, patch: Partial<BrowserTab>) => void
}

interface UseBrowserNavigationReturn {
  navigateTo: (url: string) => Promise<void>
  handleGoBack: () => void
  handleGoForward: () => void
  handleReload: () => void
  handleStop: () => void
  canGoBack: boolean
  canGoForward: boolean
}

export function useBrowserNavigation({
  panelId,
  activeTabId,
  updateTabState,
}: UseBrowserNavigationParams): UseBrowserNavigationReturn {
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const activeTabIdRef = useRef(activeTabId)

  /**
   * 查询当前活动标签的前进/后退状态
   */
  const updateNavigationState = useCallback(async () => {
    if (!activeTabIdRef.current) return
    try {
      const [back, forward] = await Promise.all([
        window.electronAPI.browser.canGoBack(panelId, activeTabIdRef.current),
        window.electronAPI.browser.canGoForward(panelId, activeTabIdRef.current),
      ])
      setCanGoBack(back)
      setCanGoForward(forward)
    } catch (error) {
      // 面板刚创建时可能还未在主进程中完全注册，忽略此临时错误
    }
  }, [panelId])

  // 监听导航事件，更新前进/后退状态
  useEffect(() => {
    const unsubDidNavigate = window.electronAPI.browser.onDidNavigate((data) => {
      if (data.browserId === panelId) {
        activeTabIdRef.current = data.tabId
        updateNavigationState()
      }
    })

    const unsubDidNavigateInPage = window.electronAPI.browser.onDidNavigateInPage((data) => {
      if (data.browserId === panelId) {
        activeTabIdRef.current = data.tabId
        updateNavigationState()
      }
    })

    return () => {
      unsubDidNavigate()
      unsubDidNavigateInPage()
    }
  }, [panelId, updateNavigationState])

  // activeTabId 变化时也更新（比如切换标签）
  useEffect(() => {
    activeTabIdRef.current = activeTabId
    updateNavigationState()
  }, [activeTabId, updateNavigationState])

  /**
   * 导航到指定 URL
   */
  const navigateTo = useCallback(
    async (url: string) => {
      if (!url || url.trim() === '' || !activeTabId) return

      const targetUrl = normalizeUrl(url)
      if (!targetUrl) return

      try {
        await window.electronAPI.browser.navigate(panelId, activeTabId, targetUrl)
      } catch (error) {
        console.error('[BrowserPanel] 导航失败:', error)
      }
    },
    [panelId, activeTabId]
  )

  const handleGoBack = useCallback(() => {
    if (activeTabId) window.electronAPI.browser.goBack(panelId, activeTabId)
  }, [panelId, activeTabId])

  const handleGoForward = useCallback(() => {
    if (activeTabId) window.electronAPI.browser.goForward(panelId, activeTabId)
  }, [panelId, activeTabId])

  const handleReload = useCallback(() => {
    if (activeTabId) window.electronAPI.browser.reload(panelId, activeTabId)
  }, [panelId, activeTabId])

  const handleStop = useCallback(() => {
    if (activeTabId) window.electronAPI.browser.stop(panelId, activeTabId)
  }, [panelId, activeTabId])

  return {
    navigateTo,
    handleGoBack,
    handleGoForward,
    handleReload,
    handleStop,
    canGoBack,
    canGoForward,
  }
}
