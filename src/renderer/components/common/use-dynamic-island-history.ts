/**
 * 灵动岛输入历史 Hook
 * 从 DynamicIsland.tsx 提取
 * 职责：输入历史面板状态、加载/删除历史条目
 */

import { useState, useCallback } from 'react'

export interface UseDynamicIslandHistoryOutput {
  showHistoryPanel: boolean
  historyEntries: Array<{ id: number; text: string; createdAt: number }>
  handleToggleHistory: () => Promise<void>
  handleDeleteHistory: (entryId: number) => Promise<void>
  handleClearAllHistory: () => Promise<void>
}

export function useDynamicIslandHistory(): UseDynamicIslandHistoryOutput {
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<Array<{ id: number; text: string; createdAt: number }>>([])

  /** 打开/关闭输入历史面板 */
  const handleToggleHistory = useCallback(async () => {
    if (showHistoryPanel) {
      setShowHistoryPanel(false)
      return
    }
    const entries = await window.electronAPI?.inputHistory?.list(50)
    setHistoryEntries(entries || [])
    setShowHistoryPanel(true)
  }, [showHistoryPanel])

  /** 删除输入历史条目 */
  const handleDeleteHistory = useCallback(async (entryId: number) => {
    await window.electronAPI?.inputHistory?.delete(entryId)
    setHistoryEntries(prev => prev.filter(e => e.id !== entryId))
  }, [])

  /** 清空全部输入历史 */
  const handleClearAllHistory = useCallback(async () => {
    await window.electronAPI?.inputHistory?.clear()
    setHistoryEntries([])
  }, [])

  return {
    showHistoryPanel,
    historyEntries,
    handleToggleHistory,
    handleDeleteHistory,
    handleClearAllHistory,
  }
}
