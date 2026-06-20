/**
 * 渲染进程状态管理 - 简单 Actions
 *
 * 包含所有使用 set() 模式的状态更新函数。
 * 通过工厂函数接收 (set, get)，避免循环依赖。
 */

import { simplifyLayout, cleanupLayoutFlexValues, removePanelFromLayout, splitPanelLayout, swapPanelsInLayout, updateLayoutFlexAtPath } from './layout-ops'
import { isValidPanelId } from '@core/utils/panel-id'
import { getBasename } from '@core/utils/path-utils'
import type { AppState, PanelState, LayoutTree } from './types'
import type { AttachedFile } from '@core/types/agent'

/**
 * Toast 自动消失定时器
 */
let toastTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Zustand set/get 类型
 */
type SetFn = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>), replace?: boolean) => void
type GetFn = () => AppState

/**
 * 创建简单 actions（set 模式）
 */
export function createSimpleActions(set: SetFn, get: GetFn): Partial<AppState> {
  return {
    // 会话相关
    setActiveSessionId: (id: string | null) => set((state) => {
      if (state.activeSessionId !== null) {
        const newSessionsPanels = new Map(state.sessionsPanels)
        const newSessionsLayouts = new Map(state.sessionsLayouts)
        newSessionsPanels.set(state.activeSessionId, state.panels)
        newSessionsLayouts.set(state.activeSessionId, state.layout)

        const hasCachedPanels = id !== null && newSessionsPanels.has(id) && (newSessionsPanels.get(id)!.length > 0)
        // 新会话无缓存时，将空面板写入 Map，确保 TerminalArea 能渲染空状态容器
        if (!hasCachedPanels && id !== null) {
          newSessionsPanels.set(id, [])
          newSessionsLayouts.set(id, null)
        }
        return {
          activeSessionId: id,
          sessionsPanels: newSessionsPanels,
          sessionsLayouts: newSessionsLayouts,
          panels: hasCachedPanels ? newSessionsPanels.get(id)! : [],
          layout: hasCachedPanels ? newSessionsLayouts.get(id) ?? state.layout : null,
          activePanelId: hasCachedPanels ? newSessionsPanels.get(id)![0]?.id ?? null : null,
        }
      }
      const hasCachedPanels = id !== null && state.sessionsPanels.has(id) && (state.sessionsPanels.get(id)!.length > 0)
      // 新会话无缓存时，将空面板写入 Map
      if (!hasCachedPanels && id !== null) {
        const newSessionsPanels = new Map(state.sessionsPanels)
        newSessionsPanels.set(id, [])
        const newSessionsLayouts = new Map(state.sessionsLayouts)
        newSessionsLayouts.set(id, null)
        return {
          activeSessionId: id,
          sessionsPanels: newSessionsPanels,
          sessionsLayouts: newSessionsLayouts,
          panels: [],
          layout: null,
          activePanelId: null,
        }
      }
      return {
        activeSessionId: id,
        panels: state.sessionsPanels.get(id!)!,
        layout: state.sessionsLayouts.get(id!) ?? state.layout,
        activePanelId: state.sessionsPanels.get(id!)![0]?.id ?? null,
      }
    }),

    setSessionIds: (ids: string[]) => set({ sessionIds: ids }),

    deleteSessionCache: (sessionId: string) =>
      set((state) => {
        const newPanels = new Map(state.sessionsPanels)
        const newLayouts = new Map(state.sessionsLayouts)
        newPanels.delete(sessionId)
        newLayouts.delete(sessionId)
        return { sessionsPanels: newPanels, sessionsLayouts: newLayouts }
      }),

    setSidebarWidth: (width: number) => set({ sidebarWidth: width }),
    setSidebarCollapsed: (collapsed: boolean) => set({ sidebarCollapsed: collapsed }),
    setCurrentThemeId: (themeId: string) => set({ currentThemeId: themeId }),

    setAgentEnabled: (enabled: boolean) => {
      set({ agentEnabled: enabled })
      window.electronAPI.config.save('agentEnabled', enabled).catch(() => {})
    },

    setSettingsModalVisible: (visible: boolean) => set({ settingsModalVisible: visible }),
    setAboutModalVisible: (visible: boolean) => set({ aboutModalVisible: visible }),
    setNexusProfileModalVisible: (visible: boolean) => set({ nexusProfileModal: { visible } }),

    addPanel: (panel: PanelState) => set((state) => {
      if (!isValidPanelId(panel.id)) {
        console.error(`[AppStore] 无效的面板 ID: ${panel.id}`)
        return state
      }
      const newPanels = [...state.panels, panel]

      if (state.activeSessionId !== null) {
        const newSessionsPanels = new Map(state.sessionsPanels)
        newSessionsPanels.set(state.activeSessionId, newPanels)
        return {
          panels: newPanels,
          activePanelId: panel.id,
          sessionsPanels: newSessionsPanels,
        }
      }

      return {
        panels: newPanels,
        activePanelId: panel.id,
      }
    }),

    removePanel: (panelId: string) => set((state: AppState) => {
      const remainingPanels = state.panels.filter((p) => p.id !== panelId)

      let newLayout: LayoutTree | null = state.layout
      if (state.layout) {
        const result = removePanelFromLayout(state.layout, panelId)
        // removePanelFromLayout 返回 LayoutChild | null，只有容器节点才是有效的 LayoutTree
        if (result && result.type !== 'panel') {
          newLayout = result as LayoutTree
        } else {
          newLayout = null
        }
      }

      const newState: Partial<AppState> = {
        panels: remainingPanels,
        layout: newLayout,
        activePanelId: state.activePanelId === panelId
          ? (remainingPanels.length > 0 ? remainingPanels[0].id : null)
          : state.activePanelId,
      }

      if (state.activeSessionId !== null) {
        const newSessionsPanels = new Map(state.sessionsPanels)
        newSessionsPanels.set(state.activeSessionId, remainingPanels)
        newState.sessionsPanels = newSessionsPanels

        const newSessionsLayouts = new Map(state.sessionsLayouts)
        newSessionsLayouts.set(state.activeSessionId, newLayout)
        newState.sessionsLayouts = newSessionsLayouts
      }

      return newState
    }),

    updatePanelTitle: (panelId: string, title: string) => set((state: AppState) => {
      const newPanels = state.panels.map((p) => p.id === panelId ? { ...p, title } : p)
      const newState: Partial<AppState> = { panels: newPanels }

      if (state.activeSessionId !== null) {
        const newSessionsPanels = new Map(state.sessionsPanels)
        newSessionsPanels.set(state.activeSessionId, newPanels)
        newState.sessionsPanels = newSessionsPanels
      }

      return newState
    }),

    setPanelsFromSnapshot: (panels: PanelState[], layout: LayoutTree | null = null) => set((state: AppState) => {
      const newState: Partial<AppState> = {
        panels,
        layout,
        activePanelId: panels.length > 0 ? panels[0].id : null,
      }

      if (state.activeSessionId !== null) {
        const newSessionsPanels = new Map(state.sessionsPanels)
        newSessionsPanels.set(state.activeSessionId, panels)
        newState.sessionsPanels = newSessionsPanels

        const newSessionsLayouts = new Map(state.sessionsLayouts)
        newSessionsLayouts.set(state.activeSessionId, layout)
        newState.sessionsLayouts = newSessionsLayouts
      }

      return newState
    }),

    setActivePanelId: (panelId: string | null) => set({ activePanelId: panelId }),

    setLayout: (layout: LayoutTree | null) => set((state: AppState) => {
      const newState: Partial<AppState> = { layout }

      if (state.activeSessionId !== null) {
        const newSessionsLayouts = new Map(state.sessionsLayouts)
        newSessionsLayouts.set(state.activeSessionId, layout)
        newState.sessionsLayouts = newSessionsLayouts
      }

      return newState
    }),

    updateLayoutFlex: (path: number[], flexValues: Record<number, number>) => set((state: AppState) => {
      if (!state.layout) {
        return { layout: null }
      }

      const newLayout = updateLayoutFlexAtPath(state.layout, path, flexValues)

      const newState: Partial<AppState> = { layout: newLayout }

      if (state.activeSessionId !== null) {
        const newSessionsLayouts = new Map(state.sessionsLayouts)
        newSessionsLayouts.set(state.activeSessionId, newLayout)
        newState.sessionsLayouts = newSessionsLayouts
      }

      return newState
    }),

    splitPanel: (panelId: string, direction: 'horizontal' | 'vertical', newPanel: PanelState) => set((state: AppState) => {
      const newPanels = [...state.panels, newPanel]
      const newLayout = splitPanelLayout(state.layout, panelId, direction, newPanel)

      const newState: Partial<AppState> = {
        panels: newPanels,
        layout: newLayout,
        activePanelId: newPanel.id,
      }

      if (state.activeSessionId !== null) {
        const newSessionsPanels = new Map(state.sessionsPanels)
        newSessionsPanels.set(state.activeSessionId, newPanels)
        newState.sessionsPanels = newSessionsPanels

        const newSessionsLayouts = new Map(state.sessionsLayouts)
        newSessionsLayouts.set(state.activeSessionId, newLayout)
        newState.sessionsLayouts = newSessionsLayouts
      }

      return newState
    }),

    showContextMenu: (x: number, y: number, selectedSessionId?: string, selectedPanelId?: string, hasTerminalSelection?: boolean, rightClickedFilePath?: string, rightClickedSelectedText?: string) =>
      set({ contextMenu: { visible: true, x, y, selectedSessionId, selectedPanelId, hasTerminalSelection, rightClickedFilePath, rightClickedSelectedText } }),
    hideContextMenu: () => set({ contextMenu: null }),

    setDraggingPanelId: (panelId: string | null) => set({ draggingPanelId: panelId }),
    setDropTargetPanelId: (panelId: string | null) => set({ dropTargetPanelId: panelId }),

    swapPanels: (panelId1: string, panelId2: string) => set((state: AppState) => {
      if (!state.layout) return state

      const newLayout = swapPanelsInLayout(state.layout, panelId1, panelId2)

      const newPanels = [...state.panels]
      const idx1 = newPanels.findIndex(p => p.id === panelId1)
      const idx2 = newPanels.findIndex(p => p.id === panelId2)
      if (idx1 !== -1 && idx2 !== -1) {
        const temp = newPanels[idx1]
        newPanels[idx1] = newPanels[idx2]
        newPanels[idx2] = temp
      }

      const newState: Partial<AppState> = {
        layout: newLayout,
        panels: newPanels,
      }

      if (state.activeSessionId !== null) {
        const newSessionsPanels = new Map(state.sessionsPanels)
        newSessionsPanels.set(state.activeSessionId, newPanels)
        newState.sessionsPanels = newSessionsPanels

        const newSessionsLayouts = new Map(state.sessionsLayouts)
        newSessionsLayouts.set(state.activeSessionId, newLayout)
        newState.sessionsLayouts = newSessionsLayouts
      }

      return newState
    }),

    showConfirmModal: (title: string, message: string, onConfirm?: () => void, onCancel?: () => void) =>
      set({ confirmModal: { visible: true, title, message, onConfirm, onCancel } }),
    showAlertModal: (title: string, message: string) =>
      set({ confirmModal: { visible: true, title, message, showCancel: false } }),
    hideConfirmModal: () => {
      const state = get()
      const modal = state.confirmModal
      if (!modal) return
      modal.onCancel?.()
      set({ confirmModal: null })
    },
    showRenameModal: (sessionId: string, sessionName: string) =>
      set({ renameModal: { visible: true, sessionId, sessionName } }),
    hideRenameModal: () => set({ renameModal: null }),
    showPathSelectorModal: (onConfirm?: (path: string) => void, sessionId?: string) =>
      set({ pathSelectorModal: { visible: true, onConfirm, sessionId } }),
    hidePathSelectorModal: () => set({ pathSelectorModal: null }),
    showFileRenameModal: (filePath: string, panelId: string) => {
      const fileName = getBasename(filePath) || filePath
      set({ fileRenameModal: { visible: true, filePath, fileName, panelId } })
    },
    hideFileRenameModal: () => set({ fileRenameModal: null }),

    showApprovalModal: (command: string, description: string, sessionKey: string) =>
      set({ approvalModal: { visible: true, command, description, sessionKey } }),
    hideApprovalModal: () => set({ approvalModal: null }),

    showClarifyModal: (question: string, choices: string[] | null) =>
      set({ clarifyModal: { visible: true, question, choices } }),
    hideClarifyModal: () => set({ clarifyModal: null }),

    showToast: (message: string, duration = 2000) => {
      if (toastTimer) {
        clearTimeout(toastTimer)
        toastTimer = null
      }
      set({ toast: { message, visible: true } })
      toastTimer = setTimeout(() => {
        toastTimer = null
        set({ toast: null })
      }, duration)
    },
    hideToast: () => {
      if (toastTimer) {
        clearTimeout(toastTimer)
        toastTimer = null
      }
      set({ toast: null })
    },

    setBrowserSnapshot: (panelId: string, dataUrl: string | null) => set((state: AppState) => {
      const next = new Map(state.browserSnapshots)
      if (dataUrl) {
        next.set(panelId, dataUrl)
      } else {
        next.delete(panelId)
      }
      return { browserSnapshots: next }
    }),

    setTerminalSelection: (hasSelection: boolean) => set({ hasTerminalSelection: hasSelection }),

    setFileClipboard: (paths: string[] | null, mode: 'copy' | 'cut' = 'copy') => set({ fileClipboard: paths ? { paths, mode } : null }),

    setSelectedFilePaths: (panelId: string, paths: Set<string>) => set((state: AppState) => {
      const next = new Map(state.selectedFilePaths)
      next.set(panelId, paths)
      return { selectedFilePaths: next }
    }),

    // 文件附件
    addAttachedFile: (file: AttachedFile) => set((state: AppState) => ({
      attachedFiles: [...state.attachedFiles, file],
    })),
    removeAttachedFile: (id: string) => set((state: AppState) => ({
      attachedFiles: state.attachedFiles.filter(f => f.id !== id),
    })),
    clearAttachedFiles: () => set({ attachedFiles: [] }),
  }
}
