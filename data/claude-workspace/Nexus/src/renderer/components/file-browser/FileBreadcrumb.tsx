/**
 * 文件面板面包屑导航组件
 *
 * 显示从根目录到当前目录的完整路径，每段可点击跳转。
 * 双击面包屑栏空白区域可进入路径编辑模式，直接输入目标路径。
 */

import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { splitPath } from '../../../core/utils/path-utils'
import { useI18n } from '../../i18n'

/** 补全建议项类型 */
export interface SuggestionItem {
  name: string
  type: 'file' | 'directory' | 'symlink'
}

interface FileBreadcrumbProps {
  /** 当前浏览的目录路径 */
  currentPath: string
  /** 面包屑根路径（用于截断显示） */
  rootPath?: string
  /** 点击路径段时的回调，传入目标路径 */
  onNavigate: (path: string) => void
}

export function FileBreadcrumb({ currentPath, rootPath, onNavigate }: FileBreadcrumbProps) {
  const { t } = useI18n()
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 自动补全状态
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const fetchIdRef = useRef(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const dismissingRef = useRef(false) // 标记正在关闭（防止后续点击事件重新打开）

  // 将路径拆分为路径段
  const segments = React.useMemo(() => {
    // 移除首尾斜杠，按 / 拆分
    const parts = splitPath(currentPath)
    if (parts.length === 0) {
      return [{ name: '/', path: '/' }]
    }

    const result: Array<{ name: string; path: string }> = []
    // 根目录
    result.push({ name: '/', path: '/' })

    let accumulated = ''
    for (const part of parts) {
      accumulated += '/' + part
      result.push({ name: part, path: accumulated })
    }
    return result
  }, [currentPath])

  // 进入编辑模式（单击面包屑栏空白区域时）
  const handleContainerClick = () => {
    if (dismissingRef.current) return
    dismissingRef.current = false // 重置标志
    setIsEditing(true)
    setEditValue(currentPath)
  }

  // 进入编辑模式后自动聚焦
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
    // 退出编辑模式时重置标志
    if (!isEditing) {
      dismissingRef.current = false
    }
  }, [isEditing])

  // 点击外部区域退出编辑模式
  useEffect(() => {
    if (!isEditing) return

    const handleClickOutside = (e: MouseEvent) => {
      const wrapper = wrapperRef.current
      const suggestionsEl = document.querySelector('.breadcrumb-suggestions')

      if (wrapper && !wrapper.contains(e.target as Node) &&
          !(suggestionsEl && suggestionsEl.contains(e.target as Node))) {
        // 点击了输入框和下拉框之外的区域，确认导航
        const trimmed = editValue.trim()
        if (trimmed && trimmed !== currentPath) {
          onNavigate(trimmed)
        }
        setIsEditing(false)
        setSuggestions([])
        setShowSuggestions(false)
        setSelectedIndex(-1)
      }
    }

    // 用 setTimeout 避免同一次点击立即触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isEditing, editValue, currentPath, onNavigate])

  // 解析输入路径，返回父目录和当前片段
  // 例如：'/home/us' → { parentDir: '/home', partial: 'us' }
  //       '/home/' → { parentDir: '/home', partial: '' }（用户以 / 结尾，表示要进入该目录）
  //       '/home' → { parentDir: '/', partial: 'home' }
  //       '/' → { parentDir: '/', partial: '' }
  const parseInputPath = (value: string): { parentDir: string; partial: string } => {
    // 判断用户是否以 / 结尾（表示想要进入该目录，显示其全部内容）
    const endsWithSlash = value.endsWith('/')
    // 去掉末尾的连续斜杠（但保留根目录的单个 /）
    const trimmed = value === '/' ? '/' : value.replace(/\/+$/, '')
    const lastSlash = trimmed.lastIndexOf('/')

    if (endsWithSlash) {
      // 用户以 / 结尾，返回完整路径作为父目录
      return { parentDir: trimmed, partial: '' }
    }

    if (lastSlash === 0) {
      return { parentDir: '/', partial: trimmed.length > 1 ? trimmed.slice(1) : '' }
    }
    if (lastSlash > 0) {
      return { parentDir: trimmed.slice(0, lastSlash), partial: trimmed.slice(lastSlash + 1) }
    }
    // 无斜杠的相对路径
    return { parentDir: '.', partial: trimmed }
  }

  // 输入值变化时，自动获取补全建议
  useEffect(() => {
    if (!isEditing) return
    const trimmed = editValue.trim()
    if (!trimmed) {
      setSuggestions([])
      setShowSuggestions(false)
      setSelectedIndex(-1)
      return
    }

    const { parentDir, partial } = parseInputPath(trimmed)
    const currentFetchId = ++fetchIdRef.current

    window.electronAPI.fs.readdir(parentDir).then(result => {
      if (currentFetchId !== fetchIdRef.current) return
      if (result.error || !result.items) {
        setSuggestions([])
        setShowSuggestions(false)
        return
      }

      // 按 partial 前缀过滤，且只显示目录
      const matches: SuggestionItem[] = result.items
        .filter(item => {
          // 只显示目录
          if (item.type !== 'directory') return false
          if (!partial) return true // 以 / 结尾时显示全部
          return item.name.toLowerCase().startsWith(partial.toLowerCase())
        })
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        .slice(0, 10)

      setSuggestions(matches)
      setShowSuggestions(matches.length > 0)
      setSelectedIndex(matches.length > 0 ? 0 : -1)
    }).catch(() => {
      setSuggestions([])
      setShowSuggestions(false)
    })
  }, [editValue, isEditing])

  // 将建议项补全到输入框（替换当前片段）
  const applySuggestion = (name: string) => {
    const trimmed = editValue.trim()
    const lastSlash = trimmed.lastIndexOf('/')

    if (lastSlash <= 0) {
      // 根目录或无斜杠
      setEditValue(lastSlash === 0 ? `/${name}` : name)
    } else {
      setEditValue(trimmed.slice(0, lastSlash + 1) + name)
    }
    setSelectedIndex(0)
  }

  // Tab 键选择建议项
  const selectSuggestion = (index: number) => {
    if (index < 0 || index >= suggestions.length) return
    applySuggestion(suggestions[index].name)
  }

  // 确认导航
  const handleConfirm = () => {
    setIsEditing(false)
    setSuggestions([])
    setShowSuggestions(false)
    setSelectedIndex(-1)
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== currentPath) {
      onNavigate(trimmed)
    }
  }

  // 取消编辑
  const handleCancel = () => {
    setIsEditing(false)
    setEditValue('')
  }

  // 根据选中的建议和输入值，构建完整路径
  const buildFullPath = (itemName: string): string => {
    const trimmed = editValue.trim()
    const { parentDir } = parseInputPath(trimmed)
    return parentDir === '/' ? `/${itemName}` : `${parentDir}/${itemName}`
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // 如果有选中的建议，导航到该建议的目录
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        const item = suggestions[selectedIndex]
        // 只处理目录类型
        if (item.type === 'directory') {
          const fullPath = buildFullPath(item.name)
          // 导航到该目录
          onNavigate(fullPath)
          // 保持编辑模式，更新输入值，方便继续输入下一级路径
          setEditValue(fullPath + '/')
          setShowSuggestions(false)
          setSelectedIndex(0)
          return
        }
      }
      // 没有选中的建议，按输入值导航
      handleConfirm()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (showSuggestions) {
        setShowSuggestions(false)
        setSelectedIndex(-1)
      } else {
        handleCancel()
      }
    } else if (e.key === 'ArrowDown' && showSuggestions) {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp' && showSuggestions) {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Tab' && showSuggestions && selectedIndex >= 0) {
      e.preventDefault()
      selectSuggestion(selectedIndex)
    } else if (e.key === '/' && !showSuggestions && !editValue.endsWith('/')) {
      // 在非建议模式下输入 / 时，保持正常输入行为
    }
  }

  // 判断是否是最后一段（当前目录，不可点击）
  const lastIndex = segments.length - 1

  // 编辑模式：显示输入框 + 自动补全建议
  if (isEditing) {
    return (
      <div className="file-breadcrumb editing" onClick={handleContainerClick}>
        <div ref={wrapperRef} className="breadcrumb-input-wrapper" style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <input
            ref={inputRef}
            type="text"
            className="breadcrumb-input"
            value={editValue}
            onChange={(e) => {
              setEditValue(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('pathSelector.placeholder')}
          />
        </div>
        {showSuggestions && suggestions.length > 0 && (
          <AutocompleteDropdown
            suggestions={suggestions}
            selectedIndex={selectedIndex}
            wrapperRef={wrapperRef}
            dismissingRef={dismissingRef}
            onSelect={(item) => {
              if (item.type === 'directory') {
                const fullPath = buildFullPath(item.name)
                // 导航到该目录
                onNavigate(fullPath)
                // 保持编辑模式，更新输入值，方便继续输入下一级路径
                setEditValue(fullPath + '/')
                setSuggestions([])
                setShowSuggestions(false)
                setSelectedIndex(0)
              } else {
                applySuggestion(item.name)
              }
            }}
            onHoverIndex={setSelectedIndex}
          />
        )}
      </div>
    )
  }

  return (
    <div className="file-breadcrumb" onClick={handleContainerClick} title={t('filePanel.editPath')}>
      {segments.map((seg, i) => (
        <React.Fragment key={seg.path}>
          {i > 0 && (
            <span className="breadcrumb-separator">›</span>
          )}
          {i === lastIndex ? (
            <span className="breadcrumb-segment current" title={seg.path}>
              {seg.name === '/' ? '/' : seg.name}
            </span>
          ) : (
            <span
              className="breadcrumb-segment"
              onClick={(e) => {
                e.stopPropagation()
                onNavigate(seg.path)
              }}
              title={seg.path}
            >
              {seg.name === '/' ? '/' : seg.name}
            </span>
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

export default FileBreadcrumb

/**
 * 自动补全下拉菜单（通过 Portal 渲染到 body，避免被面包屑栏的 overflow 裁切）
 */
function AutocompleteDropdown({
  suggestions,
  selectedIndex,
  wrapperRef,
  dismissingRef,
  onSelect,
  onHoverIndex,
}: {
  suggestions: SuggestionItem[]
  selectedIndex: number
  wrapperRef: React.RefObject<HTMLDivElement>
  dismissingRef: React.MutableRefObject<boolean>
  onSelect: (item: SuggestionItem) => void
  onHoverIndex: (index: number) => void
}) {
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 })

  useEffect(() => {
    const updatePosition = () => {
      if (wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect()
        setPosition({
          top: rect.bottom + 2,
          left: rect.left,
          width: rect.width,
        })
      }
    }

    // 初始计算一次
    updatePosition()

    // 窗口大小变化或页面滚动时重新计算
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [wrapperRef])

  // selectedIndex 变化时，滚动到可见区域
  useEffect(() => {
    if (selectedIndex < 0) return
    const selectedEl = document.querySelector('.breadcrumb-suggestion-item.selected')
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  return createPortal(
    <ul
      className="breadcrumb-suggestions"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        width: `${position.width}px`,
        zIndex: 9999,
      }}
    >
      {suggestions.map((item, index) => (
        <li
          key={item.name}
          className={`breadcrumb-suggestion-item${index === selectedIndex ? ' selected' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            // 先标记正在关闭，防止后续点击事件重新打开编辑模式
            dismissingRef.current = true
            // 立即隐藏 DOM 下拉框
            const el = document.querySelector('.breadcrumb-suggestions')
            if (el) (el as HTMLElement).style.display = 'none'
            // 延迟更新 React 状态
            setTimeout(() => onSelect(item), 0)
          }}
          onMouseEnter={() => onHoverIndex(index)}
        >
          <span className="suggestion-icon">
            {item.type === 'directory' ? (
              /* 文件夹图标 */
              <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '12px', height: '12px' }}>
                <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
              </svg>
            ) : (
              /* 文件图标 */
              <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '12px', height: '12px' }}>
                <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z" />
              </svg>
            )}
          </span>
          <span className="suggestion-name">{item.name}</span>
        </li>
      ))}
    </ul>,
    document.body
  )
}
