/**
 * CodeMirror 编辑器组件
 *
 * 职责：CodeMirror 编辑器实例生命周期、文本选中 getter、搜索面板控制、自定义事件监听（paste/cut）。
 * 供 ContextMenu 通过 getCmSelectedText / getCapturedSelectedText 读取选中文本。
 */

import React, { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { keymap } from '@codemirror/view'
import {
  openSearchPanel,
  closeSearchPanel,
  setSearchQuery,
  SearchQuery,
  findNext,
  findPrevious,
  getSearchQuery,
} from '@codemirror/search'
import { defaultKeymap } from '@codemirror/commands'
import { useAppStore } from '../../store'

/** 深色主题 ID 集合（背景色暗，需要亮色文字） */
const DARK_THEMES = new Set(['deepblue', 'green'])

/** 文件查看器中选中文本的 getter 注册表（按 editorId 隔离，供 ContextMenu 读取） */
const cmGetSelectedTextMap = new Map<string, () => string>()
/** 右键前一刻捕获的选中文本（按 editorId 隔离） */
const cmCapturedSelectedTextMap = new Map<string, string>()

/** 获取 CodeMirror 编辑器中选中的文本 */
export function getCmSelectedText(editorId: string): string {
  return cmGetSelectedTextMap.get(editorId)?.() || ''
}

/** 获取右键前捕获的选中文本 */
export function getCapturedSelectedText(editorId: string): string {
  return cmCapturedSelectedTextMap.get(editorId) || ''
}

interface CodeMirrorEditorProps {
  /** 编辑器实例标识（用于隔离多实例的选中文本状态） */
  editorId: string
  content: string
  onChange?: (content: string) => void
  onSave?: () => void
  searchOpen: boolean
  searchText: string
  onSearchResults: (current: number, total: number) => void
  onNavRef?: (nav: { findNext: () => void; findPrev: () => void }) => void
  onSearchOpenChange: (open: boolean) => void
}

export function CodeMirrorEditor({
  editorId,
  content,
  onChange,
  onSave,
  searchOpen,
  searchText,
  onSearchResults,
  onNavRef,
  onSearchOpenChange,
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isInitializingRef = useRef(true)
  const currentThemeId = useAppStore(state => state.currentThemeId)
  const isDarkTheme = DARK_THEMES.has(currentThemeId)

  // 向父组件暴露获取选中文本的函数（按 editorId 注册）
  useEffect(() => {
    if (viewRef.current) {
      cmGetSelectedTextMap.set(editorId, () => {
        const view = viewRef.current
        if (!view) return ''
        const { from, to } = view.state.selection.main
        if (from === to) return ''
        return view.state.doc.slice(from, to).toString()
      })
    }
    return () => { cmGetSelectedTextMap.delete(editorId) }
  }, [editorId])

  // mousedown 捕获选中文本（在 contextmenu 之前，选中文本还在时）
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleMouseDown = () => {
      const view = viewRef.current
      if (!view) return
      const { from, to } = view.state.selection.main
      if (from !== to) {
        cmCapturedSelectedTextMap.set(editorId, view.state.doc.slice(from, to).toString())
      }
    }

    container.addEventListener('mousedown', handleMouseDown, true)
    return () => {
      container.removeEventListener('mousedown', handleMouseDown, true)
      cmCapturedSelectedTextMap.delete(editorId)
    }
  }, [editorId])

  // 监听来自 ContextMenu 的文本粘贴事件和剪切事件
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handlePasteText = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail?.text || !viewRef.current) return
      const view = viewRef.current
      const { from, to } = view.state.selection.main
      view.dispatch({
        changes: { from, to, insert: detail.text },
        selection: { anchor: from + detail.text.length },
      })
    }

    const handleCut = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail?.panelId) return
      if (!viewRef.current) return
      const view = viewRef.current
      const { from, to } = view.state.selection.main
      if (from !== to) {
        const selected = view.state.doc.slice(from, to).toString()
        navigator.clipboard.writeText(selected)
        view.dispatch({
          changes: { from, to, insert: '' },
          selection: { anchor: from },
        })
        cmCapturedSelectedTextMap.set(editorId, '')
      }
    }

    window.addEventListener('file-viewer-paste-text', handlePasteText)
    window.addEventListener('file-viewer-cut', handleCut)
    return () => {
      window.removeEventListener('file-viewer-paste-text', handlePasteText)
      window.removeEventListener('file-viewer-cut', handleCut)
    }
  }, [editorId])

  // 向父组件暴露导航函数
  useEffect(() => {
    if (onNavRef && viewRef.current) {
      const getMatchCount = () => {
        const view = viewRef.current!
        const query = getSearchQuery(view.state)
        if (!query.valid || !query.search) return { selected: 0, total: 0 }
        let count = 0
        let selected = 0
        const text = view.state.doc.toString()
        const lowerText = query.caseSensitive ? text : text.toLowerCase()
        const lowerSearch = query.caseSensitive ? query.search : query.search.toLowerCase()
        let idx = 0
        let pos = 0
        while ((idx = lowerText.indexOf(lowerSearch, pos)) !== -1) {
          count++
          pos = idx + lowerSearch.length
        }
        if (count > 0) {
          const firstIdx = lowerText.indexOf(lowerSearch)
          selected = firstIdx >= 0 ? 1 : 0
        }
        return { selected, total: count }
      }

      onNavRef({
        findNext: () => {
          findNext(viewRef.current!)
          const { selected, total } = getMatchCount()
          onSearchResults(selected, total)
        },
        findPrev: () => {
          findPrevious(viewRef.current!)
          const { selected, total } = getMatchCount()
          onSearchResults(selected, total)
        },
      })
    }
  }, [onNavRef, onSearchResults])

  // 初始化编辑器
  useEffect(() => {
    if (!containerRef.current || viewRef.current) return

    // 根据主题 ID 选择 CodeMirror 主题：深色主题用 oneDark，浅色主题用 CSS 变量适配
    const themeExtensions = isDarkTheme
      ? [oneDark]
      : [
          EditorView.theme({
            // 浅色主题：使用 CSS 变量，自动跟随应用主题切换
            '&': {
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
            },
            '.cm-content': {
              caretColor: 'var(--text-primary)',
            },
            '.cm-cursor': {
              borderLeftColor: 'var(--text-primary)',
            },
            '.cm-selectionBackground, .cm-selectionBackground ::selection': {
              backgroundColor: 'var(--accent-color) !important',
              color: '#ffffff !important',
            },
            '&.cm-focused .cm-selectionBackground, &.cm-focused .cm-selectionBackground ::selection': {
              backgroundColor: 'var(--accent-color) !important',
            },
            // 语法高亮：使用应用的次级文本色和弱化文本色
            '.cm-keyword': { color: 'var(--accent-color)' },
            '.cm-string': { color: 'var(--text-secondary)' },
            '.cm-comment': { color: 'var(--text-muted)', fontStyle: 'italic' },
            '.cm-number': { color: 'var(--text-secondary)' },
            '.cm-variableName': { color: 'var(--text-primary)' },
            '.cm-operator': { color: 'var(--text-secondary)' },
            '.cm-bracket': { color: 'var(--text-muted)' },
          }),
        ]

    const startState = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        ...themeExtensions,
        EditorView.lineWrapping, // 启用自动换行（CM6 官方扩展，调整内部行测量逻辑）
        keymap.of([
          ...defaultKeymap,
          { key: 'Ctrl-f', preventDefault: true, run: () => { onSearchOpenChange(true); return true } },
          { key: 'Cmd-f', preventDefault: true, run: () => { onSearchOpenChange(true); return true } },
          { key: 'Ctrl-s', preventDefault: true, run: () => { onSave?.(); return true } },
          { key: 'Cmd-s', preventDefault: true, run: () => { onSave?.(); return true } },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isInitializingRef.current) {
            onChange?.(update.state.doc.toString())
          }
        }),
        EditorView.theme({
          '&': { height: '100%', width: '100%' },
          '&.cm-focused': { outline: 'none' },
          '.cm-scroller': {
            fontFamily: "'Fira Code', 'Consolas', 'Monaco', 'Menlo', monospace",
            fontSize: '13px',
            lineHeight: '1.5',
            tabSize: '4',
            padding: '12px',
          },
          '.cm-content': { padding: '0', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' },
          '.cm-gutters': { display: 'none' },
        }),
      ],
    })

    isInitializingRef.current = true
    const view = new EditorView({
      state: startState,
      parent: containerRef.current,
    })
    viewRef.current = view

    openSearchPanel(view)

    queueMicrotask(() => { isInitializingRef.current = false })

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [isDarkTheme])

  // 内容变化时同步
  useEffect(() => {
    if (!viewRef.current || isInitializingRef.current) return
    const view = viewRef.current
    const currentDoc = view.state.doc.toString()
    if (currentDoc !== content) {
      isInitializingRef.current = true
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: content },
      })
      queueMicrotask(() => { isInitializingRef.current = false })
    }
  }, [content])

  // 搜索控制
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const getMatchCount = () => {
      const text = view.state.doc.toString()
      if (!searchText) return { selected: 0, total: 0 }
      const lowerText = text.toLowerCase()
      const lowerSearch = searchText.toLowerCase()
      let count = 0
      let pos = 0
      let idx: number
      while ((idx = lowerText.indexOf(lowerSearch, pos)) !== -1) {
        count++
        pos = idx + lowerSearch.length
      }
      return { selected: count > 0 ? 1 : 0, total: count }
    }

    if (searchOpen) {
      openSearchPanel(view)
      if (searchText) {
        const query = new SearchQuery({ search: searchText, caseSensitive: false, regexp: false })
        view.dispatch({ effects: setSearchQuery.of(query) })
        const { selected, total } = getMatchCount()
        onSearchResults(selected, total)
      }
    } else {
      closeSearchPanel(view)
      const query = new SearchQuery({ search: '', caseSensitive: false, regexp: false })
      view.dispatch({ effects: setSearchQuery.of(query) })
      onSearchResults(0, 0)
    }
  }, [searchOpen, searchText, onSearchResults])

  return <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
}
