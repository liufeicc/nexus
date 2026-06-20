/**
 * 浏览器面板 - 地址栏与 URL 自动补全 Hook
 *
 * 管理地址栏输入、URL 历史记录建议、键盘导航、内联补全等功能。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store'
import { t } from '../../i18n'
import type { Bookmark, BrowserHistoryEntry } from '@core/types'
import type { BrowserPanel } from '../../store/types'

interface UseBrowserAddressBarParams {
  activeTabId: string | null
  /** 当前活动标签的 URL，用于初始化地址栏显示值 */
  currentTabUrl: string
  /** 导航函数，由调用方（如 useBrowserNavigation）提供 */
  navigateTo: (url: string) => Promise<void>
  /** 书签列表，用于判断当前 URL 是否已收藏 */
  bookmarks: Bookmark[]
  /** 当前默认网址，用于判断当前 URL 是否为默认网址 */
  defaultUrl: string
  /** 刷新书签列表的回调 */
  refreshBookmarks: () => void
}

interface UseBrowserAddressBarReturn {
  inputValue: string
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  inlineSuggestion: string
  urlSuggestions: BrowserHistoryEntry[]
  selectedSuggestionIndex: number
  inputScrollLeft: number
  setInputScrollLeft: React.Dispatch<React.SetStateAction<number>>
  inputRef: React.MutableRefObject<HTMLInputElement | null>
  handleUrlSubmit: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleInputFocus: () => void
  handleInputBlur: () => void
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleClearInput: () => void
  handleSetDefaultUrl: () => Promise<void>
  handleAddBookmark: () => Promise<void>
  /** 当前 URL 是否已在书签中 */
  isBookmarked: boolean
  /** 当前 URL 是否为默认网址 */
  isDefaultUrl: boolean
}

