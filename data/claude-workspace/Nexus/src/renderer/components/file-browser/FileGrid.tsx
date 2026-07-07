/**
 * 文件网格组件
 *
 * 以大图标卡片形式展示当前目录下的所有条目。
 * 文件夹在前、文件在后，各自按名称字母排序。
 * 双击文件夹进入目录，双击文件打开查看器。
 * 支持框选（鼠标拖拽矩形区域）和 Ctrl+A 全选。
 *
 * 当前使用模拟数据，后续将接入 Electron IPC 文件 API。
 */

import React, { useMemo, useState, useRef, useEffect } from 'react'
import { useI18n } from '../../i18n'

/** 文件/文件夹条目 */
export interface FileItem {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  size?: number
  mtime?: number
}

interface FileGridProps {
  /** 文件/文件夹列表 */
  items: FileItem[]
  /** 视图模式 */
  viewMode: 'grid' | 'list'
  /** 双击文件夹时的回调 */
  onNavigate: (path: string) => void
  /** 双击文件时的回调 */
  onOpenFile: (filePath: string, fileName: string) => void
  /** 当前选中的文件路径集合 */
  selectedPaths: Set<string>
  /** 更新选中状态 */
  onSelectChange: (paths: Set<string>) => void
  /** 网格容器的 ref，用于外部判断点击区域 */
  containerRef?: React.RefObject<HTMLDivElement>
  /** 右键弹出上下文菜单的回调 */
  onContextMenu?: (e: React.MouseEvent, filePath?: string) => void
  /** 双击 ".." 返回上级目录，为 null 时不显示 ".." 卡片 */
  onGoUp?: (() => void) | null
  /** 剪切模式下的文件路径集合（用于显示半透明效果） */
  cutFilePaths?: Set<string>
  /** 搜索匹配的文件路径列表 */
  searchMatches?: string[]
  /** 当前高亮的匹配索引 */
  currentMatchIndex?: number
  /** 智能体正在操作的文件路径列表 */
  agentActiveFiles?: string[]
}

/** 鼠标拖拽选区的起点和终点（相对于网格容器） */
interface SelectionRect {
  startX: number
  startY: number
  endX: number
  endY: number
}

/**
 * 将文件名中间截断，保持两端可见
 * 例: a1111111111111111111111111 → a11111..111111
 * @param name 原始文件名
 * @param maxLen 最大显示字符数（超过此长度才截断）
 */
function truncateMiddle(name: string, maxLen: number = 36): string {
  if (name.length <= maxLen) return name
  const tailLen = Math.floor((maxLen - 2) / 2)
  const headLen = maxLen - 2 - tailLen
  return `${name.slice(0, headLen)}..${name.slice(-tailLen)}`
}

/**
 * 格式化文件大小为人类可读字符串
 * @param bytes 字节数
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * 格式化时间戳为日期字符串
 * @param timestamp 毫秒时间戳
 */
function formatDate(timestamp: number | undefined): string {
  if (!timestamp) return '-'
  const d = new Date(timestamp)
  return d.toLocaleDateString()
}

/**
 * 判断一个点是否在矩形区域内
 */
