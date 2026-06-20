/**
 * 渲染进程状态管理 - 面板生命周期 Actions
 *
 * 包含 PTY、文件面板、浏览器面板的生命周期管理函数。
 * 通过工厂函数接收 (set, get)，避免循环依赖。
 */

import type { LayoutTree, BrowserTab } from '@core/types'
import { generatePanelId } from '@core/utils/panel-id'
import { cleanupLayoutFlexValues } from './layout-ops'
import type { AppState, PanelState, OpenFileEntry, PanelType, BrowserPanel, TerminalPanel, FileBrowserPanel } from './types'
import { t } from '../i18n'
import { getBasename } from '../../core/utils/path-utils'

// 面板标题辅助函数（非 React 环境）
function panelTitle(key: string, value?: string): string {
  const translated = t(`panel.${key}`)
  if (value !== undefined) {
    return `${translated} - ${value}`
  }
  return translated
}

/**
 * Zustand set/get 类型
 */
type SetFn = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>), replace?: boolean) => void
type GetFn = () => AppState

/**
 * 同步更新指定面板在 panels 和 sessionsPanels 缓存中的数据
 * 返回 { panels, sessionsPanels } 供 set() 回调直接返回
 */
function syncPanelToSessionsPanels(
  state: AppState,
  panelId: string,
  panelUpdater: (panel: PanelState) => PanelState,
): { panels: PanelState[]; sessionsPanels: Map<string, PanelState[]> } {
  const newPanels = state.panels.map(p => p.id === panelId ? panelUpdater(p) : p)

  const activeSessionId = state.activeSessionId
  const newSessionsPanels = new Map(state.sessionsPanels)
  if (activeSessionId !== null && state.sessionsPanels.has(activeSessionId)) {
    const cachedPanels = state.sessionsPanels.get(activeSessionId)!
    const newCachedPanels = cachedPanels.map(p => p.id === panelId ? panelUpdater(p) : p)
    newSessionsPanels.set(activeSessionId, newCachedPanels)
  }

  return { panels: newPanels, sessionsPanels: newSessionsPanels }
}

/**
 * 面板创建后的布局初始化和快照保存
 */
async function finalizePanelCreation(
  panelId: string,
  get: GetFn,
): Promise<void> {
  const state2 = get()
  if (state2.panels.length === 1 && !state2.layout) {
    const newLayout: LayoutTree = {
      type: 'horizontal',
      children: [{ type: 'panel', id: panelId }],
    }
    get().setLayout(newLayout)

    if (state2.activeSessionId !== null) {
      await get().saveSnapshot(state2.activeSessionId, newLayout, panelId)
    }
  } else {
    if (state2.activeSessionId !== null) {
      await get().saveSnapshot(state2.activeSessionId)
    }
  }
}

/**
 * 解析浏览器面板 URL：优先使用传入值，否则读取配置，失败回退 about:blank
 */
async function resolveBrowserUrl(url?: string): Promise<string> {
  if (url && url.trim() !== '') return url.trim()
  try {
    const defaultUrl = await window.electronAPI.config.get('browserDefaultUrl')
    if (defaultUrl && typeof defaultUrl === 'string' && defaultUrl.trim()) {
      return defaultUrl.trim()
    }
  } catch { /* ignore */ }
  return 'about:blank'
}

/**
 * PTY 创建参数构造辅助函数
 */
function makePtyCreateParams(cwd: string) {
  return {
    cwd,
    shell: window.electronAPI.platform.isWindows ? 'powershell.exe' : undefined,
  }
}

/**
 * 创建面板生命周期 actions
 */
