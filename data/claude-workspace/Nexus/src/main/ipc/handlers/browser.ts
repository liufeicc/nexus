/**
 * 浏览器管理 IPC 处理器
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { BrowserViewService } from '../../services/browser-view.service'

export function registerBrowserHandlers(getMainWindow: () => BrowserWindow | null): void {
  const service = () => BrowserViewService.getInstance()

  ipcMain.handle(IPC_CHANNELS.BROWSER_CREATE, (_, browserId: string) => {
    const win = getMainWindow()
    if (!win) throw new Error('主窗口未设置')
    service().createBrowserPanel(browserId, win)
  })

  ipcMain.handle(
    IPC_CHANNELS.BROWSER_CREATE_TAB,
    (_, browserId: string, tabId: string, bounds: { x: number; y: number; width: number; height: number }) => {
      service().createTab(browserId, tabId, bounds)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.BROWSER_REMOVE_TAB,
    (_, browserId: string, tabId: string) => {
      service().removeTab(browserId, tabId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.BROWSER_SET_ACTIVE_VIEW,
    (_, browserId: string, tabId: string) => {
      service().setActiveTab(browserId, tabId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.BROWSER_SET_BOUNDS,
    (_, browserId: string, tabId: string, bounds: { x: number; y: number; width: number; height: number }) => {
      service().setBounds(browserId, tabId, bounds)
    }
  )

  ipcMain.handle(IPC_CHANNELS.BROWSER_NAVIGATE, async (_, browserId: string, tabId: string, url: string) => {
    try {
      await service().navigate(browserId, tabId, url)
    } catch (error) {
      console.error('[IPC] 浏览器导航失败:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_GO_BACK, (_, browserId: string, tabId: string) => {
    service().goBack(browserId, tabId)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_GO_FORWARD, (_, browserId: string, tabId: string) => {
    service().goForward(browserId, tabId)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_RELOAD, (_, browserId: string, tabId: string) => {
    service().reload(browserId, tabId)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_STOP, (_, browserId: string, tabId: string) => {
    service().stop(browserId, tabId)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_URL, (_, browserId: string, tabId: string) => {
    return service().getUrl(browserId, tabId)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_TITLE, (_, browserId: string, tabId: string) => {
    return service().getTitle(browserId, tabId)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_CAN_GO_BACK, (_, browserId: string, tabId: string) => {
    return service().canGoBack(browserId, tabId)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_CAN_GO_FORWARD, (_, browserId: string, tabId: string) => {
    return service().canGoForward(browserId, tabId)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_DESTROY, (_, browserId: string) => {
    service().destroyBrowserPanel(browserId)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_CAPTURE_PAGE, async (_, browserId: string, tabId: string) => {
    return service().capturePage(browserId, tabId)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_LOCK_TAB, async (_, browserId: string, tabId: string) => {
    return service().lockTab(browserId, tabId)
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_UNLOCK_TAB, (_, browserId: string, tabId: string) => {
    service().unlockTab(browserId, tabId)
  })
}
