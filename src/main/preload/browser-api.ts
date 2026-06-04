/**
 * 浏览器控制 API
 * 提供 BrowserView 标签管理、导航、历史、书签及事件监听
 */

import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'

export const browser = {
  /** 创建浏览器面板实例（不含 View） */
  createBrowserView: (browserId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CREATE, browserId),
  /** 在面板中创建新标签 */
  createTab: (browserId: string, tabId: string, bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CREATE_TAB, browserId, tabId, bounds),
  /** 移除指定标签 */
  removeTab: (browserId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REMOVE_TAB, browserId, tabId),
  /** 切换活动标签 */
  setActiveView: (browserId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_SET_ACTIVE_VIEW, browserId, tabId),
  /** 设置 BrowserView 边界 */
  setBounds: (browserId: string, tabId: string, bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_SET_BOUNDS, browserId, tabId, bounds),
  navigate: (browserId: string, tabId: string, url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_NAVIGATE, browserId, tabId, url),
  goBack: (browserId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GO_BACK, browserId, tabId),
  goForward: (browserId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GO_FORWARD, browserId, tabId),
  reload: (browserId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_RELOAD, browserId, tabId),
  stop: (browserId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_STOP, browserId, tabId),
  getUrl: (browserId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_URL, browserId, tabId),
  getTitle: (browserId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_TITLE, browserId, tabId),
  canGoBack: (browserId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CAN_GO_BACK, browserId, tabId),
  canGoForward: (browserId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CAN_GO_FORWARD, browserId, tabId),
  destroy: (browserId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_DESTROY, browserId),
  /** 截取指定标签的快照 */
  capturePage: (browserId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CAPTURE_PAGE, browserId, tabId),
  /** 锁定标签：注入 CSS/JS 阻止用户交互（智能体操作不受影响） */
  lockTab: (browserId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_LOCK_TAB, browserId, tabId),
  /** 解锁标签：移除注入的 CSS/JS 恢复用户交互 */
  unlockTab: (browserId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_UNLOCK_TAB, browserId, tabId),
  /** 浏览器历史管理 */
  history: {
    save: (url: string, title?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_HISTORY_SAVE, url, title),
    list: (limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_HISTORY_LIST, limit),
    delete: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_HISTORY_DELETE, id),
    clear: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_HISTORY_CLEAR),
  },
  /** 浏览器书签管理 */
  bookmark: {
    add: (url: string, title?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_BOOKMARK_ADD, url, title),
    list: () =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_BOOKMARK_LIST),
    delete: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_BOOKMARK_DELETE, id),
    reorder: (bookmarks: { id: string; sortOrder: number }[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_BOOKMARK_REORDER, bookmarks),
  },
  onNavigating: (callback: (data: { browserId: string; tabId: string; url: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; tabId: string; url: string }) =>
      callback(data)
    ipcRenderer.on(IPC_CHANNELS.BROWSER_NAVIGATING, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_NAVIGATING, listener)
  },
  onDidNavigate: (callback: (data: { browserId: string; tabId: string; url: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; tabId: string; url: string }) =>
      callback(data)
    ipcRenderer.on(IPC_CHANNELS.BROWSER_DID_NAVIGATE, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_DID_NAVIGATE, listener)
  },
  onDidNavigateInPage: (callback: (data: { browserId: string; tabId: string; url: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; tabId: string; url: string }) =>
      callback(data)
    ipcRenderer.on(IPC_CHANNELS.BROWSER_DID_NAVIGATE_IN_PAGE, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_DID_NAVIGATE_IN_PAGE, listener)
  },
  onPageTitleUpdated: (callback: (data: { browserId: string; tabId: string; title: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; tabId: string; title: string }) =>
      callback(data)
    ipcRenderer.on(IPC_CHANNELS.BROWSER_PAGE_TITLE_UPDATED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_PAGE_TITLE_UPDATED, listener)
  },
  onPageFaviconUpdated: (callback: (data: { browserId: string; tabId: string; favicons: string[] }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; tabId: string; favicons: string[] }) =>
      callback(data)
    ipcRenderer.on(IPC_CHANNELS.BROWSER_PAGE_FAVICON_UPDATED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_PAGE_FAVICON_UPDATED, listener)
  },
  onWindowOpen: (callback: (data: { browserId: string; sourceTabId: string; newTabId: string; url: string; name: string; disposition: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; sourceTabId: string; newTabId: string; url: string; name: string; disposition: string }) =>
      callback(data)
    ipcRenderer.on(IPC_CHANNELS.BROWSER_WINDOW_OPEN, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_WINDOW_OPEN, listener)
  },
  /** 监听 BrowserView 右键菜单事件（转发坐标给渲染进程） */
  onContextMenu: (callback: (data: { browserId: string; tabId: string; x: number; y: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; tabId: string; x: number; y: number }) =>
      callback(data)
    ipcRenderer.on(IPC_CHANNELS.BROWSER_CONTEXT_MENU, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_CONTEXT_MENU, listener)
  },
}