export function createPanelLifecycleActions(set: SetFn, get: GetFn): Partial<AppState> {
  return {
    // ===== PTY 生命周期动作 =====

    createPanel: async (cwd: string) => {
      const state = get()
      const panelId = generatePanelId()
      const ptyId = await window.electronAPI.pty.create({
        ...makePtyCreateParams(cwd),
        panelId,
        sessionId: state.activeSessionId ?? '',
      })
      const panel: PanelState = {
        id: panelId,
        panelType: 'terminal',
        ptyId,
        cwd,
        title: panelTitle('terminal', getBasename(cwd)),
      }
      get().addPanel(panel)
      await finalizePanelCreation(panelId, get)
      return panelId
    },

    splitPanelWithPty: async (panelId: string, direction: 'horizontal' | 'vertical', cwd: string) => {
      const state = get()
      const newPanelId = `panel-${Date.now()}`
      const ptyId = await window.electronAPI.pty.create({
        ...makePtyCreateParams(cwd),
        panelId: newPanelId,
        sessionId: state.activeSessionId ?? '',
      })
      const newPanel: PanelState = {
        id: newPanelId,
        panelType: 'terminal',
        ptyId,
        cwd,
        title: panelTitle('terminal', getBasename(cwd)),
      }
      get().splitPanel(panelId, direction, newPanel)

      const state2 = get()
      if (state2.activeSessionId !== null) {
        await get().saveSnapshot(state2.activeSessionId, undefined, newPanelId)
      }

      return newPanelId
    },

    closePanel: async (panelId: string) => {
      const state = get()
      const panel = state.panels.find((p) => p.id === panelId)
      if (!panel) return

      if (panel.panelType === 'terminal' && panel.ptyId) {
        await window.electronAPI.pty.kill(panel.ptyId)
      }
      get().removePanel(panelId)
      if (state.activeSessionId !== null) {
        await get().saveSnapshot(state.activeSessionId)
      }
    },

    restorePanelsFromData: async (
      panelStates: Array<{
        panelId: string; cwd?: string; title: string; panelType?: string;
        rootPath?: string; currentPath?: string; viewMode?: 'grid' | 'list';
        url?: string; browserTabs?: BrowserTab[]; activeTabId?: string;
      }>,
      layout: LayoutTree | null = null
    ) => {
      const newPanels: PanelState[] = []
      for (const ps of panelStates) {
        if (ps.panelType === 'file-browser') {
          newPanels.push({
            id: ps.panelId,
            panelType: 'file-browser',
            title: ps.title || panelTitle('fileBrowser', ps.rootPath || ps.cwd || ''),
            rootPath: ps.rootPath || ps.cwd,
            currentPath: ps.currentPath || ps.rootPath || ps.cwd,
            viewMode: ps.viewMode || 'grid',
          })
          continue
        }

        if (ps.panelType === 'browser') {
          const browserTabs = ps.browserTabs
            ? new Map(ps.browserTabs.map(t => [t.id, t]))
            : new Map()

          if (browserTabs.size === 0) {
            const defaultTabId = `tab-${Date.now()}-init`
            const defaultUrl = ps.url || 'about:blank'
            browserTabs.set(defaultTabId, {
              id: defaultTabId,
              url: defaultUrl,
              title: t('panel.newTab'),
              isLoading: false,
            })
            newPanels.push({
              id: ps.panelId,
              panelType: 'browser',
              title: ps.title || t('panel.browser'),
              browserTabs,
              activeTabId: defaultTabId,
            })
          } else {
            newPanels.push({
              id: ps.panelId,
              panelType: 'browser',
              title: ps.title || t('panel.browser'),
              browserTabs,
              activeTabId: ps.activeTabId || Array.from(browserTabs.keys())[0],
            })
          }
          continue
        }

        try {
          const ptyId = await window.electronAPI.pty.create({
            ...makePtyCreateParams(ps.cwd || ''),
            panelId: ps.panelId,
            sessionId: String(get().activeSessionId ?? ''),
          })
          newPanels.push({
            id: ps.panelId,
            panelType: 'terminal',
            ptyId,
            cwd: ps.cwd,
            title: ps.title || `${t('panel.terminal')} - ${ps.cwd}`,
          } as PanelState)
        } catch (error) {
          console.error(`[restorePanelsFromData] 重建面板的 PTY 失败:`, error)
        }
      }

      get().setPanelsFromSnapshot(newPanels, layout)
      window.dispatchEvent(new CustomEvent('panels-change'))
    },

    // ===== 文件面板生命周期 =====

    createFilePanel: async (rootPath: string) => {
      const state = get()
      const panelId = generatePanelId()

      const existingPanels = get().panels
      const existingFilePanel = existingPanels.find((p) => p.panelType === 'file-browser')
      const currentPath = existingFilePanel?.currentPath || rootPath

      const panel: PanelState = {
        id: panelId,
        panelType: 'file-browser',
        title: panelTitle('fileBrowser', rootPath),
        rootPath,
        currentPath,
        viewMode: 'grid',
      }
      get().addPanel(panel)
      await finalizePanelCreation(panelId, get)

      return panelId
    },

    splitPanelWithFilePanel: async (panelId: string, direction: 'horizontal' | 'vertical', rootPath: string) => {
      const state = get()
      const newPanelId = `panel-${Date.now()}`

      const existingPanels = get().panels
      const existingFilePanel = existingPanels.find((p) => p.panelType === 'file-browser')
      const currentPath = existingFilePanel?.currentPath || rootPath

      const newPanel: PanelState = {
        id: newPanelId,
        panelType: 'file-browser',
        title: panelTitle('fileBrowser', rootPath),
        rootPath,
        currentPath,
        viewMode: 'grid',
      }
      get().splitPanel(panelId, direction, newPanel)

      const state2 = get()
      if (state2.activeSessionId !== null) {
        await get().saveSnapshot(state2.activeSessionId, undefined, newPanelId)
      }

      return newPanelId
    },

    updatePanelFileState: (panelId: string, updates: { openFiles?: OpenFileEntry[]; activeFile?: string | null }) => set((state: AppState) => {
      const panel = state.panels.find(p => p.id === panelId)
      if (!panel) return state

      const newPanel: PanelState = {
        ...panel,
        ...(updates.openFiles !== undefined && { openFiles: updates.openFiles }),
        ...(updates.activeFile !== undefined && { activeFile: updates.activeFile }),
      }

      return syncPanelToSessionsPanels(state, panelId, () => newPanel)
    }),

    updatePanelViewMode: (panelId: string, viewMode: 'grid' | 'list') => set((state: AppState) => {
      const panel = state.panels.find(p => p.id === panelId)
      if (!panel) return state

      return syncPanelToSessionsPanels(state, panelId, p => ({ ...p, viewMode }))
    }),

    updatePanelCurrentPath: (panelId: string, currentPath: string) => set((state: AppState) => {
      const panel = state.panels.find(p => p.id === panelId)
      if (!panel) return state

      return syncPanelToSessionsPanels(state, panelId, p => ({ ...p, currentPath }))
    }),

    updatePanelCwd: (panelId: string, cwd: string) => set((state: AppState) => {
      const panel = state.panels.find(p => p.id === panelId)
      if (!panel) return state

      const result = syncPanelToSessionsPanels(state, panelId, p => ({ ...p, cwd }))
      // 触发自定义事件通知渲染进程 cwd 变化
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('panel-cwd-change', { detail: { panelId, cwd } }))
      })
      return result
    }),

    // ===== 浏览器面板生命周期 =====

    createBrowserPanel: async (url?: string) => {
      const state = get()
      const resolvedUrl = await resolveBrowserUrl(url)

      const panelId = generatePanelId()
      const initialTabId = `tab-${Date.now()}-init`
      const initialTab: BrowserTab = {
        id: initialTabId,
        url: resolvedUrl,
        title: t('panel.newTab'),
        isLoading: false,
      }

      const panel: PanelState = {
        id: panelId,
        panelType: 'browser',
        title: t('panel.browser'),
        browserTabs: new Map([[initialTabId, initialTab]]),
        activeTabId: initialTabId,
      }
      get().addPanel(panel)
      await finalizePanelCreation(panelId, get)

      return panelId
    },

    splitPanelWithBrowserPanel: async (panelId: string, direction: 'horizontal' | 'vertical', url?: string) => {
      const state = get()
      const resolvedUrl = await resolveBrowserUrl(url)

      const newPanelId = `panel-${Date.now()}`
      const initialTabId = `tab-${Date.now()}-init`
      const initialTab: BrowserTab = {
        id: initialTabId,
        url: resolvedUrl,
        title: t('panel.newTab'),
        isLoading: false,
      }

      const newPanel: PanelState = {
        id: newPanelId,
        panelType: 'browser',
        title: t('panel.browser'),
        browserTabs: new Map([[initialTabId, initialTab]]),
        activeTabId: initialTabId,
      }
      get().splitPanel(panelId, direction, newPanel)

      const state2 = get()
      if (state2.activeSessionId !== null) {
        await get().saveSnapshot(state2.activeSessionId, undefined, newPanelId)
      }

      return newPanelId
    },

    addBrowserTab: (panelId: string, url?: string) => {
      const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      set((state: AppState) => {
        const panel = state.panels.find(p => p.id === panelId) as BrowserPanel | undefined
        if (!panel) return state

        const existingTabs = panel.browserTabs || new Map()
        const resolvedUrl = url || 'about:blank'

        const newTab: BrowserTab = {
          id: tabId,
          url: resolvedUrl,
          title: t('panel.newTab'),
          isLoading: false,
        }

        const newTabs = new Map(existingTabs)
        newTabs.set(tabId, newTab)

        return syncPanelToSessionsPanels(state, panelId, p => ({
          ...p,
          browserTabs: newTabs,
          activeTabId: panel.activeTabId || tabId,
        }))
      })
      return tabId
    },

    registerBrowserTab: (panelId: string, tabId: string, url: string) => set((state: AppState) => {
      const panel = state.panels.find(p => p.id === panelId) as BrowserPanel | undefined
      if (!panel) return state

      const existingTabs = panel.browserTabs || new Map()

      if (existingTabs.has(tabId)) return state

      const newTab: BrowserTab = {
        id: tabId,
        url,
        title: t('panel.newTab'),
        isLoading: true,
      }

      const newTabs = new Map(existingTabs)
      newTabs.set(tabId, newTab)

      return syncPanelToSessionsPanels(state, panelId, p => ({
        ...p,
        browserTabs: newTabs,
        activeTabId: panel.activeTabId || tabId,
      }))
    }),

    closeBrowserTab: (panelId: string, tabId: string) => set((state: AppState) => {
      const panel = state.panels.find(p => p.id === panelId) as BrowserPanel | undefined
      if (!panel) return state

      const existingTabs = panel.browserTabs || new Map()
      if (!existingTabs.has(tabId)) return state

      const tabKeys = Array.from(existingTabs.keys())
      const closedIdx = tabKeys.indexOf(tabId)

      const newTabs = new Map(existingTabs)
      newTabs.delete(tabId)

      let newActiveTabId = panel.activeTabId
      if (panel.activeTabId === tabId) {
        const nextIdx = closedIdx + 1 < tabKeys.length ? closedIdx + 1 : closedIdx - 1
        newActiveTabId = tabKeys[nextIdx] || null
      }

      return syncPanelToSessionsPanels(state, panelId, p => ({
        ...p,
        browserTabs: newTabs,
        activeTabId: newActiveTabId,
      }))
    }),

    switchBrowserTab: (panelId: string, tabId: string) => set((state: AppState) => {
      const panel = state.panels.find(p => p.id === panelId) as BrowserPanel | undefined
      if (!panel) return state

      if (!panel.browserTabs?.has(tabId)) return state

      return syncPanelToSessionsPanels(state, panelId, p => ({ ...p, activeTabId: tabId }))
    }),

    updateTabState: (panelId: string, tabId: string, patch: Partial<BrowserTab>) => set((state: AppState) => {
      const panel = state.panels.find(p => p.id === panelId) as BrowserPanel | undefined
      if (!panel) return state

      const tab = panel.browserTabs?.get(tabId)
      if (!tab) return state

      const newTabs = new Map(panel.browserTabs)
      newTabs.set(tabId, { ...tab, ...patch })

      return syncPanelToSessionsPanels(state, panelId, p => ({ ...p, browserTabs: newTabs }))
    }),

    replacePanelInPlace: (panelId: string, updates: {
      panelType: PanelType
      title: string
      ptyId?: string
      cwd?: string
      rootPath?: string
      currentPath?: string
      viewMode?: 'grid' | 'list'
      openFiles?: OpenFileEntry[]
      activeFile?: string | null
      browserTabs?: Map<string, BrowserTab>
      activeTabId?: string | null
    }) => set((state: AppState) => {
      const panel = state.panels.find(p => p.id === panelId)
      if (!panel) return state

      const newPanel: PanelState = {
        id: panelId,
        panelType: updates.panelType,
        title: updates.title,
        ...(updates.panelType === 'terminal' && { ptyId: updates.ptyId, cwd: updates.cwd }),
        ...(updates.panelType === 'file-browser' && { rootPath: updates.rootPath, currentPath: updates.currentPath, viewMode: updates.viewMode || 'grid', openFiles: updates.openFiles, activeFile: updates.activeFile }),
        ...(updates.panelType === 'browser' && { browserTabs: updates.browserTabs, activeTabId: updates.activeTabId }),
      } as PanelState

      return syncPanelToSessionsPanels(state, panelId, () => newPanel)
    }),

    saveSnapshot: async (sessionId: string, customLayout?: LayoutTree | null, customActivePanelId?: string | null) => {
      const state = get()
      const layoutToSave = customLayout ?? state.layout
      const activePanelIdToSave = customActivePanelId || state.activePanelId
      const cleanedLayout = state.layout
        ? cleanupLayoutFlexValues(state.layout)
        : layoutToSave
      // cleanupLayoutFlexValues 可能返回 PanelNode，只有容器节点才保存到快照
      const layoutDataToSave = cleanedLayout && cleanedLayout.type !== 'panel'
        ? cleanedLayout as LayoutTree | null
        : null

      await window.electronAPI.snapshot.save(sessionId, {
        layoutData: layoutDataToSave,
        activePanelId: activePanelIdToSave || undefined,
        panelStates: state.panels.map((p) => ({
          panelId: p.id,
          panelType: p.panelType || 'terminal',
          ...(p.panelType === 'terminal' && { ptyId: (p as TerminalPanel).ptyId, cwd: (p as TerminalPanel).cwd }),
          ...(p.panelType === 'file-browser' && { rootPath: (p as FileBrowserPanel).rootPath, currentPath: (p as FileBrowserPanel).currentPath, viewMode: (p as FileBrowserPanel).viewMode }),
          ...(p.panelType === 'browser' && { browserTabs: (p as BrowserPanel).browserTabs ? Array.from((p as BrowserPanel).browserTabs.values()) : undefined, activeTabId: (p as BrowserPanel).activeTabId }),
          title: p.title,
        })),
      })

      window.dispatchEvent(new CustomEvent('panels-change'))
    },

    // ===== Nexus 连接管理 =====

    setNexusBrowserPanelId: (panelId: string | null) => set((state: AppState) => {
      const oldPanelId = state.nexusBrowserPanelId
      const newPanels = state.panels.map(p => ({
        ...p,
        nexusConnected: p.id === panelId ? true : (p.id === oldPanelId ? false : p.nexusConnected),
      }))
      return { nexusBrowserPanelId: panelId, panels: newPanels }
    }),

    setNexusDataPanelId: (panelId: string | null) => set((state: AppState) => {
      const oldPanelId = state.nexusDataPanelId
      const newPanels = state.panels.map(p => ({
        ...p,
        nexusConnected: p.id === panelId ? true : (p.id === oldPanelId ? false : p.nexusConnected),
      }))
      return { nexusDataPanelId: panelId, panels: newPanels }
    }),

    // ===== 智能体文件联动 =====

    /**
     * 智能体调用文件工具时，在文件面板中打开对应文件预览
     * @param filePath - 文件完整路径
     * @param fileName - 文件名
     * @param action - 'create' 新建 | 'edit' 编辑
     */
    agentOpenFileInFilePanel: (filePath: string, fileName: string, action: 'create' | 'edit') => set((state: AppState) => {
      // 查找第一个 file-browser 类型的面板
      const filePanelIndex = state.panels.findIndex(p => p.panelType === 'file-browser')
      if (filePanelIndex === -1) {
        return state
      }

      const panel = state.panels[filePanelIndex] as FileBrowserPanel
      const existingOpenFiles = panel.openFiles || []
      const alreadyOpen = existingOpenFiles.some((f: OpenFileEntry) => f.path === filePath)

      let newOpenFiles = existingOpenFiles
      if (!alreadyOpen) {
        // 文件未打开，添加到打开列表
        const newEntry: OpenFileEntry = { path: filePath, name: fileName }
        newOpenFiles = [...existingOpenFiles, newEntry]
      }

      // 更新智能体活跃文件追踪
      const currentAgentFiles = panel.agentActiveFiles || []
      const newAgentFiles = currentAgentFiles.includes(filePath)
        ? currentAgentFiles
        : [...currentAgentFiles, filePath]

      // 将文件面板导航到文件所在目录
      const fileDir = filePath.substring(0, filePath.lastIndexOf('/'))
      const newCurrentPath = fileDir || panel.currentPath || panel.rootPath

      const newPanels = [...state.panels]
      newPanels[filePanelIndex] = {
        ...panel,
        openFiles: newOpenFiles,
        activeFile: filePath,
        agentActiveFiles: newAgentFiles,
        agentRunning: true,
        currentPath: newCurrentPath,
      }

      // 同步更新 sessionsPanels 缓存
      const activeSessionId = state.activeSessionId
      const newSessionsPanels = new Map(state.sessionsPanels)
      if (activeSessionId !== null && state.sessionsPanels.has(activeSessionId)) {
        const cachedPanels = state.sessionsPanels.get(activeSessionId)!
        const newCachedPanels = cachedPanels.map((p) => {
          if (p.id === panel.id) {
            return {
              ...p,
              openFiles: newOpenFiles,
              activeFile: filePath,
              agentActiveFiles: newAgentFiles,
              agentRunning: true,
              currentPath: newCurrentPath,
            }
          }
          return p
        })
        newSessionsPanels.set(activeSessionId, newCachedPanels)
      }

      return { panels: newPanels, sessionsPanels: newSessionsPanels }
    }),

    /**
     * 清除所有文件面板的智能体活动标记
     * 当智能体状态变为非 running 时调用
     */
    agentClearFileActivity: () => set((state: AppState) => {
      const newPanels = state.panels.map(p => {
        if (p.panelType === 'file-browser' && (p.agentRunning || (p.agentActiveFiles && p.agentActiveFiles.length > 0))) {
          return { ...p, agentActiveFiles: [], agentRunning: false }
        }
        return p
      })

      // 同步更新 sessionsPanels 缓存
      const activeSessionId = state.activeSessionId
      const newSessionsPanels = new Map(state.sessionsPanels)
      if (activeSessionId !== null && state.sessionsPanels.has(activeSessionId)) {
        const cachedPanels = state.sessionsPanels.get(activeSessionId)!
        const newCachedPanels = cachedPanels.map((p) => {
          if (p.panelType === 'file-browser') {
            return { ...p, agentActiveFiles: [], agentRunning: false }
          }
          return p
        })
        newSessionsPanels.set(activeSessionId, newCachedPanels)
      }

      return { panels: newPanels, sessionsPanels: newSessionsPanels }
    }),
  }
}
