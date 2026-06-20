/**
 * 全局事件监听 Hook
 */

import { useEffect } from 'react'
import { useAppStore, LayoutChild } from '../store'
import { DEFAULT_SHORTCUTS, ShortcutAction } from '@core/constants/shortcuts'
import { t } from '../i18n'
import type { TerminalPanel, PanelState } from '../store/types'

/**
 * 判断面板是否为终端面板
 */
function isTerminalPanel(panel: PanelState): boolean {
  return panel.panelType === 'terminal'
}

/**
 * 从布局树中按视觉顺序提取所有面板 ID
 * 按从左到右、从上到下的深度优先遍历顺序
 */
function collectPanelIds(node: LayoutChild): string[] {
  if (node.type === 'panel') {
    return [node.id]
  }
  const result: string[] = []
  for (const child of node.children) {
    result.push(...collectPanelIds(child))
  }
  return result
}

/**
 * 全局右键菜单监听
 */
export function useGlobalContextMenu() {
  const { showContextMenu, hideContextMenu } = useAppStore()

  useEffect(() => {
    // 阻止默认右键菜单，显示自定义菜单
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      // 检查是否点击在会话项上
      const sessionItem = (e.target as HTMLElement).closest('[data-session-id]')
      let selectedSessionId: string | undefined
      if (sessionItem) {
        selectedSessionId = (sessionItem as HTMLElement).dataset.sessionId
      }

      // 检查是否点击在终端面板上
      const terminalPanel = (e.target as HTMLElement).closest('[data-panel-id]')
      let selectedPanelId: string | undefined
      if (terminalPanel) {
        selectedPanelId = (terminalPanel as HTMLElement).dataset.panelId
        // 终端面板有自己的 contextmenu 处理器（带选中文本缓存），全局处理器不处理
        return
      }

      showContextMenu(e.clientX, e.clientY, selectedSessionId, selectedPanelId)
    }

    // 点击左键隐藏菜单
    const handleClick = () => {
      hideContextMenu()
    }

    // 滚动时隐藏菜单
    const handleScroll = () => {
      hideContextMenu()
    }

    document.addEventListener('contextmenu', handleContextMenu)
    document.addEventListener('click', handleClick)
    document.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [showContextMenu, hideContextMenu])
}

/**
 * 执行快捷键动作
 */
function executeShortcut(action: ShortcutAction): void {
  const state = useAppStore.getState()

  switch (action.type) {
    case 'close-modal':
      // Escape 键关闭所有模态框和菜单
      if (state.confirmModal?.visible) {
        state.hideConfirmModal()
      }
      if (state.renameModal?.visible) {
        state.hideRenameModal()
      }
      if (state.pathSelectorModal?.visible) {
        state.hidePathSelectorModal()
      }
      if (state.fileRenameModal?.visible) {
        state.hideFileRenameModal()
      }
      state.hideContextMenu()
      break

    case 'cycle-next-panel': {
      // Tab 键切换下一个面板焦点
      if (!state.layout || state.panels.length <= 1) return

      // 从布局树中提取面板 ID 顺序列表
      const panelIds = collectPanelIds(state.layout)
      if (panelIds.length <= 1) return

      const currentPanelId = state.activePanelId
      const currentIndex = panelIds.indexOf(currentPanelId ?? '')
      if (currentIndex === -1) return

      // 计算下一个面板的索引（循环）
      const nextIndex = (currentIndex + 1) % panelIds.length
      const nextPanelId = panelIds[nextIndex]

      state.setActivePanelId(nextPanelId)

      // 通知新面板获取终端焦点
      const focusEvent = new CustomEvent('terminal-focus', {
        detail: { panelId: nextPanelId },
      })
      window.dispatchEvent(focusEvent)

      break
    }

    case 'copy': {
      // Ctrl+C 复制：仅在终端有选中文本时执行复制，否则不拦截（让 Ctrl+C 传递给 PTY 用于终止程序）
      if (!state.hasTerminalSelection) return
      if (state.activePanelId) {
        const copyEvent = new CustomEvent('terminal-copy', {
          detail: { panelId: state.activePanelId },
        })
        window.dispatchEvent(copyEvent)
      }
      break
    }

    case 'paste': {
      // Ctrl+V 粘贴：从剪贴板读取文本并写入 PTY
      if (!state.activePanelId) return
      const panel = state.panels.find((p) => p.id === state.activePanelId)
      if (!panel || !isTerminalPanel(panel)) return

      const tp = panel as TerminalPanel
      window.electronAPI.clipboard
        .readText()
        .then((text: string) => {
          if (text && tp.ptyId) {
            window.electronAPI.pty.write(tp.ptyId, text)
            // 派发粘贴事件，通知 TerminalPanel 恢复焦点
            const pasteEvent = new CustomEvent('terminal-paste', {
              detail: { panelId: state.activePanelId },
            })
            window.dispatchEvent(pasteEvent)
          }
        })
        .catch(() => {})
      break
    }

    case 'new-session': {
      // Ctrl+T 新建会话：直接创建空白会话
      window.electronAPI.session.create()
        .then((newSession) => {
          return window.electronAPI.session.setActive(newSession.id).then(() => newSession)
        })
        .then((newSession) => {
          state.setActiveSessionId(newSession.id)
        })
        .then(() => {
          return window.electronAPI.session.list()
        })
        .then((sessions) => {
          state.setSessionIds(sessions.map((s: any) => s.id))
          window.dispatchEvent(new CustomEvent('sessions-change'))
        })
        .catch((error) => {
          console.error('[executeShortcut] 新建会话失败:', error)
        })
      break
    }

    case 'close-session': {
      // Ctrl+W 关闭当前会话
      if (!state.activeSessionId) return

      const sessionId = state.activeSessionId
      state.showConfirmModal(
        t('session.deleteSession'),
        t('session.confirmDelete').replace('{name}', ''),
        async () => {
          try {
            const sessions = await window.electronAPI.session.list()
            const deletedIndex = sessions.findIndex((s: any) => s.id === sessionId)

            await window.electronAPI.session.delete(sessionId)

            const newSessions = await window.electronAPI.session.list()
            state.setSessionIds(newSessions.map((s: any) => s.id))
            window.dispatchEvent(new CustomEvent('sessions-change'))

            // 清理被删除会话的缓存
            state.deleteSessionCache(sessionId)

            // 如果被删除的是当前会话，选中上一个
            if (newSessions.length > 0) {
              const prevSession = newSessions[deletedIndex - 1] || newSessions[0]
              if (prevSession) {
                await window.electronAPI.session.setActive(prevSession.id)
                state.setActiveSessionId(prevSession.id)
                // 恢复面板（异步，不阻塞）
                import('../utils/session-snapshot').then(({ restoreSessionPanels }) => {
                  restoreSessionPanels(prevSession.id)
                })
              }
            } else {
              state.setActiveSessionId(null)
              state.setPanelsFromSnapshot([], null)
            }
          } catch (error) {
            console.error('[executeShortcut] 关闭会话失败:', error)
          }
        }
      )
      break
    }
  }
}

