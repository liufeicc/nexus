/**
 * 应用面板 IPC 处理器（跨平台：linux=Xephyr 虚拟显示器，win32=SetParent 过继）
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { AppPanelService } from '../../services/app-panel/app-panel.service'
import type { PanelBounds, EmbeddedApp } from '../../services/app-panel/backend'
import { listInstalledApps, getAppIconDataUrl } from '../../services/app-panel/app-catalog'

export function registerAppPanelHandlers(): void {
  const svc = () => AppPanelService.getInstance()

  ipcMain.handle(IPC_CHANNELS.APP_PANEL_SUPPORTED, () => {
    return svc().supported()
  })

  // 应用列表/图标经平台路由层（linux→.desktop 扫描，win32→开始菜单 .lnk）
  ipcMain.handle(IPC_CHANNELS.APP_PANEL_LIST_APPS, async () => {
    return { apps: await listInstalledApps() }
  })

  ipcMain.handle(IPC_CHANNELS.APP_PANEL_GET_ICON, (_event, appId: string) => {
    return getAppIconDataUrl(appId)
  })

  ipcMain.handle(
    IPC_CHANNELS.APP_PANEL_LAUNCH,
    (_event, panelId: string, app: EmbeddedApp, bounds: PanelBounds) => {
      return svc().launch(panelId, app, bounds)
    },
  )

  ipcMain.handle(IPC_CHANNELS.APP_PANEL_SET_BOUNDS, (_event, panelId: string, bounds: PanelBounds) => {
    svc().setBounds(panelId, bounds)
  })

  ipcMain.handle(IPC_CHANNELS.APP_PANEL_SET_VISIBLE, (_event, panelId: string, visible: boolean) => {
    svc().setVisible(panelId, visible)
  })

  ipcMain.handle(IPC_CHANNELS.APP_PANEL_KILL, (_event, panelId: string) => {
    return svc().kill(panelId)
  })

  ipcMain.handle(IPC_CHANNELS.APP_PANEL_TOGGLE_LOUPE, (_event, panelId: string) => {
    return svc().toggleLoupe(panelId)
  })
}
