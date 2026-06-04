/**
 * 灵动岛 UI 状态 Hook
 * 从 DynamicIsland.tsx 提取
 * 职责：展开/收起状态转换、窗口大小自适应、自动聚焦
 */

import React, { useState, useEffect, useRef } from 'react'
import type { IslandState } from '../../hooks/use-dynamic-island-types'

export interface UseDynamicIslandUIInput {
  standalone: boolean
  taskPanelOpen: boolean
  skillPanelOpen: boolean
  memoryPanelOpen: boolean
  historyPanelOpen: boolean
}

export interface UseDynamicIslandUIOutput {
  islandState: IslandState
  setIslandState: React.Dispatch<React.SetStateAction<IslandState>>
  inputRef: React.MutableRefObject<HTMLTextAreaElement | null>
  contentRef: React.MutableRefObject<HTMLDivElement | null>
  thinkingRef: React.MutableRefObject<HTMLDivElement | null>
  streamingRef: React.MutableRefObject<HTMLDivElement | null>
}

export function useDynamicIslandUI({
  standalone,
  taskPanelOpen,
  skillPanelOpen,
  memoryPanelOpen,
  historyPanelOpen,
}: UseDynamicIslandUIInput): UseDynamicIslandUIOutput {
  const [islandState, setIslandState] = useState<IslandState>('idle')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const thinkingRef = useRef<HTMLDivElement | null>(null)
  const streamingRef = useRef<HTMLDivElement | null>(null)

  // ==================== 收起逻辑 ====================

  useEffect(() => {
    if (islandState !== 'hiding') return
    const timer = setTimeout(() => {
      setIslandState('idle')
    }, 400)
    return () => clearTimeout(timer)
  }, [islandState])

  // ==================== 独立窗口模式：窗口大小自适应 ====================

  // 合并所有 resize 逻辑为一个 ResizeObserver
  useEffect(() => {
    if (!standalone) return

    const container = document.querySelector('.island-container')
    if (!container) return

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        const rect = container.getBoundingClientRect()
        const taskPanelHeight = taskPanelOpen ? 500 : 0
        const skillPanelHeight = skillPanelOpen ? 500 : 0
        const memoryPanelHeight = memoryPanelOpen ? 500 : 0
        const historyPanelHeight = historyPanelOpen ? 500 : 0
        const panelExtra = Math.max(taskPanelHeight, skillPanelHeight, memoryPanelHeight, historyPanelHeight)
        const width = Math.max(300, Math.ceil(rect.width))
        const height = Math.max(30, Math.ceil(rect.height)) + panelExtra
        window.electronAPI?.dynamicIsland?.setSize({ width, height })
      }, 50)
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      if (resizeTimer) clearTimeout(resizeTimer)
    }
  }, [standalone, taskPanelOpen, skillPanelOpen, memoryPanelOpen, historyPanelOpen])

  // 展开/收起时延迟 resize，确保 CSS 过渡动画完成后尺寸稳定
  useEffect(() => {
    if (!standalone) return
    if (islandState === 'showing') {
      const timer = setTimeout(() => {
        const container = document.querySelector('.island-container')
        if (!container) return
        const rect = container.getBoundingClientRect()
        const taskPanelHeight = taskPanelOpen ? 500 : 0
        const skillPanelHeight = skillPanelOpen ? 500 : 0
        const memoryPanelHeight = memoryPanelOpen ? 500 : 0
        const historyPanelHeight = historyPanelOpen ? 500 : 0
        const panelExtra = Math.max(taskPanelHeight, skillPanelHeight, memoryPanelHeight, historyPanelHeight)
        const width = Math.max(300, Math.ceil(rect.width))
        const height = Math.max(30, Math.ceil(rect.height)) + panelExtra
        window.electronAPI?.dynamicIsland?.setSize({ width, height })
      }, 450)
      return () => clearTimeout(timer)
    } else if (islandState === 'idle') {
      requestAnimationFrame(() => {
        const container = document.querySelector('.island-container')
        if (!container) return
        const rect = container.getBoundingClientRect()
        const width = Math.max(300, Math.ceil(rect.width))
        const height = Math.max(30, Math.ceil(rect.height))
        window.electronAPI?.dynamicIsland?.setSize({ width, height })
      })
    }
  }, [standalone, islandState])

  // 当灵动岛展开时，自动聚焦输入框并恢复高度
  useEffect(() => {
    if (islandState === 'showing') {
      const timer = setTimeout(() => {
        inputRef.current?.focus()
        // 如果有输入内容，恢复 textarea 高度以适配内容
        const textarea = inputRef.current
        if (textarea && textarea.value) {
          textarea.style.height = 'auto'
          textarea.style.height = textarea.scrollHeight + 'px'
        }
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [islandState])

  return {
    islandState,
    setIslandState,
    inputRef,
    contentRef,
    thinkingRef,
    streamingRef,
  }
}