/**
 * 键盘快捷键监听
 * 遍历 DEFAULT_SHORTCUTS 数组进行匹配，消除硬编码
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = useAppStore.getState()
      const isModalOpen =
        state.confirmModal?.visible ||
        state.renameModal?.visible ||
        state.pathSelectorModal?.visible ||
        state.settingsModalVisible

      // 模态框打开时，只响应 Escape 关闭，其他快捷键不触发
      if (isModalOpen) {
        const escapeShortcut = DEFAULT_SHORTCUTS.find(
          (s) => s.action.type === 'close-modal'
        )
        if (escapeShortcut && escapeShortcut.match(e)) {
          e.preventDefault()
          executeShortcut(escapeShortcut.action)
        }
        return
      }

      // 遍历所有快捷键定义，找到第一个匹配的并执行
      for (const shortcut of DEFAULT_SHORTCUTS) {
        if (shortcut.match(e)) {
          // 对于 Ctrl+C 复制：如果终端没有选中文本，不拦截（让 Ctrl+C 传递给 PTY 用于终止程序）
          if (shortcut.action.type === 'copy' && !state.hasTerminalSelection) {
            break
          }

          // 对于 Escape 关闭：如果没有模态框打开，不拦截（让 ESC 传递给终端）
          if (shortcut.action.type === 'close-modal' && !isModalOpen) {
            break
          }

          // 对于 Ctrl+V 粘贴：如果焦点在灵动岛输入框，不拦截（由 textarea 原生处理）
          if (shortcut.action.type === 'paste') {
            const active = document.activeElement
            if (active && active.classList.contains('island-agent-input')) {
              break
            }
            const activePanel = state.panels.find((p) => p.id === state.activePanelId)
            if (activePanel && !isTerminalPanel(activePanel)) {
              break
            }
          }

          e.preventDefault()
          if (shortcut.action.type !== 'cycle-next-panel') {
            // cycle-next-panel 需要 stopImmediatePropagation 阻止终端消费
            e.stopImmediatePropagation()
          }
          executeShortcut(shortcut.action)
          break // 只执行第一个匹配的
        }
      }
    }

    // 使用捕获阶段（capture: true），在子元素消费之前拦截
    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [])
}

/**
 * 退出前保存快照（主进程通过 IPC 通知渲染进程）
 */
export function useSaveOnExit() {
  const { saveSnapshot, activeSessionId } = useAppStore()

  useEffect(() => {
    // 监听主进程的退出保存事件
    if (!window.electronAPI.onSaveOnExit) return

    const unsubscribe = window.electronAPI.onSaveOnExit(async () => {
      const sessionId = activeSessionId ?? useAppStore.getState().activeSessionId
      console.log('[useSaveOnExit] 收到退出保存请求, sessionId:', sessionId)
      if (sessionId) {
        await useAppStore.getState().saveSnapshot(sessionId)
        console.log('[useSaveOnExit] 快照保存完成')
      }
    })
    return unsubscribe
  }, [activeSessionId, saveSnapshot])
}
