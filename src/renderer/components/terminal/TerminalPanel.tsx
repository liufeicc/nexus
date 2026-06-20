/**
 * 终端面板组件
 */

import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { useAppStore } from '../../store'
import { BasePanel } from '../common/BasePanel'
import { useI18n } from '../../i18n'

interface TerminalPanelProps {
  panelId: string
  ptyId: string
  cwd?: string
}

/**
 * 终端面板组件
 */
export function TerminalPanel({ panelId, ptyId, cwd }: TerminalPanelProps) {
  const { updatePanelTitle, showConfirmModal, showContextMenu, hideContextMenu, closePanel, showToast, nexusDataPanelId, setNexusDataPanelId, activePanelId } = useAppStore()
  const { t } = useI18n()
  const terminalRef = useRef<HTMLDivElement>(null)
  const terminalInstance = useRef<Terminal | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const hideContextMenuRef = useRef(hideContextMenu)
  const cachedSelectionRef = useRef('') // 缓存选中文本，用于右键菜单判断

  // Nexus 连接状态（终端使用数据轨）
  const isConnected = nexusDataPanelId === panelId
  // 不再禁用其他面板的按钮，点击即可"抢占"连接

  // 显示完整工作目录路径（memoize 避免重复计算）
  const displayPath = React.useMemo(() => {
    return cwd || '~'
  }, [cwd])

  // 实际执行关闭面板的逻辑
  const performClosePanel = async () => {
    try {
      await closePanel(panelId)
    } catch (error) {
      console.error('[TerminalPanel] 关闭面板失败:', error)
    }
  }

  // 关闭面板（带二次确认）
  const handleClosePanel = () => {
    showConfirmModal(
      t('toolbar.confirmClosePanel'),
      t('toolbar.confirmClosePanelMsg'),
      performClosePanel
    )
  }

  // Nexus 连接切换处理
  const handleToggleNexus = useCallback(() => {
    if (isConnected) {
      // 断开数据轨连接
      window.electronAPI.nexus.disconnect()
      setNexusDataPanelId(null)
      showToast(t('nexus.disconnected'), 1500)
    } else {
      // 建立连接（主进程会自动断开旧的数据轨连接）
      window.electronAPI.nexus.connect(panelId, ptyId)
      setNexusDataPanelId(panelId)
      showToast(t('nexus.connected'), 1500)
    }
  }, [isConnected, panelId, ptyId, setNexusDataPanelId, showToast])

  // 监听连接状态变化（主进程通知，只处理数据轨事件）
  useEffect(() => {
    const cleanup = window.electronAPI.nexus.onConnectionStateChanged((data) => {
      if (data.track !== 'data') return
      if (data.connected) {
        setNexusDataPanelId(data.panelId)
      } else {
        setNexusDataPanelId(null)
      }
    })
    return cleanup
  }, [setNexusDataPanelId])

  // 监听 cwd prop 变化，更新面板标题并恢复焦点
  useEffect(() => {
    updatePanelTitle(panelId, `${t('panel.terminal')} - ${cwd || '~'}`)
    // cwd 变化后恢复终端焦点，延迟到 React 渲染完成后
    requestAnimationFrame(() => {
      if (terminalInstance.current) {
        terminalInstance.current.focus()
      }
    })
  }, [cwd, panelId, updatePanelTitle])

  // 面板获得焦点时，终端自动获取输入焦点
  const isFocused = activePanelId === panelId
  const isFocusedRef = useRef(isFocused)
  isFocusedRef.current = isFocused

  // 用 ref 记录当前面板是否应该聚焦，终端初始化完成后检查
  useEffect(() => {
    if (isFocusedRef.current && terminalInstance.current) {
      requestAnimationFrame(() => {
        terminalInstance.current?.focus()
      })
    }
  }, [isFocused])

  // 终端初始化完成后，如果面板是聚焦状态则自动聚焦
  const focusAfterInit = useCallback(() => {
    if (isFocusedRef.current && terminalInstance.current) {
      requestAnimationFrame(() => {
        terminalInstance.current?.focus()
      })
    }
  }, [])

  // 监听终端 cwd 变化（通过 OSC 7 序列追踪）
  useEffect(() => {
    const unsubscribe = window.electronAPI.pty.onCwdChanged(({ ptyId: incomingPtyId, cwd: newCwd }) => {
      if (incomingPtyId === ptyIdRef.current) {
        useAppStore.getState().updatePanelCwd(panelId, newCwd)
      }
    })
    return unsubscribe
  }, [panelId])

  // 右键菜单处理：使用缓存的选中文本判断是否有终端选择
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    const hasSelection = cachedSelectionRef.current.length > 0
    showContextMenu(e.clientX, e.clientY, undefined, panelId, hasSelection)
  }

  useEffect(() => {
    // 更新 ref 指向
    hideContextMenuRef.current = hideContextMenu

    // 使用标志位防止组件卸载后仍执行初始化
    let disposed = false
    // 保存 RAF 回调内部的清理函数，由外层 cleanup 统一调用
    let innerCleanup: (() => void) | null = null

    if (!terminalRef.current) return

    // 创建终端实例
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 1000,
      theme: {
        background: '#000000',
        foreground: '#cccccc',
      },
    })

    // 添加 fit 插件
    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    terminal.loadAddon(fitAddon)

    // 等待浏览器完成布局后再 open 终端，避免容器尺寸为 0 导致 xterm.js 错误
    const rafId = requestAnimationFrame(() => {
      if (disposed || !terminalRef.current) return
      terminal.open(terminalRef.current)
      terminalInstance.current = terminal

      // 写入欢迎信息
      const welcomeMessage = [
        `\r\n\x1b[32m ${t('terminal.welcomeTitle')}\x1b[0m`,
        'Shell: bash',
        'Working Directory: ' + (cwd || '~'),
        '',
        `\x1b[33m ${t('terminal.welcomeTip')}\x1b[0m`,
        t('terminal.welcomeHint'),
        '',
      ]
      terminal.write(welcomeMessage.join('\r\n') + '\r\n')

      /**
       * 安全的 fit 操作：保存滚动位置 → 执行 fit → 恢复滚动位置
       * 当 cols/rows 未变化时，fit() 仍可能重置 viewportY，需要手动恢复
       * 当 cols/rows 变化时，xterm.js 重新布局 buffer，旧位置已无意义，不恢复
       */
      const safeFit = () => {
        if (!fitAddonRef.current || !terminalInstance.current) return
        if (!terminalRef.current || terminalRef.current.offsetHeight <= 0) return

        const term = terminalInstance.current
        const prevCols = term.cols
        const prevRows = term.rows
        const prevScrollY = term.buffer.active.viewportY

        try {
          fitAddonRef.current.fit()
        } catch {
          return
        }

        // 尺寸未变时，滚动位置不应被重置，手动恢复
        if (term.cols === prevCols && term.rows === prevRows) {
          const currentScrollY = term.buffer.active.viewportY
          if (currentScrollY !== prevScrollY) {
            term.scrollLines(prevScrollY - currentScrollY)
          }
        }
      }

      // 等待浏览器完成布局后适配尺寸（初次 fit 不需要恢复滚动位置）
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (fitAddonRef.current && terminalInstance.current && terminalRef.current && terminalRef.current.offsetHeight > 0) {
            try {
              fitAddonRef.current.fit()
            } catch (error) {
              console.warn('[TerminalPanel] fit 失败:', error)
            }
          }
          // 初始化时自动聚焦（终端默认应该获得焦点）
          focusAfterInit()
        })
      })

      // 监听窗口大小变化（带 debounce，避免频繁 resize 时重复 fit）
      let resizeTimer: ReturnType<typeof setTimeout> | null = null
      const handleResize = () => {
        if (resizeTimer) clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          safeFit()
          resizeTimer = null
        }, 100)
      }
      window.addEventListener('resize', handleResize)

      // 使用 ResizeObserver 监听终端容器本身的尺寸变化
      // 增加最小变化阈值，避免 1-2px 的微变化（如 Dynamic Island 展开）触发不必要的 fit
      const MIN_SIZE_CHANGE = 4 // 像素阈值
      let lastFitWidth = 0
      let lastFitHeight = 0
      let observerTimer: ReturnType<typeof setTimeout> | null = null
      const resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (!entry) return
        const { width, height } = entry.contentRect
        // 变化量小于阈值则跳过，避免微小布局抖动触发 viewport 重算
        if (Math.abs(width - lastFitWidth) < MIN_SIZE_CHANGE &&
            Math.abs(height - lastFitHeight) < MIN_SIZE_CHANGE) {
          return
        }
        lastFitWidth = width
        lastFitHeight = height

        if (observerTimer) clearTimeout(observerTimer)
        observerTimer = setTimeout(() => {
          safeFit()
          observerTimer = null
        }, 100)
      })

      if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current)
      }

      // 监听 PTY 数据输出
      const unsubscribe = window.electronAPI.pty.onData(({ ptyId: incomingPtyId, data }) => {
        if (incomingPtyId === ptyId && terminalInstance.current) {
          terminalInstance.current.write(data)
        }
      })

      // 用户输入转发到 PTY
      const inputDisposable = terminal.onData((data) => {
        window.electronAPI.pty.write(ptyId, data)
      })

      // 监听 xterm 选区变化，同步到 store
      const selectionDisposable = terminal.onSelectionChange(() => {
        const text = terminal.getSelection()
        useAppStore.getState().setTerminalSelection(text.length > 0)
      })

      // 获取 PTY 初始尺寸
      const resizeToTerminal = () => {
        if (terminalInstance.current && ptyIdRef.current && terminalInstance.current.rows && terminalInstance.current.cols) {
          window.electronAPI.pty.resize(ptyIdRef.current, terminalInstance.current.cols, terminalInstance.current.rows)
        }
      }

      // 保存 ptyId
      ptyIdRef.current = ptyId

      // 初始尺寸适配
      setTimeout(() => {
        resizeToTerminal()
      }, 100)

      // 监听 fit 变化
      terminal.onResize(() => {
        resizeToTerminal()
      })

      // 更新面板标题
      const updateTitle = () => {
        const shellInfo = cwd ? ` - ${cwd}` : ''
        updatePanelTitle(panelId, `${t('panel.terminal')}${shellInfo}`)
      }
      updateTitle()

      // 右键菜单：缓存终端选中文本
      const xtermEl = terminal.element
      const handleXtermMouseDown = (e: MouseEvent) => {
        if (e.button === 2) {
          const text = terminal.getSelection()
          if (text && text.length > 0) {
            cachedSelectionRef.current = text
          }
        }
      }
      xtermEl?.addEventListener('mousedown', handleXtermMouseDown, true)

      const handleXtermMouseUp = (e: MouseEvent) => {
        if (e.button === 0) {
          setTimeout(() => {
            const text = terminal.getSelection()
            if (text && text.length > 0) {
              cachedSelectionRef.current = text
            }
          }, 10)
        }
      }
      xtermEl?.addEventListener('mouseup', handleXtermMouseUp, true)

      // 监听复制事件
      const handleCopy = (e: Event) => {
        const detail = (e as CustomEvent).detail
        if (detail?.panelId === panelId && terminalInstance.current) {
          const selectedText = cachedSelectionRef.current || terminalInstance.current.getSelection()
          if (selectedText) {
            window.electronAPI.clipboard.writeText(selectedText).then(() => {
              showToast(t('toast.copySuccess'), 1500)
            }).catch(() => {})
            terminalInstance.current?.clearSelection()
            cachedSelectionRef.current = ''
          }
        }
      }
      window.addEventListener('terminal-copy', handleCopy)

      // 监听粘贴事件
      const handlePaste = (e: Event) => {
        const detail = (e as CustomEvent).detail
        if (detail?.panelId === panelId && terminalInstance.current) {
          terminalInstance.current.focus()
        }
      }
      window.addEventListener('terminal-paste', handlePaste)

      // 监听终端 focus 事件
      const terminalContainer = terminalRef.current
      const handleTerminalFocus = () => {
        if (useAppStore.getState().activePanelId !== panelId) {
          useAppStore.getState().setActivePanelId(panelId)
        }
      }
      terminalContainer?.addEventListener('focus', handleTerminalFocus, true)

      // 监听全局 terminal-focus 事件
      const handleGlobalFocus = (e: Event) => {
        const detail = (e as CustomEvent).detail
        if (detail?.panelId === panelId && terminalInstance.current) {
          terminalInstance.current.focus()
        }
      }
      window.addEventListener('terminal-focus', handleGlobalFocus)

      // 保存清理函数到外部变量，由 useEffect 的 cleanup 统一调用
      innerCleanup = () => {
        window.removeEventListener('resize', handleResize)
        if (resizeTimer) clearTimeout(resizeTimer)
        resizeObserver.disconnect()
        if (observerTimer) clearTimeout(observerTimer)
        unsubscribe()
        inputDisposable.dispose()
        selectionDisposable.dispose()
        xtermEl?.removeEventListener('mousedown', handleXtermMouseDown, true)
        xtermEl?.removeEventListener('mouseup', handleXtermMouseUp, true)
        window.removeEventListener('terminal-copy', handleCopy)
        window.removeEventListener('terminal-paste', handlePaste)
        window.removeEventListener('terminal-focus', handleGlobalFocus)
        terminalContainer?.removeEventListener('focus', handleTerminalFocus, true)
        terminal.dispose()
        // 如果此面板是 Nexus 连接中的面板，自动断开
        if (useAppStore.getState().nexusDataPanelId === panelId) {
          window.electronAPI.nexus.disconnect()
          useAppStore.getState().setNexusDataPanelId(null)
        }
      }
    })

    // useEffect 的真正 cleanup 函数
    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
      // 如果 RAF 回调已经执行并创建了清理函数，调用它
      if (innerCleanup) {
        innerCleanup()
      }
    }
  }, [panelId, ptyId, updatePanelTitle, showContextMenu, showToast])

  // Nexus 连接按钮 SVG 图标
  const nexusButtonIcon = (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a6 6 0 0 1-12 0V8z" />
    </svg>
  )

  return (
    <BasePanel
      panelId={panelId}
      displayTitle={displayPath}
      headerLeft={
        <>
          <div className="status-dot" />
          <span className="terminal-title">bash - {displayPath}</span>
        </>
      }
      headerRightBefore={
        <button
          className={`terminal-nexus-btn ${isConnected ? 'nexus-connected' : ''}`}
          onClick={handleToggleNexus}
          title={isConnected ? t('filePanel.disconnectNexus') : t('filePanel.connectNexus')}
        >
          {nexusButtonIcon}
        </button>
      }
      onClose={handleClosePanel}
      onContextMenu={handleContextMenu}
    >
      <div
        ref={terminalRef}
        className="terminal-container"
        style={{ flex: 1, minHeight: 0 }}
      />
    </BasePanel>
  )
}

export default TerminalPanel
