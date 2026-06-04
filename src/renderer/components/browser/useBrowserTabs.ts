/**
 * 浏览器面板 - 标签操作 Hook
 *
 * 管理浏览器面板内的标签页新建、关闭、切换操作。
 * 每次操作都同步更新 store 状态和主进程 WebContentsView。
 */

import { useCallback } from 'react'
import { useAppStore } from '../../store'
import { t } from '../../i18n'
import type { BrowserTab } from '@core/types'
import type { BrowserPanel } from '../../store/types'

interface UseBrowserTabsParams {
  panelId: string
  contentRef: React.RefObject<HTMLDivElement | null>
  navigateTo: (url: string) => Promise<void>
  updateTabState: (panelId: string, tabId: string, patch: Partial<BrowserTab>) => void
  setPageTitle: React.Dispatch<React.SetStateAction<string>>
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  setCurrentUrl: React.Dispatch<React.SetStateAction<string>>
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
}

interface UseBrowserTabsReturn {
  handleNewTab: () => Promise<void>
  handleCloseTab: (tabId: string) => Promise<void>
  handleSwitchTab: (tabId: string) => Promise<void>
}

/**
 * 更新地址栏显示状态（从指定标签的数据）
 */
function syncAddressBarToTab(
  tab: BrowserTab,
  setPageTitle: UseBrowserTabsParams['setPageTitle'],
  setInputValue: UseBrowserTabsParams['setInputValue'],
  setCurrentUrl: UseBrowserTabsParams['setCurrentUrl'],
  setIsLoading: UseBrowserTabsParams['setIsLoading'],
): void {
  // 如果标题是未翻译的 i18n key（如 "panel.newTab"），用 t() 正确翻译
  let displayTitle = tab.title || t('browser.browserTitle')
  if (displayTitle.includes('.') && !displayTitle.includes(' ') && displayTitle.length < 40) {
    displayTitle = t(displayTitle)
  }
  setPageTitle(displayTitle)
  setInputValue(tab.url === 'about:blank' ? '' : tab.url)
  setCurrentUrl(tab.url)
  setIsLoading(tab.isLoading)
}

export function useBrowserTabs({
  panelId,
  contentRef,
  navigateTo,
  updateTabState,
  setPageTitle,
  setInputValue,
  setCurrentUrl,
  setIsLoading,
}: UseBrowserTabsParams): UseBrowserTabsReturn {
  const { addBrowserTab, closeBrowserTab, switchBrowserTab } = useAppStore()

  /**
   * 新建标签页
   */
  const handleNewTab = useCallback(async () => {
    let defaultUrl = 'about:blank'
    try {
      const configUrl = await window.electronAPI.config.get('browserDefaultUrl')
      if (configUrl && typeof configUrl === 'string' && configUrl.trim()) {
        defaultUrl = configUrl.trim()
      }
    } catch {}

    const tabId = addBrowserTab(panelId, defaultUrl)

    // 创建主进程的 View
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
    switchBrowserTab(panelId, tabId)
    await window.electronAPI.browser.setActiveView(panelId, tabId)

    // 设置加载状态
    updateTabState(panelId, tabId, { isLoading: true })
    setPageTitle(t('browser.newTab'))
    setInputValue('')
    setCurrentUrl(defaultUrl)
    setIsLoading(true)

    // 初始导航（直接使用新 tabId，不依赖 activeTabId，因为 React state 更新是异步的）
    if (defaultUrl !== 'about:blank') {
      await window.electronAPI.browser.navigate(panelId, tabId, defaultUrl)
    }
  }, [panelId, contentRef, addBrowserTab, switchBrowserTab, updateTabState, navigateTo, setPageTitle, setInputValue, setCurrentUrl, setIsLoading])

  /**
   * 关闭标签页
   */
  const handleCloseTab = useCallback(
    async (tabId: string) => {
      // 先移除主进程的 View
      await window.electronAPI.browser.removeTab(panelId, tabId).catch(() => {})
      // 再更新 store（store 内部会计算新的 activeTabId）
      closeBrowserTab(panelId, tabId)

      // 如果关闭的是活动标签，切换到新的活动标签
      const panel = useAppStore.getState().panels.find((p) => p.id === panelId) as BrowserPanel | undefined
      if (panel && panel.activeTabId && panel.activeTabId !== tabId) {
        await window.electronAPI.browser.setActiveView(panelId, panel.activeTabId)

        // 更新地址栏状态
        const newActiveTab = panel.browserTabs?.get(panel.activeTabId)
        if (newActiveTab) {
          updateTabState(panelId, panel.activeTabId, {
            url: newActiveTab.url,
            title: newActiveTab.title,
            isLoading: newActiveTab.isLoading,
          })
          syncAddressBarToTab(newActiveTab, setPageTitle, setInputValue, setCurrentUrl, setIsLoading)
        }
      }
    },
    [panelId, closeBrowserTab, updateTabState, setPageTitle, setInputValue, setCurrentUrl, setIsLoading]
  )

  /**
   * 切换活动标签
   */
  const handleSwitchTab = useCallback(
    async (tabId: string) => {
      switchBrowserTab(panelId, tabId)

      // 切换主进程的 View 显示
      await window.electronAPI.browser.setActiveView(panelId, tabId)

      // 更新 bounds
      if (contentRef.current) {
        const rect = contentRef.current.getBoundingClientRect()
        await window.electronAPI.browser.setBounds(panelId, tabId, {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })
      }

      // 更新地址栏状态
      const panel2 = useAppStore.getState().panels.find((p) => p.id === panelId) as BrowserPanel | undefined
      const tab = panel2?.browserTabs?.get(tabId)
      if (tab) {
        updateTabState(panelId, tabId, {
          url: tab.url,
          title: tab.title,
          isLoading: tab.isLoading,
        })
        syncAddressBarToTab(tab, setPageTitle, setInputValue, setCurrentUrl, setIsLoading)
      }
    },
    [panelId, contentRef, switchBrowserTab, updateTabState, setPageTitle, setInputValue, setCurrentUrl, setIsLoading]
  )

  return { handleNewTab, handleCloseTab, handleSwitchTab }
}
