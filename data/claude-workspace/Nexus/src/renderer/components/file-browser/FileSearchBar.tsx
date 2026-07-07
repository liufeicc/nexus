/**
 * 文件预览搜索栏组件
 *
 * 在文件预览顶部显示搜索输入框、匹配计数、上一个/下一个按钮。
 * 支持 ESC 关闭。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useI18n } from '../../i18n'

interface SearchBarProps {
  /** 关闭搜索栏 */
  onClose: () => void
  /** 搜索文本变化时回调（输入中） */
  onChange?: (text: string) => void
  /** 按下回车时回调（触发搜索） */
  onSearch: (text: string) => void
  /** 跳转到上一个匹配 */
  onPrev: () => void
  /** 跳转到下一个匹配 */
  onNext: () => void
  /** 当前匹配索引（从 1 开始） */
  currentMatch: number
  /** 总匹配数 */
  totalMatches: number
}

export function FileSearchBar({
  onClose,
  onChange,
  onSearch,
  onPrev,
  onNext,
  currentMatch,
  totalMatches,
}: SearchBarProps) {
  const { t } = useI18n()
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开时自动聚焦
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // ESC 关闭搜索栏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
    onChange?.(e.target.value)
  }, [onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSearch(inputValue)
    }
  }, [inputValue, onSearch])

  return (
    <div className="file-search-bar">
      <input
        ref={inputRef}
        type="text"
        className="file-search-input"
        placeholder={t('common.search')}
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
      />
      <span className="file-search-count">
        {totalMatches > 0 ? `${currentMatch} / ${totalMatches}` : '0 / 0'}
      </span>
      <button
        className="file-search-btn"
        onClick={onPrev}
        disabled={totalMatches === 0}
        title={t('fileSearch.prevMatch')}
      >
        ‹
      </button>
      <button
        className="file-search-btn"
        onClick={onNext}
        disabled={totalMatches === 0}
        title={t('fileSearch.nextMatch')}
      >
        ›
      </button>
      <button
        className="file-search-close-btn"
        onClick={onClose}
        title={t('fileSearch.closeSearch')}
      >
        ✕
      </button>
    </div>
  )
}
