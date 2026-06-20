/**
 * 渲染进程状态管理 - 辅助函数
 */

import { useAppStore } from './store'
import type { BrowserPanel } from './types'

/**
 * 弹窗打开前：截取所有浏览器面板当前活动标签的 WebContentsView
 */
export async function captureAllBrowsersBeforeModal(): Promise<void> {
  const state = useAppStore.getState()
  const panels = state.panels
  const browserPanels = panels.filter((p): p is BrowserPanel => p.panelType === 'browser')

  for (const panel of browserPanels) {
    // 跳过已有快照的面板（避免重复截图导致 WebContentsView 闪烁）
    if (state.browserSnapshots.has(panel.id)) continue
    if (panel.activeTabId && panel.browserTabs?.has(panel.activeTabId)) {
      try {
        const dataUrl = await window.electronAPI.browser.capturePage(panel.id, panel.activeTabId)
        useAppStore.getState().setBrowserSnapshot(panel.id, dataUrl)
      } catch {
        // 可能已销毁，忽略
      }
    }
  }
}

/**
 * 弹窗关闭后：清除所有截图占位
 */
export function clearAllBrowserSnapshots(): void {
  const panels = useAppStore.getState().panels
  const browserPanels = panels.filter((p): p is BrowserPanel => p.panelType === 'browser')

  for (const panel of browserPanels) {
    useAppStore.getState().setBrowserSnapshot(panel.id, null)
  }
}
