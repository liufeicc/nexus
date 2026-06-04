/**
 * 窗口拖动 hook
 *
 * 负责灵动岛的拖动逻辑：
 * - 独立窗口模式：通过 Electron IPC 拖动，约束在主窗口范围内
 * - 嵌入模式：通过 CSS 绝对定位拖动，约束在屏幕范围内
 * - 展开/收起点击切换
 */

import { useState, useCallback, useRef } from 'react'
import type { IslandState } from './use-dynamic-island-types'

/** 返回给组件的接口 */
export interface WindowDragHandlers {
  /** 独立窗口模式的 onMouseDown */
  handleStandaloneMouseDown: (e: React.MouseEvent) => void
  /** 嵌入模式的 onMouseDown */
  handleMouseDown: (e: React.MouseEvent) => void
  /** 容器点击处理（切换展开/收起） */
  handleClick: () => void
  /** 当前拖动位置（嵌入模式） */
  position: { left: number; top: number } | null
  /** 拖动引用，用于区分点击和拖动 */
  dragInProgressRef: React.MutableRefObject<boolean>
}

export function useWindowDrag(
  standalone: boolean,
  islandState: IslandState,
  setIslandState: React.Dispatch<React.SetStateAction<IslandState>>,
): WindowDragHandlers {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const dragInProgressRef = useRef(false)

  // ==================== 独立窗口模式拖动 ====================

  const handleStandaloneMouseDown = useCallback((e: React.MouseEvent) => {
    if (!standalone) return
    const target = e.target as HTMLElement
    // 只有拖动手柄（展开时）或指示器行（收起时）才能拖动窗口
    if (!target.closest('.island-drag-handle') && !target.closest('.island-indicator-row')) return

    const startX = e.clientX
    const startY = e.clientY
    let isDragging = false

    const handleMouseMove = async (e: MouseEvent) => {
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (!isDragging && Math.sqrt(dx * dx + dy * dy) > 4) {
        isDragging = true
      }
      if (isDragging) {
        const islandBounds = await window.electronAPI?.dynamicIsland?.getBounds()
        const mainBounds = await window.electronAPI?.dynamicIsland?.getMainBounds()
        if (islandBounds && mainBounds) {
          // 计算新的窗口位置
          let newX = islandBounds.x + dx
          let newY = islandBounds.y + dy

          // 约束在主窗口范围内
          newX = Math.max(mainBounds.x, Math.min(newX, mainBounds.x + mainBounds.width - islandBounds.width))
          newY = Math.max(mainBounds.y, Math.min(newY, mainBounds.y + mainBounds.height - islandBounds.height))

          window.electronAPI?.dynamicIsland?.setPosition({ x: newX, y: newY })
        }
      }
    }
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      // 标记发生了拖动，下一次 handleClick 应该忽略
      if (isDragging) {
        dragInProgressRef.current = true
      }
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [standalone])

  // ==================== 嵌入模式拖动 ====================

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    // 内容区域和交互元素不触发拖动，允许正常点击和输入
    if (target.closest('.island-agent-send-btn, .island-stop-btn, .island-agent-input, .island-close-btn-inline, .island-close')) return
    // 内容区域内的非手柄区域不拖动
    if (target.closest('.island-content') && !target.closest('.island-drag-handle')) return
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startY = e.clientY
    const startPos = position || { left: e.currentTarget.getBoundingClientRect().left, top: e.currentTarget.getBoundingClientRect().top }
    const dragOffsetX = startX - startPos.left
    const dragOffsetY = startY - startPos.top
    const ISLAND_WIDTH = 800

    const handleMouseMove = (e: MouseEvent) => {
      const winW = window.innerWidth
      const winH = window.innerHeight
      let newX = e.clientX - dragOffsetX
      let newY = e.clientY - dragOffsetY
      const el = document.querySelector('.island-container')
      const currentHeight = el ? el.getBoundingClientRect().height : 36
      newX = Math.max(0, Math.min(newX, winW - ISLAND_WIDTH))
      newY = Math.max(0, Math.min(newY, winH - currentHeight))
      setPosition({ left: newX, top: newY })
    }
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [position])

  // ==================== 点击展开/收起 ====================

  const handleClick = useCallback(() => {
    // 如果刚发生了拖动，忽略点击（不切换展开/收起状态）
    if (dragInProgressRef.current) {
      dragInProgressRef.current = false
      return
    }
    if (islandState === 'idle') {
      // 从收起状态展开为输入模式
      setIslandState('showing')
    } else if (islandState === 'showing') {
      // 从展开状态收起
      setIslandState('hiding')
    }
  }, [islandState, setIslandState])

  return {
    handleStandaloneMouseDown,
    handleMouseDown,
    handleClick,
    position,
    dragInProgressRef,
  }
}
