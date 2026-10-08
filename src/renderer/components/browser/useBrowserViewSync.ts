/**
 * 浏览器面板 - WebContentsView 同步 Hook
 *
 * 负责：
 * - 通过 ResizeObserver 同步 WebContentsView 边界与 DOM 区域
 * - 右键菜单/截图时隐藏/恢复 WebContentsView
 */

import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '../../store'

interface UseBrowserViewSyncParams {
  panelId: string
  activeTabId: string | null
  contentRef: React.RefObject<HTMLDivElement | null>
}

export function useBrowserViewSync({
  panelId,
  activeTabId,
  contentRef,
}: UseBrowserViewSyncParams): void {
  // 模态框已迁移至共享置顶弹层窗口（浮于原生层之上），无需再为其隐藏；
  // 仅主窗口本地弹层（如书签下拉框）通过 browserSnapshots 触发隐藏
  const { browserSnapshots } = useAppStore()

  /**
   * 计算并更新当前活动标签的 WebContentsView 边界
   */
  const updateBrowserBounds = useCallback(() => {
    if (!contentRef.current || !activeTabId) return

    const rect = contentRef.current.getBoundingClientRect()
    const bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }

    window.electronAPI.browser.setBounds(panelId, activeTabId, bounds)
  }, [panelId, activeTabId, contentRef])

  // ResizeObserver 同步边界
  useEffect(() => {
    if (!contentRef.current || !activeTabId) return

    updateBrowserBounds()

    const observer = new ResizeObserver(() => {
      updateBrowserBounds()
    })
    observer.observe(contentRef.current)

    return () => observer.disconnect()
  }, [updateBrowserBounds])

  // 隐藏/恢复 WebContentsView：仅主窗口本地弹层（browserSnapshots）触发隐藏
  const shouldHideView = browserSnapshots.has(panelId)
  const wasHiddenRef = useRef(false)

  useEffect(() => {
    if (!contentRef.current || !activeTabId) return

    if (shouldHideView && !wasHiddenRef.current) {
      wasHiddenRef.current = true
      window.electronAPI.browser.setBounds(panelId, activeTabId, {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      })
    } else if (!shouldHideView && wasHiddenRef.current) {
      wasHiddenRef.current = false
      const rect = contentRef.current.getBoundingClientRect()
      window.electronAPI.browser.setBounds(panelId, activeTabId, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }
  }, [panelId, shouldHideView, activeTabId, contentRef])
}