export function useBrowserAddressBar({
  activeTabId,
  currentTabUrl,
  navigateTo,
  bookmarks,
  defaultUrl,
  refreshBookmarks,
}: UseBrowserAddressBarParams): UseBrowserAddressBarReturn {
  // 地址栏输入值
  const [inputValue, setInputValue] = useState(
    currentTabUrl === 'about:blank' ? '' : currentTabUrl
  )
  // URL 自动补全
  const [urlSuggestions, setUrlSuggestions] = useState<BrowserHistoryEntry[]>([])
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1)
  const [inlineSuggestion, setInlineSuggestion] = useState<string>('')
  const [inputScrollLeft, setInputScrollLeft] = useState(0)

  // 状态标志：当前 URL 是否已收藏 / 是否为默认网址
  const [isBookmarked, setIsBookmarked] = useState(false)
  const [isDefaultUrl, setIsDefaultUrl] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const historyCacheRef = useRef<BrowserHistoryEntry[]>([])

  // 加载历史记录缓存（组件挂载时执行一次）
  useEffect(() => {
    window.electronAPI.browser.history.list(500).then((entries) => {
      historyCacheRef.current = entries
    }).catch(() => {})
  }, [])

  /**
   * 同步书签和默认网址状态
   * 使用 inputValue（地址栏显示的实际 URL）来判断
   */
  useEffect(() => {
    const url = inputValue.trim()
    if (!url || url === 'about:blank') {
      setIsBookmarked(false)
      setIsDefaultUrl(false)
      return
    }
    // 判断是否在书签中
    const bookmarked = bookmarks.some((b) => b.url === url)
    setIsBookmarked(bookmarked)
    // 判断是否为默认网址
    setIsDefaultUrl(defaultUrl === url)
  }, [inputValue, bookmarks, defaultUrl])

  const clearSuggestions = useCallback(() => {
    setInlineSuggestion('')
    setUrlSuggestions([])
    setSelectedSuggestionIndex(-1)
  }, [])

  const fetchUrlSuggestions = useCallback((query: string) => {
    if (!query || query.trim() === '') {
      clearSuggestions()
      return
    }
    const history = historyCacheRef.current
    if (history.length === 0) return

    const lowerQuery = query.toLowerCase()
    const filtered = history.filter(
      (item) =>
        item.url.toLowerCase().includes(lowerQuery) ||
        (item.title && item.title.toLowerCase().includes(lowerQuery))
    )
    const suggestions = filtered.slice(0, 10)
    if (suggestions.length > 0) {
      setUrlSuggestions(suggestions)
      setSelectedSuggestionIndex(-1)
      setInlineSuggestion(suggestions[0].url)
    } else {
      clearSuggestions()
    }
  }, [clearSuggestions])

  const handleUrlSubmit = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (selectedSuggestionIndex >= 0 && urlSuggestions[selectedSuggestionIndex]) {
          const selected = urlSuggestions[selectedSuggestionIndex]
          setInputValue(selected.url)
          navigateTo(selected.url)
        } else {
          navigateTo(inputValue)
        }
        clearSuggestions()
      } else if (e.key === 'Tab' && inlineSuggestion) {
        e.preventDefault()
        setInputValue(inlineSuggestion)
        setInlineSuggestion('')
      } else if (e.key === 'ArrowRight' && inlineSuggestion) {
        e.preventDefault()
        setInputValue(inlineSuggestion)
        setInlineSuggestion('')
      } else if (e.key === 'ArrowDown' && urlSuggestions.length > 0) {
        e.preventDefault()
        setSelectedSuggestionIndex((prev) => {
          const next = prev < urlSuggestions.length - 1 ? prev + 1 : 0
          setInlineSuggestion(urlSuggestions[next].url)
          return next
        })
      } else if (e.key === 'ArrowUp' && urlSuggestions.length > 0) {
        e.preventDefault()
        setSelectedSuggestionIndex((prev) => {
          const next = prev > 0 ? prev - 1 : urlSuggestions.length - 1
          setInlineSuggestion(urlSuggestions[next].url)
          return next
        })
      } else if (e.key === 'Escape') {
        clearSuggestions()
      }
    },
    [selectedSuggestionIndex, urlSuggestions, inlineSuggestion, inputValue, navigateTo, clearSuggestions]
  )

  const handleInputFocus = useCallback(() => {
    inputRef.current?.select()
    if (inputValue.trim()) {
      fetchUrlSuggestions(inputValue)
    }
  }, [inputValue, fetchUrlSuggestions])

  const handleInputBlur = useCallback(() => {
    clearSuggestions()
  }, [clearSuggestions])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setInputValue(value)
      fetchUrlSuggestions(value)
    },
    [fetchUrlSuggestions]
  )

  const handleClearInput = useCallback(() => {
    setInputValue('')
    clearSuggestions()
    inputRef.current?.focus()
  }, [clearSuggestions])

  /**
   * 切换默认网址：已是默认则取消，否则设置为默认
   */
  const handleSetDefaultUrl = useCallback(async () => {
    const url = inputValue.trim()
    if (!url || url === 'about:blank') return
    if (isDefaultUrl) {
      // 取消默认网址
      await window.electronAPI.config.save('browserDefaultUrl', '')
      useAppStore.getState().showToast(t('browser.unsetDefaultUrl'))
    } else {
      // 设置为默认网址
      await window.electronAPI.config.save('browserDefaultUrl', url)
      useAppStore.getState().showToast(t('browser.setDefaultUrl'))
    }
  }, [inputValue, isDefaultUrl])

  /**
   * 切换书签：已收藏则移除，否则添加
   */
  const handleAddBookmark = useCallback(async () => {
    const url = inputValue.trim()
    if (!url || url === 'about:blank') return

    if (isBookmarked) {
      // 从书签中移除：查找匹配的书签 ID
      const matching = bookmarks.find((b) => b.url === url)
      if (matching) {
        await window.electronAPI.browser.bookmark.delete(matching.id)
        useAppStore.getState().showToast(t('browser.removeBookmark'))
      }
    } else {
      // 添加为书签
      const state = useAppStore.getState()
      const panel = state.panels.find((p): p is BrowserPanel => p.panelType === 'browser' && p.browserTabs?.has(activeTabId || ''))
      const activeTab = panel?.browserTabs?.get(activeTabId || '')
      const title = activeTab?.title || url
      await window.electronAPI.browser.bookmark.add(url, title)
      useAppStore.getState().showToast(t('browser.addBookmark'))
    }
    // 刷新书签列表，更新状态
    refreshBookmarks()
  }, [inputValue, activeTabId, isBookmarked, bookmarks, refreshBookmarks])

  return {
    inputValue,
    setInputValue,
    inlineSuggestion,
    urlSuggestions,
    selectedSuggestionIndex,
    inputScrollLeft,
    setInputScrollLeft,
    inputRef,
    handleUrlSubmit,
    handleInputFocus,
    handleInputBlur,
    handleInputChange,
    handleClearInput,
    handleSetDefaultUrl,
    handleAddBookmark,
    isBookmarked,
    isDefaultUrl,
  }
}
