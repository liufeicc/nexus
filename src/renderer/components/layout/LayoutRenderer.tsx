/**
 * 布局树渲染组件
 */

import React, { useRef, useState, useCallback, useEffect } from 'react'
import { LayoutTree, LayoutChild, PanelNode } from '../../store'
import TerminalPanel from '../terminal/TerminalPanel'
import FileBrowserPanel from '../file-browser/FileBrowserPanel'
import { BrowserPanel as BrowserPanelView } from '../browser/BrowserPanel'
import { PanelState } from '../../store'
import { useAppStore } from '../../store'
import type { PanelType } from '../../store'

interface LayoutRendererProps {
  layout: LayoutChild
  panelsMap: Map<string, PanelState>
  depth?: number
  path?: number[] // 当前节点在布局树中的路径
}

/**
 * 可拖拽的分割线组件
 */
interface ResizerProps {
  orientation: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
  onResizeEnd?: () => void  // 拖动结束回调
}

function Resizer({ orientation, onResize, onResizeEnd }: ResizerProps) {
  const isDraggingRef = useRef(false)
  const startPosRef = useRef<number>(0)
  const [isHovering, setIsHovering] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingRef.current = true
    startPosRef.current = orientation === 'horizontal' ? e.clientX : e.clientY
    document.body.style.cursor = orientation === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    setIsDragging(true)

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return
      const currentPos = orientation === 'horizontal' ? moveEvent.clientX : moveEvent.clientY
      const delta = currentPos - startPosRef.current
      startPosRef.current = currentPos
      onResize(delta)
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      onResizeEnd?.()
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <div
      className="layout-resizer"
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      style={{
        width: orientation === 'horizontal' ? '4px' : '100%',
        height: orientation === 'horizontal' ? '100%' : '4px',
        flexShrink: 0,
        cursor: orientation === 'horizontal' ? 'col-resize' : 'row-resize',
        background: isDragging || isHovering ? 'rgba(204, 204, 204, 0.3)' : 'rgba(204, 204, 204, 0.1)',
        transition: 'background-color 0.2s ease',
        zIndex: 10,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: orientation === 'horizontal' ? '2px' : '100%',
          height: orientation === 'horizontal' ? '100%' : '2px',
          background: isDragging || isHovering ? 'rgba(204, 204, 204, 0.8)' : 'rgba(204, 204, 204, 0.3)',
          borderRadius: '2px',
          transition: 'background-color 0.2s ease',
        }}
      />
    </div>
  )
}

/**
 * 递归渲染布局树
 */
