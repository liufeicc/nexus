/**
 * 面板拖拽 Hook
 * 处理面板标题栏的鼠标按下、拖动、拖影创建与面板交换逻辑
 */

import { useEffect, useRef, useMemo } from 'react'
import { useAppStore } from '../../store'

interface UsePanelDragOptions {
  panelId: string
  displayPath: string
  headerRef: React.RefObject<HTMLDivElement>
  panelRef: React.RefObject<HTMLDivElement>
}

export function usePanelDrag({ panelId, displayPath, headerRef, panelRef }: UsePanelDragOptions) {
  const { setDraggingPanelId, setDropTargetPanelId, swapPanels, setActivePanelId } = useAppStore()

  // 使用 ref 存储拖动状态，避免闭包问题
  const isDraggingRef = useRef(false)
  const currentDropTargetRef = useRef<string | null>(null)
  const setDraggingPanelIdRef = useRef(setDraggingPanelId)
  const setDropTargetPanelIdRef = useRef(setDropTargetPanelId)
  const swapPanelsRef = useRef(swapPanels)
  const setActivePanelIdRef = useRef(setActivePanelId)

  // 更新 ref 指向
  useEffect(() => {
    setDraggingPanelIdRef.current = setDraggingPanelId
    setDropTargetPanelIdRef.current = setDropTargetPanelId
    swapPanelsRef.current = swapPanels
    setActivePanelIdRef.current = setActivePanelId
  }, [setDraggingPanelId, setDropTargetPanelId, swapPanels, setActivePanelId])

  useEffect(() => {
    const currentPanelId = panelId
    let dragOffsetX = 0
    let dragOffsetY = 0
    let ghostElement: HTMLDivElement | null = null
    let hasStartedDragging = false
    let mouseDownX = 0
    let mouseDownY = 0
    const DRAG_THRESHOLD = 20

    // 清理所有拖影元素（包括遗留的）
    const cleanupAllGhosts = () => {
      const ghosts = document.querySelectorAll('.terminal-panel-ghost')
      ghosts.forEach((ghost) => {
        if (ghost.parentNode) {
          ghost.parentNode.removeChild(ghost)
        }
      })
    }

    // 清理拖影元素
    const cleanupGhost = () => {
      if (ghostElement) {
        if (ghostElement.parentNode === document.body) {
          document.body.removeChild(ghostElement)
        }
        ghostElement = null
      }
      cleanupAllGhosts()
      hasStartedDragging = false
      isDraggingRef.current = false
      currentDropTargetRef.current = null
      setDraggingPanelIdRef.current(null)
      setDropTargetPanelIdRef.current(null)
    }

    // 组件挂载时清理所有遗留的 ghost 元素
    cleanupAllGhosts()

    let isMouseDownOnHeader = false

    const handleHeaderMouseDown = (e: MouseEvent) => {
      const header = headerRef.current
      if (!header) return

      const target = e.target as HTMLElement
      const isHeaderClick = target === header || header.contains(target)
      const isTerminalClick = target.closest('.terminal-container') || target.closest('.xterm')

      if (!isHeaderClick || isTerminalClick) return
      if (e.button !== 0) return
      if (target.closest('.terminal-close-btn')) return

      e.preventDefault()
      e.stopPropagation()
      isMouseDownOnHeader = true
      mouseDownX = e.clientX
      mouseDownY = e.clientY

      cleanupAllGhosts()
      hasStartedDragging = false
    }

    const hasMovedBeyondThreshold = (x: number, y: number): boolean => {
      const dx = x - mouseDownX
      const dy = y - mouseDownY
      return Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD
    }

    const updateGhostPosition = (x: number, y: number) => {
      if (ghostElement) {
        ghostElement.style.left = `${x - dragOffsetX}px`
        ghostElement.style.top = `${y - dragOffsetY}px`
      }
    }

    const startDragging = (e: MouseEvent) => {
      if (hasStartedDragging) return

      hasStartedDragging = true
      setDraggingPanelIdRef.current(currentPanelId)
      isDraggingRef.current = true

      const rect = panelRef.current?.getBoundingClientRect()
      if (rect) {
        dragOffsetX = e.clientX - rect.left
        dragOffsetY = e.clientY - rect.top
      }

      ghostElement = document.createElement('div')
      ghostElement.className = 'terminal-panel terminal-panel-ghost'
      ghostElement.style.position = 'fixed'
      ghostElement.style.width = `${panelRef.current?.offsetWidth || 300}px`
      ghostElement.style.height = `${panelRef.current?.offsetHeight || 200}px`
      ghostElement.style.pointerEvents = 'none'
      ghostElement.style.zIndex = '9999'
      ghostElement.style.display = 'flex'
      ghostElement.style.flexDirection = 'column'
      ghostElement.style.opacity = '0.8'
      ghostElement.style.background = 'transparent'
      ghostElement.innerHTML = `
        <div class="terminal-header" style="flex-shrink: 0;">
          <div class="terminal-header-left">
            <div class="status-dot"></div>
            <span class="terminal-title">bash - ${displayPath}</span>
          </div>
        </div>
      `
      document.body.appendChild(ghostElement)
      updateGhostPosition(e.clientX, e.clientY)
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isMouseDownOnHeader) return

      if (!hasStartedDragging) {
        if (hasMovedBeyondThreshold(e.clientX, e.clientY)) {
          startDragging(e)
        }
        return
      }

      if (ghostElement) {
        updateGhostPosition(e.clientX, e.clientY)

        // 检测下方的面板 — 临时隐藏拖影
        ghostElement.style.visibility = 'hidden'
        const elementBelow = document.elementFromPoint(e.clientX, e.clientY)
        ghostElement.style.visibility = 'visible'

        const targetPanel = elementBelow?.closest('[data-panel-id]')
        const targetPanelId = targetPanel?.getAttribute('data-panel-id')

        if (targetPanelId && targetPanelId !== currentPanelId) {
          currentDropTargetRef.current = targetPanelId
          setDropTargetPanelIdRef.current(targetPanelId)
        } else {
          currentDropTargetRef.current = null
          setDropTargetPanelIdRef.current(null)
        }
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!isMouseDownOnHeader) return

      isMouseDownOnHeader = false

      if (hasStartedDragging) {
        const targetPanelId = currentDropTargetRef.current

        if (targetPanelId && targetPanelId !== currentPanelId) {
          swapPanelsRef.current(currentPanelId, targetPanelId)
        }

        hasStartedDragging = false
        isDraggingRef.current = false
        currentDropTargetRef.current = null
        setDraggingPanelIdRef.current(null)
        setDropTargetPanelIdRef.current(null)
      } else {
        // 没有拖动，视为点击，选中面板
        setActivePanelIdRef.current(currentPanelId)
      }

      if (ghostElement || document.querySelector('.terminal-panel-ghost')) {
        if (ghostElement && ghostElement.parentNode) {
          document.body.removeChild(ghostElement)
          ghostElement = null
        }
        const remainingGhosts = document.querySelectorAll('.terminal-panel-ghost')
        remainingGhosts.forEach((ghost) => {
          if (ghost.parentNode) {
            ghost.parentNode.removeChild(ghost)
          }
        })
      }
    }

    const header = headerRef.current
    header?.addEventListener('mousedown', handleHeaderMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      cleanupGhost()
      header?.removeEventListener('mousedown', handleHeaderMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [panelId, displayPath, headerRef, panelRef])

  return { isDraggingRef, currentDropTargetRef }
}