function pointInRect(
  x: number,
  y: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean {
  return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh
}

/**
 * 文件网格组件
 *
 * 事件架构说明：
 * - 所有鼠标事件（mousedown/mousemove/mouseup）使用原生 DOM 监听，
 *   避免 React 合成事件与原生事件混用导致的时序问题。
 * - 所有回调通过 ref 持有，确保 useEffect 的 [] 依赖不会导致闭包过期。
 * - React onClick/onDoubleClick 仍保留在卡片上，但框选完全由原生事件处理。
 */
export function FileGrid({ items, viewMode, onNavigate, onOpenFile, selectedPaths, onSelectChange, containerRef, onContextMenu, onGoUp, cutFilePaths, searchMatches, currentMatchIndex, agentActiveFiles }: FileGridProps) {
  const { t } = useI18n()

  // 排序：文件夹在前，文件在后，各自按名称字母排序
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
      return a.name.localeCompare(b.name)
    })
  }, [items])

  // ===== Refs =====

  const gridRef = containerRef || useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // 上级目录卡片的选中状态（独立于文件选中系统，避免与真实路径冲突）
  const parentDirSelectedRef = useRef(false)
  const [, forceRender] = useState(0)

  // Shift 多选：记录上一次点击的文件索引
  const lastClickIndexRef = useRef<number | null>(null)

  // 所有可变数据用 ref，不依赖 React 渲染周期
  const dragRectRef = useRef<SelectionRect | null>(null)
  const isDraggingRef = useRef(false)
  const onSelectChangeRef = useRef(onSelectChange)
  onSelectChangeRef.current = onSelectChange

  // 仅用于绘制选区矩形的 React state
  const [dragRect, setDragRect] = useState<SelectionRect | null>(null)

  // ===== 原生事件处理（在 useEffect 中注册） =====

  // 鼠标按下：开始拖拽选区
  const onMouseDown = (e: MouseEvent) => {
    // 只在空白区域（非卡片）按下时才开始框选
    if ((e.target as HTMLElement).closest('.file-card')) return
    if (e.button !== 0) return

    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return

    // 点击空白区域：先清空选中，并取消上级目录卡片选中
    parentDirSelectedRef.current = false
    onSelectChangeRef.current(new Set())
    forceRender((n) => n + 1)

    isDraggingRef.current = false
    dragRectRef.current = {
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      endX: e.clientX - rect.left,
      endY: e.clientY - rect.top,
    }
    setDragRect(dragRectRef.current)

    // 阻止浏览器默认的拖拽行为（如手型平移/滚动）
    e.preventDefault()

    // 注册 mousemove 和 mouseup 到 window
    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
  }

  // 鼠标移动：更新选区
  const onMouseMove = (e: MouseEvent) => {
    const rect = dragRectRef.current
    if (!rect) return
    const grid = gridRef.current
    if (!grid) return

    isDraggingRef.current = true
    const containerRect = grid.getBoundingClientRect()
    const endX = e.clientX - containerRect.left
    const endY = e.clientY - containerRect.top

    // 更新拖拽数据
    rect.endX = endX
    rect.endY = endY
    setDragRect({ ...rect })

    // 实时计算选中的卡片
    const sx = Math.min(rect.startX, endX)
    const sy = Math.min(rect.startY, endY)
    const sw = Math.abs(endX - rect.startX)
    const sh = Math.abs(endY - rect.startY)

    const newSelected = new Set<string>()
    cardRefs.current.forEach((el, path) => {
      const cardRect = el.getBoundingClientRect()
      const cx = cardRect.left - containerRect.left + cardRect.width / 2
      const cy = cardRect.top - containerRect.top + cardRect.height / 2
      if (pointInRect(cx, cy, sx, sy, sw, sh)) {
        newSelected.add(path)
      }
    })
    onSelectChangeRef.current(newSelected)
  }

  // 鼠标松开：结束选区
  const onMouseUp = () => {
    dragRectRef.current = null
    isDraggingRef.current = false
    setDragRect(null)

    window.removeEventListener('mousemove', onMouseMove, true)
    window.removeEventListener('mouseup', onMouseUp, true)
  }

  // 注册/注销事件
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return

    grid.addEventListener('mousedown', onMouseDown)

    return () => {
      grid.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [])

  // 清空选中（导航到新目录时）
  useEffect(() => {
    parentDirSelectedRef.current = false
    lastClickIndexRef.current = null
    onSelectChangeRef.current(new Set())
    forceRender((n) => n + 1)
  }, [items])

  // 当前匹配索引变化时，滚动到对应的卡片
  useEffect(() => {
    if (!searchMatches || searchMatches.length === 0 || currentMatchIndex == null) return
    const matchedPath = searchMatches[currentMatchIndex]
    if (!matchedPath) return
    const cardEl = cardRefs.current.get(matchedPath)
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentMatchIndex, searchMatches])

  // ===== 卡片点击（React 合成事件） =====

  const handleDoubleClick = (item: FileItem) => {
    if (item.type === 'directory') {
      onNavigate(item.path)
    } else {
      onOpenFile(item.path, item.name)
    }
  }

  const handleCardClick = (e: React.MouseEvent, item: FileItem) => {
    // 如果正在拖拽，不处理点击
    if (isDraggingRef.current) return

    // 点击真实文件时，取消上级目录卡片的选中
    parentDirSelectedRef.current = false

    const itemIndex = sortedItems.findIndex(it => it.path === item.path)

    if (e.shiftKey && lastClickIndexRef.current !== null) {
      // Shift 点击：选中上一次点击到当前点击之间的所有文件
      const from = Math.min(lastClickIndexRef.current, itemIndex)
      const to = Math.max(lastClickIndexRef.current, itemIndex)
      const rangePaths = new Set<string>()
      for (let i = from; i <= to; i++) {
        rangePaths.add(sortedItems[i].path)
      }
      onSelectChange(rangePaths)
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd 点击：切换单个文件的选中状态
      const next = new Set(selectedPaths)
      if (next.has(item.path)) {
        next.delete(item.path)
      } else {
        next.add(item.path)
      }
      onSelectChange(next)
      lastClickIndexRef.current = itemIndex
    } else {
      // 普通点击：仅选中当前文件
      onSelectChange(new Set([item.path]))
      lastClickIndexRef.current = itemIndex
    }
    forceRender((n) => n + 1)
  }

  // ===== 渲染 =====

  /** 渲染文件/文件夹图标（SVG） */
  const renderItemIcon = (item: FileItem) => {
    if (item.type === 'directory') {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" style={{ color: '#42a5f5' }}>
          <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
        </svg>
      )
    }
    if (item.type === 'symlink') {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" style={{ color: '#ff9800' }}>
          <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z" />
        </svg>
      )
    }
    // 根据文件扩展名设置图标颜色
    const ext = item.name.split('.').pop()?.toLowerCase() || ''
    const fileColor =
      ext === 'docx' ? '#2563eb' :
      ext === 'xlsx' || ext === 'xls' ? '#16a34a' :
      ext === 'pptx' || ext === 'ppt' ? '#ea580c' :
      ext === 'pdf' ? '#ef4444' :
      '#9e9e9e'
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" style={{ color: fileColor }}>
        <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z" />
      </svg>
    )
  }

  // 列表视图
  if (viewMode === 'list') {
    return (
      <div
        className="file-list file-grid-selectable"
        ref={gridRef}
        tabIndex={0}
        onContextMenu={(e) => onContextMenu?.(e)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault()
            parentDirSelectedRef.current = false
            onSelectChange(new Set(sortedItems.map(item => item.path)))
          }
          if (e.key === 'Escape') {
            parentDirSelectedRef.current = false
            onSelectChange(new Set())
          }
        }}
      >
        {/* 表头 */}
        <div className="file-list-header">
          <span className="file-list-col file-list-col-name">{t('filePanel.column.name')}</span>
          <span className="file-list-col file-list-col-size">{t('filePanel.column.size')}</span>
          <span className="file-list-col file-list-col-mtime">{t('filePanel.column.modifiedTime')}</span>
        </div>
        {/* 上级目录行 */}
        {onGoUp && (
          <div
            key="parent-dir"
            className={`file-list-item ${parentDirSelectedRef.current ? 'selected' : ''}`}
            onDoubleClick={onGoUp}
            onClick={(e) => {
              if (isDraggingRef.current) return
              if (e.ctrlKey || e.metaKey) {
                parentDirSelectedRef.current = !parentDirSelectedRef.current
              } else {
                parentDirSelectedRef.current = true
                onSelectChange(new Set())
              }
              forceRender((n) => n + 1)
            }}
            title={t('filePanel.parentDir')}
          >
            <span className="file-list-item-icon">{renderItemIcon({ name: '..', path: '', type: 'directory' })}</span>
            <span className="file-list-item-name">..</span>
            <span className="file-list-item-size">-</span>
            <span className="file-list-item-mtime">-</span>
          </div>
        )}
        {/* 列表项 */}
        {sortedItems.map((item) => {
          const isSelected = selectedPaths.has(item.path)
          const isCut = cutFilePaths?.has(item.path) ?? false
          const isSearchMatch = searchMatches?.includes(item.path) ?? false
          const isCurrentMatch = isSearchMatch && currentMatchIndex != null && searchMatches?.[currentMatchIndex] === item.path
          const isAgentFile = agentActiveFiles?.includes(item.path) ?? false
          const highlightClasses = isSearchMatch
            ? `search-match${isCurrentMatch ? ' current-match' : ''}`
            : ''
          return (
            <div
              key={item.path}
              ref={(el) => {
                if (el) {
                  cardRefs.current.set(item.path, el)
                } else {
                  cardRefs.current.delete(item.path)
                }
              }}
              className={`file-list-item ${isSelected ? 'selected' : ''} ${isAgentFile ? 'agent-file' : ''} ${highlightClasses}`}
              style={isCut ? { opacity: 0.5 } : undefined}
              data-file-path={item.path}
              draggable={item.type === 'file'}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', item.path)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onDoubleClick={() => handleDoubleClick(item)}
              onClick={(e) => handleCardClick(e, item)}
              onContextMenu={(e) => {
                e.stopPropagation()
                onContextMenu?.(e, item.path)
              }}
              title={item.name}
            >
              <span className="file-list-item-icon">{renderItemIcon(item)}</span>
              <span className="file-list-item-name">{item.name}</span>
              <span className="file-list-item-size">
                {item.type === 'directory' ? `0 ${t('filePanel.itemsCount')}` : formatFileSize(item.size || 0)}
              </span>
              <span className="file-list-item-mtime">{formatDate(item.mtime)}</span>
            </div>
          )
        })}
        {/* 拖拽选区矩形 */}
        {dragRect && (
          <div
            className="file-grid-selection"
            style={{
              left: Math.min(dragRect.startX, dragRect.endX),
              top: Math.min(dragRect.startY, dragRect.endY),
              width: Math.abs(dragRect.endX - dragRect.startX),
              height: Math.abs(dragRect.endY - dragRect.startY),
            }}
          />
        )}
      </div>
    )
  }

  // 网格视图（默认）
  return (
    <div
      className="file-grid file-grid-selectable"
      ref={gridRef}
      tabIndex={0}
      onContextMenu={(e) => onContextMenu?.(e)}
      onKeyDown={(e) => {
        // Ctrl+A / Cmd+A 全选（仅选中真实文件，不包含上级目录卡片）
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
          e.preventDefault()
          parentDirSelectedRef.current = false
          onSelectChange(new Set(sortedItems.map(item => item.path)))
        }
        // Escape 取消选中
        if (e.key === 'Escape') {
          parentDirSelectedRef.current = false
          onSelectChange(new Set())
        }
      }}
    >
      {onGoUp && (
        <div
          key="parent-dir"
          ref={(el) => {
            if (el) {
              cardRefs.current.set("__PARENT_DIR__", el)
            } else {
              cardRefs.current.delete("__PARENT_DIR__")
            }
          }}
          className={`file-card ${parentDirSelectedRef.current ? 'selected' : ''}`}
          onDoubleClick={onGoUp}
          onClick={(e) => {
            if (isDraggingRef.current) return
            if (e.ctrlKey || e.metaKey) {
              // Ctrl/Cmd 点击：切换上级目录卡片的选中状态
              parentDirSelectedRef.current = !parentDirSelectedRef.current
            } else {
              // 普通点击：仅选中上级目录卡片，清空文件选中
              parentDirSelectedRef.current = true
              onSelectChange(new Set())
            }
            forceRender((n) => n + 1)
          }}
          title={t('filePanel.parentDir')}
        >
          <div className="file-card-icon">
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ color: '#42a5f5' }}>
              <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
          </div>
          <div className="file-card-name">..</div>
        </div>
      )}
      {sortedItems.map((item) => {
        const isSelected = selectedPaths.has(item.path)
        const isCut = cutFilePaths?.has(item.path) ?? false
        const isSearchMatch = searchMatches?.includes(item.path) ?? false
        const isCurrentMatch = isSearchMatch && currentMatchIndex != null && searchMatches?.[currentMatchIndex] === item.path
        const isAgentFile = agentActiveFiles?.includes(item.path) ?? false
        const highlightClasses = isSearchMatch
          ? `search-match${isCurrentMatch ? ' current-match' : ''}`
          : ''
        return (
          <div
            key={item.path}
            ref={(el) => {
              if (el) {
                cardRefs.current.set(item.path, el)
              } else {
                cardRefs.current.delete(item.path)
              }
            }}
            className={`file-card ${isSelected ? 'selected' : ''} ${isAgentFile ? 'agent-file' : ''} ${highlightClasses}`}
            style={isCut ? { opacity: 0.5 } : undefined}
            data-file-path={item.path}
            draggable={item.type === 'file'}
            onDragStart={(e) => {
              // 将文件路径作为纯文本数据传递，供 DynamicIsland 等拖拽目标接收
              e.dataTransfer.setData('text/plain', item.path)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onDoubleClick={() => handleDoubleClick(item)}
            onClick={(e) => handleCardClick(e, item)}
            onContextMenu={(e) => {
              e.stopPropagation()
              onContextMenu?.(e, item.path)
            }}
            title={item.name}
          >
            <div className="file-card-icon">
              {item.type === 'directory' ? (
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ color: '#42a5f5' }}>
                  <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                </svg>
              ) : item.type === 'symlink' ? (
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ color: '#ff9800' }}>
                  <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z" />
                </svg>
              ) : (() => {
                // 根据文件扩展名设置图标颜色
                const ext = item.name.split('.').pop()?.toLowerCase() || ''
                const fileColor =
                  ext === 'docx' ? '#2563eb' :
                  ext === 'xlsx' || ext === 'xls' ? '#16a34a' :
                  ext === 'pptx' || ext === 'ppt' ? '#ea580c' :
                  ext === 'pdf' ? '#ef4444' :
                  '#9e9e9e'
                return (
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ color: fileColor }}>
                    <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z" />
                  </svg>
                )
              })()}
            </div>
            <div className="file-card-name">{truncateMiddle(item.name)}</div>
          </div>
        )
      })}

      {/* 拖拽选区矩形 */}
      {dragRect && (
        <div
          className="file-grid-selection"
          style={{
            left: Math.min(dragRect.startX, dragRect.endX),
            top: Math.min(dragRect.startY, dragRect.endY),
            width: Math.abs(dragRect.endX - dragRect.startX),
            height: Math.abs(dragRect.endY - dragRect.startY),
          }}
        />
      )}
    </div>
  )
}

export default FileGrid