export function LayoutRenderer({ layout, panelsMap, depth = 0, path = [] }: LayoutRendererProps) {
  const { updateLayoutFlex, activeSessionId } = useAppStore()

  // 将 hooks 放在最前面，确保每次渲染都执行相同数量的 hooks
  // 布局节点专用 state
  const isLayoutNode = layout.type !== 'panel'
  const layoutNode = layout as LayoutTree
  const layoutFlexValues = layoutNode.flexValues || {}
  const [localFlexValues, setLocalFlexValues] = useState<Record<number, number>>(isLayoutNode ? layoutFlexValues : {})

  // ref 始终持有最新的 flex 值，拖动时直接从 ref 读取，避免 React 批处理导致增量丢失
  const flexValuesRef = useRef<Record<number, number>>(localFlexValues)
  useEffect(() => {
    flexValuesRef.current = localFlexValues
  }, [localFlexValues])

  // 容器 ref，用于获取实际像素
  const containerRef = useRef<HTMLDivElement>(null)

  // 当 layout 变化时，同步 flex 比例
  useEffect(() => {
    if (layoutNode.flexValues) {
      setLocalFlexValues(layoutNode.flexValues!)
    }
  }, [layoutNode.flexValues])

  // 判断布局方向
  const isHorizontal = layoutNode.type === 'horizontal'

  // 保存快照
  const saveSnapshot = React.useCallback(async () => {
    if (!activeSessionId) return
    try {
      await useAppStore.getState().saveSnapshot(activeSessionId)
    } catch (error) {
      console.error('[LayoutRenderer] 保存快照失败:', error)
    }
  }, [activeSessionId])

  // 处理分割线拖动调整大小
  // 从 ref 读取最新 flex 值，保证每次增量都基于最新状态，避免 React 批处理丢失
  const handleResize = useCallback((splitIndex: number, delta: number) => {
    // 从 ref 读取最新值，而不是从 React state 读取
    const prev = flexValuesRef.current
    const currentFlex = prev[splitIndex] ?? 1
    const nextFlex = prev[splitIndex + 1] ?? 1

    // 根据容器实际尺寸动态换算系数
    const container = containerRef.current
    let newFlexValues: Record<number, number>
    if (container) {
      const containerSize = isHorizontal ? container.clientWidth : container.clientHeight
      const totalFlex = currentFlex + nextFlex
      // 系数 = totalFlex / containerSize，确保 1px 鼠标移动 = 1px 面板移动
      const coefficient = totalFlex / containerSize
      const adjustment = delta * coefficient

      newFlexValues = {
        ...prev,
        [splitIndex]: Math.max(0.1, currentFlex + adjustment),
        [splitIndex + 1]: Math.max(0.1, nextFlex - adjustment),
      }
    } else {
      // 降级方案：固定系数
      const adjustment = delta * 0.002
      newFlexValues = {
        ...prev,
        [splitIndex]: Math.max(0.1, currentFlex + adjustment),
        [splitIndex + 1]: Math.max(0.1, nextFlex - adjustment),
      }
    }

    // 同步更新 ref
    flexValuesRef.current = newFlexValues
    updateLayoutFlex(path, newFlexValues)
    setLocalFlexValues(newFlexValues)
  }, [path, updateLayoutFlex, isHorizontal])

  // 拖动结束时保存快照
  const handleResizeEnd = useCallback(() => {
    saveSnapshot()
  }, [saveSnapshot])

  // 如果是面板节点，根据 panelType 渲染不同组件
  if (layout.type === 'panel') {
    const panelState = panelsMap.get(layout.id)
    if (!panelState) {
      console.warn('[LayoutRenderer] 面板未找到:', layout.id)
      return null
    }

    // 文件面板
    if (panelState.panelType === 'file-browser') {
      return (
        <FileBrowserPanel
          panelId={panelState.id}
          rootPath={panelState.rootPath || ''}
          currentPath={panelState.currentPath}
        />
      )
    }

    // 浏览器面板
    if (panelState.panelType === 'browser') {
      // 从 browserTabs 获取初始 URL
      const firstTab = panelState.browserTabs?.get(panelState.activeTabId || '')
      const initialUrl = firstTab?.url || 'about:blank'
      return (
        <BrowserPanelView
          panelId={panelState.id}
          initialUrl={initialUrl}
        />
      )
    }

    // 终端面板（默认）
    return (
      <TerminalPanel
        panelId={panelState.id}
        ptyId={panelState.ptyId || ''}
        cwd={panelState.cwd || ''}
      />
    )
  }

  // 布局节点（horizontal / vertical）

  return (
    <div
      ref={containerRef}
      className="layout-container"
      data-layout-type={layoutNode.type}
      data-depth={depth}
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {layoutNode.children.map((child, index) => (
        <React.Fragment key={getChildKey(child, index)}>
          <div
            style={{
              flex: localFlexValues[index] ?? 1,
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <LayoutRenderer
              layout={child}
              panelsMap={panelsMap}
              depth={depth + 1}
              path={[...path, index]}
            />
          </div>
          {/* 渲染分割线（不在最后一个子节点后渲染） */}
          {index < layoutNode.children.length - 1 && (
            <Resizer
              orientation={isHorizontal ? 'horizontal' : 'vertical'}
              onResize={(delta) => handleResize(index, delta)}
              onResizeEnd={handleResizeEnd}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

/**
 * 获取子节点的 key
 */
function getChildKey(child: LayoutChild, index: number): string {
  if (child.type === 'panel') {
    return `panel-${child.id}`
  }
  return `${child.type}-${index}`
}

export default LayoutRenderer
