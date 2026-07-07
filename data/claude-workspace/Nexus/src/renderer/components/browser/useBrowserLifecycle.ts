/**
 * 浏览器面板 - 生命周期与事件监听 Hook
 *
 * 负责：
 * - 面板初始化（创建 BrowserView + 首个标签 + 初始导航）
 * - 注册 Electron WebContentsView 事件监听器
 * - 清理面板资源
 */

import { useEffect, useRef } from 'react'
import { useAppStore } from '../../store'
import { t } from '../../i18n'
import type { BrowserTab } from '@core/types'
import type { BrowserPanel } from '../../store/types'

interface UseBrowserLifecycleParams {
  panelId: string
  initialUrl: string
  contentRef: React.RefObject<HTMLDivElement | null>
  updateTabState: (panelId: string, tabId: string, patch: Partial<BrowserTab>) => void
  /** 组件显示状态 setters，用于在事件触发时同步更新地址栏 */
  setPageTitle: React.Dispatch<React.SetStateAction<string>>
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  setCurrentUrl: React.Dispatch<React.SetStateAction<string>>
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
}

export function useBrowserLifecycle({
  panelId,
  initialUrl,
  contentRef,
  updateTabState,
  setPageTitle,
  setInputValue,
  setCurrentUrl,
  setIsLoading,
}: UseBrowserLifecycleParams): void {
  const { registerBrowserTab, switchBrowserTab, showContextMenu } = useAppStore()
  const initializedRef = useRef(false)
  // 标记是否为 React StrictMode 的第一次 effect 执行（其 cleanup 不应销毁资源）
  const isMountedRef = useRef(false)

  useEffect(() => {
    isMountedRef.current = true

    const rafId = requestAnimationFrame(async () => {
      if (!contentRef.current) return
      if (initializedRef.current) return
      initializedRef.current = true

      try {
        // 创建浏览器面板（不含 View）
        await window.electronAPI.browser.createBrowserView(panelId)

        // 使用已有的第一个标签，或创建一个新的
        const panel = useAppStore.getState().panels.find((p) => p.id === panelId) as BrowserPanel | undefined
        const tabsList = Array.from(
          panel?.browserTabs?.values() || []
        )
        const firstTabId = tabsList.length > 0
          ? tabsList[0].id
          : useAppStore.getState().addBrowserTab(panelId, initialUrl)

        const rect = contentRef.current.getBoundingClientRect()
        await window.electronAPI.browser.createTab(panelId, firstTabId, {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })

        // 切换到新创建的 View
        await window.electronAPI.browser.setActiveView(panelId, firstTabId)

        // 初始导航：如果 URL 是 about:blank，加载默认网址；否则导航到保存的 URL
        const browserPanel = useAppStore.getState().panels.find((p) => p.id === panelId) as BrowserPanel | undefined
        const firstTab = browserPanel?.browserTabs?.get(firstTabId)
        let urlToNavigate = firstTab?.url || initialUrl
        if (!urlToNavigate || urlToNavigate === 'about:blank') {
          // 读取配置的默认网址
          try {
            const configUrl = await window.electronAPI.config.get('browserDefaultUrl')
            if (configUrl && typeof configUrl === 'string' && configUrl.trim()) {
              urlToNavigate = configUrl.trim()
              // 更新 store 中的 URL
              updateTabState(panelId, firstTabId, { url: urlToNavigate })
            }
          } catch {}
        }
        if (urlToNavigate && urlToNavigate !== 'about:blank') {
          await window.electronAPI.browser.navigate(panelId, firstTabId, urlToNavigate)
        }
      } catch (error) {
        console.error(t('browser.initError'), error)
      }
    })

    // 监听导航事件（携带 tabId）
    const unsubNavigating = window.electronAPI.browser.onNavigating((data) => {
      if (data.browserId === panelId) {
        updateTabState(panelId, data.tabId, { isLoading: true })
        const bp = useAppStore.getState().panels.find((p) => p.id === panelId) as BrowserPanel | undefined
        const storeActiveTabId = bp?.activeTabId
        if (data.tabId === storeActiveTabId) {
          setIsLoading(true)
          // 不更新地址栏——重定向链中 did-start-navigation 会多次触发，
          // 中间跳转 URL 会污染地址栏。最终 URL 由 onDidNavigate 更新。
        }
      }
    })

    const unsubDidNavigate = window.electronAPI.browser.onDidNavigate((data) => {
      if (data.browserId === panelId) {
        updateTabState(panelId, data.tabId, { url: data.url, isLoading: false })
        const bp2 = useAppStore.getState().panels.find((p) => p.id === panelId) as BrowserPanel | undefined
        const storeActiveTabId = bp2?.activeTabId
        if (data.tabId === storeActiveTabId) {
          setCurrentUrl(data.url)
          setInputValue(data.url)
          setIsLoading(false)
        }

        if (data.url !== 'about:blank') {
          const bp3 = useAppStore.getState().panels.find((p) => p.id === panelId) as BrowserPanel | undefined
          const tab = bp3?.browserTabs?.get(data.tabId)
          window.electronAPI.browser.history.save(data.url, tab?.title || data.url)
        }
      }
    })

    const unsubTitle = window.electronAPI.browser.onPageTitleUpdated((data) => {
      if (data.browserId === panelId) {
        const title = data.title || t('browser.browserTitle')
        updateTabState(panelId, data.tabId, { title })
        const bp4 = useAppStore.getState().panels.find((p) => p.id === panelId) as BrowserPanel | undefined
        const storeActiveTabId = bp4?.activeTabId
        if (data.tabId === storeActiveTabId) {
          setPageTitle(title)
        }
      }
    })

    const unsubFavicon = window.electronAPI.browser.onPageFaviconUpdated((data) => {
      if (data.browserId === panelId) {
        if (data.favicons && data.favicons.length > 0) {
          updateTabState(panelId, data.tabId, { favicon: data.favicons[0] })
        }
      }
    })

    const unsubContextMenu = window.electronAPI.browser.onContextMenu((data) => {
      if (data.browserId === panelId) {
        const bp5 = useAppStore.getState().panels.find((p) => p.id === panelId) as BrowserPanel | undefined
        const storeActiveTabId = bp5?.activeTabId
        if (data.tabId === storeActiveTabId) {
          showContextMenu(data.x, data.y, undefined, panelId, false)
        }
      }
    })

    // 监听 window.open() 拦截事件（主进程创建了新标签，通知渲染进程注册）
    const unsubWindowOpen = window.electronAPI.browser.onWindowOpen((data) => {
      if (data.browserId === panelId) {
        // 注册主进程创建的标签到 store
        registerBrowserTab(panelId, data.newTabId, data.url)
        // 如果是前台标签，切换到新标签并更新地址栏
        if (data.disposition === 'foreground-tab' || data.disposition === 'default' || data.disposition === 'new-window') {
          switchBrowserTab(panelId, data.newTabId)
          setPageTitle(t('browser.newTab'))
          setInputValue(data.url)
          setCurrentUrl(data.url)
          setIsLoading(true)
        }
      }
    })

    return () => {
      cancelAnimationFrame(rafId)
      isMountedRef.current = false
      unsubNavigating()
      unsubDidNavigate()
      unsubTitle()
      unsubFavicon()
      unsubContextMenu()
      unsubWindowOpen()

      // 仅在组件真正卸载时（StrictMode 第二次 effect 的 cleanup）才销毁资源
      // 第一次 effect 的 cleanup 触发时，isMountedRef 已被第二次 effect 设为 true
      if (!isMountedRef.current) {
        window.electronAPI.browser.destroy(panelId).catch(() => {})
      }
    }
  }, [])
}
