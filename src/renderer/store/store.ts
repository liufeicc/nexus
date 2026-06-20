/**
 * 渲染进程状态管理 - Zustand Store
 */

import { create } from 'zustand'
import type { AppState } from './types'
import { createSimpleActions } from './simple-actions'
import { createPanelLifecycleActions } from './panel-lifecycle'

/**
 * 创建 Zustand store
 */
export const useAppStore = create<AppState>((set, get) => {
  const actions = {
    ...createSimpleActions(set, get),
    ...createPanelLifecycleActions(set, get),
  }

  return {
    activeSessionId: null,
    sessionIds: [],
    panels: [],
    layout: null,
    activePanelId: null,
    sidebarWidth: 224,
    sidebarCollapsed: false,
    currentThemeId: 'light',
    agentEnabled: true,
    settingsModalVisible: false,
    aboutModalVisible: false,
    nexusProfileModal: { visible: false },
    sessionsPanels: new Map(),
    sessionsLayouts: new Map(),
    contextMenu: null,
    draggingPanelId: null,
    dropTargetPanelId: null,
    confirmModal: null,
    renameModal: null,
    pathSelectorModal: null,
    fileRenameModal: null,
    approvalModal: null,
    clarifyModal: null,
    toast: null,
    browserSnapshots: new Map<string, string>(),
    hasTerminalSelection: false,
    fileClipboard: null,
    selectedFilePaths: new Map(),
    attachedFiles: [],
    nexusBrowserPanelId: null,
    nexusDataPanelId: null,
    ...actions,
  } as AppState
})
