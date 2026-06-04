/**
 * 路径选择对话框组件
 */

import React from 'react'
import { createPortal } from 'react-dom'
import { useAppStore, captureAllBrowsersBeforeModal, clearAllBrowserSnapshots } from '../../store'
import { getBasename } from '../../../core/utils/path-utils'
import { useI18n } from '../../i18n'

/**
 * 路径选择对话框
 */
export function PathSelectorModal() {
  const { pathSelectorModal, hidePathSelectorModal, showAlertModal } = useAppStore()
  const { t } = useI18n()
  const [customPath, setCustomPath] = React.useState('')
  const [commonPaths, setCommonPaths] = React.useState<Array<{ name: string; path: string; icon?: string }>>([])
  const [suggestions, setSuggestions] = React.useState<Array<{ name: string; path: string; isDirectory: boolean }>>([])
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [showSuggestions, setShowSuggestions] = React.useState(false)
  const [pathError, setPathError] = React.useState('')
  const [dropdownStyle, setDropdownStyle] = React.useState<React.CSSProperties>({
    position: 'fixed',
    zIndex: 200000,
  })
  const inputRef = React.useRef<HTMLInputElement>(null)
  const dropdownRef = React.useRef<HTMLDivElement>(null)
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // 加载常用位置
  React.useEffect(() => {
    const loadCommonPaths = async () => {
      try {
        const savedPaths = await window.electronAPI.config.get('commonPaths')
        if (savedPaths && Array.isArray(savedPaths)) {
          setCommonPaths(savedPaths)
        } else {
          setCommonPaths([])
        }
      } catch (error) {
        console.error('[PathSelectorModal] 加载常用位置失败:', error)
      }
    }
    loadCommonPaths()
  }, [])

  // 对话框打开时，自动聚焦输入框 + 截图占位
  React.useEffect(() => {
    if (pathSelectorModal?.visible) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
      // 截图占位
      captureAllBrowsersBeforeModal()
    } else {
      // 关闭时清除截图
      clearAllBrowserSnapshots()
    }
  }, [pathSelectorModal?.visible])

  // 路径输入变化时，自动补全（带防抖）
  React.useEffect(() => {
    if (!customPath) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    // 清除之前的定时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const result = await window.electronAPI.path.autocomplete(customPath)
        if (result.suggestions && result.suggestions.length > 0) {
          setSuggestions(result.suggestions)
          setShowSuggestions(true)
          setSelectedIndex(0)
        } else {
          setSuggestions([])
          setShowSuggestions(false)
        }
      } catch (error) {
        console.error('[PathSelectorModal] 自动补全失败:', error)
        setSuggestions([])
        setShowSuggestions(false)
      }
    }, 150) // 150ms 防抖

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [customPath])

  // 监听 selectedIndex 变化，滚动选中项到可视区域
  React.useEffect(() => {
    if (!dropdownRef.current || !showSuggestions) return
    const selectedItem = dropdownRef.current.querySelector('.path-autocomplete-item.selected')
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, showSuggestions])

  // 点击下拉框外部时，关闭下拉框
  React.useEffect(() => {
    if (!showSuggestions) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const isInput = inputRef.current && inputRef.current.contains(target)
      const isDropdown = dropdownRef.current && dropdownRef.current.contains(target)
      if (!isInput && !isDropdown) {
        setShowSuggestions(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showSuggestions])

  // 监听窗口滚动和大小变化，更新下拉框位置
  React.useEffect(() => {
    if (!showSuggestions || !inputRef.current) return

    const updatePosition = () => {
      const rect = inputRef.current!.getBoundingClientRect()
      setDropdownStyle({
        position: 'fixed',
        zIndex: 200000,
        top: `${rect.bottom + 4}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
      })
    }

    updatePosition()

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [showSuggestions])

  // 组件卸载时清理
  React.useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  if (!pathSelectorModal || !pathSelectorModal.visible) {
    return null
  }

  // 选择建议项
  const handleSelectSuggestion = (suggestion: { name: string; path: string; isDirectory: boolean }) => {
    if (suggestion.isDirectory) {
      // 目录：追加到路径后面，添加 / 继续补全
      setCustomPath(suggestion.path + '/')
      setPathError('')
    } else {
      // 文件：直接使用
      setCustomPath(suggestion.path)
      setShowSuggestions(false)
    }
  }

  // 保存路径到常用位置
  const saveToCommonPaths = async (path: string) => {
    try {
      const savedPaths = await window.electronAPI.config.get('commonPaths')
      const currentPaths = Array.isArray(savedPaths) ? savedPaths : []

      const exists = currentPaths.some((p) => p.path === path)
      if (!exists) {
        const newPath = {
          name: getBasename(path),
          path,
          icon: '📁',
        }
        const updatedPaths = [newPath, ...currentPaths].slice(0, 10)
        await window.electronAPI.config.save('commonPaths', updatedPaths)
        setCommonPaths(updatedPaths)
      }
    } catch (error) {
      console.error('[PathSelectorModal] 保存路径失败:', error)
    }
  }

  // 删除常用位置
  const deleteCommonPath = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const savedPaths = await window.electronAPI.config.get('commonPaths')
      const currentPaths = Array.isArray(savedPaths) ? savedPaths : []
      const updatedPaths = currentPaths.filter((p: any) => p.path !== path)
      await window.electronAPI.config.save('commonPaths', updatedPaths)
      setCommonPaths(updatedPaths)
    } catch (error) {
      console.error('[PathSelectorModal] 删除路径失败:', error)
    }
  }

  const handleCommonPathClick = async (path: string) => {
    const result = await window.electronAPI?.path?.exists(path)
    if (!result.exists) {
      showAlertModal(t('pathSelector.title'), t('toast.pathNotExist'))
      return
    }

    pathSelectorModal.onConfirm?.(path)
    hidePathSelectorModal()
  }

  const handleConfirm = async () => {
    const trimmedPath = customPath.replace(/\/+$/, '') || customPath // 去掉末尾斜杠
    if (trimmedPath.trim()) {
      const result = await window.electronAPI.path.exists(trimmedPath)
      if (!result.exists) {
        setPathError(t('toast.pathNotExist'))
        return
      }

      pathSelectorModal.onConfirm?.(trimmedPath)
      saveToCommonPaths(trimmedPath)
    }
    hidePathSelectorModal()
  }

  const handleCancel = () => {
    hidePathSelectorModal()
  }

  // 处理键盘导航
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (showSuggestions && suggestions.length > 0) {
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev))
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (showSuggestions && suggestions.length > 0) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
      }
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (showSuggestions && suggestions.length > 0) {
        const current = suggestions[selectedIndex] || suggestions[0]
        handleSelectSuggestion(current)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (showSuggestions && suggestions.length > 0 && selectedIndex >= 0) {
        // 如果有选中的建议项，先补全；否则确认路径
        const current = suggestions[selectedIndex]
        if (current && current.isDirectory) {
          handleSelectSuggestion(current)
        } else if (customPath.trim()) {
          handleConfirm()
        }
      } else if (customPath.trim()) {
        handleConfirm()
      }
    } else if (e.key === 'Escape') {
      if (showSuggestions) {
        setShowSuggestions(false)
      } else {
        handleCancel()
      }
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-container" style={{ minWidth: '400px', maxWidth: '500px' }}>
        <div className="modal-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
          <h3 className="modal-title">{t('pathSelector.title')}</h3>
          <p className="modal-text" style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
            {t('filePanel.favorites')}
          </p>
        </div>
        <div className="modal-body" style={{ padding: 0, position: 'relative' }}>
          {/* 常用路径列表 */}
          <div className="common-paths-list">
            {commonPaths.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                {t('common.noData')}
              </div>
            ) : (
              commonPaths.map((item) => (
                <div
                  key={item.path}
                  className="common-path-item"
                  onClick={() => handleCommonPathClick(item.path)}
                >
                  <span className="icon">{item.icon}</span>
                  <span className="name">{item.name}</span>
                  <span className="path">{item.path}</span>
                  <button
                    className="common-path-delete-btn"
                    title={t('common.delete')}
                    onClick={(e) => deleteCommonPath(item.path, e)}
                  >
                    <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>

          {/* 自定义路径 */}
          <div className="custom-path-section">
            <p className="custom-path-label">{t('common.new')}</p>
            <input
              ref={inputRef}
              type="text"
              className="rename-input"
              placeholder={t('pathSelector.placeholder')}
              value={customPath}
              onChange={(e) => {
                setCustomPath(e.target.value)
                setPathError('')
              }}
              onKeyDown={handleKeyDown}
            />
            {pathError && (
              <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                {pathError}
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn modal-btn-cancel" onClick={handleCancel}>
            {t('common.cancel')}
          </button>
          <button
            className="modal-btn modal-btn-confirm"
            style={{
              backgroundColor: customPath.trim() ? '#2563eb' : '#9ca3af',
              opacity: customPath.trim() ? 1 : 0.5,
              cursor: customPath.trim() ? 'pointer' : 'not-allowed',
            }}
            onClick={handleConfirm}
            disabled={!customPath.trim()}
          >
            {t('pathSelector.confirm')}
          </button>
        </div>

        {/* 自动补全下拉框（通过 Portal 渲染到 body） */}
        {showSuggestions && suggestions.length > 0 && createPortal(
          <div
            ref={dropdownRef}
            className="path-autocomplete-dropdown"
            style={dropdownStyle}
            onClick={(e) => e.stopPropagation()}
          >
            {suggestions.map((suggestion, index) => (
              <div
                key={suggestion.path}
                className={`path-autocomplete-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleSelectSuggestion(suggestion)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="autocomplete-icon">
                  {suggestion.isDirectory ? '📁' : '📄'}
                </span>
                <span className="autocomplete-name">{suggestion.name}</span>
                <span className="autocomplete-path">{suggestion.path}</span>
              </div>
            ))}
          </div>,
          document.body
        )}
      </div>
    </div>
  )
}

export default PathSelectorModal
