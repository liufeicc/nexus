/**
 * 应用面板 API（虚拟显示器嵌入，技术验证版）
 * 提供启动/几何同步/显隐/关闭，以及状态变化监听
 */

import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'

/** 面板区域（Electron 窗口客户区相对坐标） */
export interface PanelBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 面板运行状态 */
export type AppPanelRunState = 'starting' | 'running' | 'exited' | 'error'

export const appPanel = {
  /** 查询当前环境是否支持应用面板 */
  supported: (): Promise<{ available: boolean; reason?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_PANEL_SUPPORTED),

  /** 列出已安装的桌面程序（.desktop 扫描结果） */
  listApps: (): Promise<{ apps: Array<{ appId: string; name: string; exec: string; icon?: string }> }> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_PANEL_LIST_APPS),

  /** 按 appId 懒加载图标 dataURL */
  getIcon: (appId: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_PANEL_GET_ICON, appId),

  /** 启动虚拟显示器并在其中运行指定程序 */
  launch: (
    panelId: string,
    app: { exec: string; name: string },
    bounds: PanelBounds,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_PANEL_LAUNCH, panelId, app, bounds),

  /** 同步面板几何（移动/缩放嵌入窗口） */
  setBounds: (panelId: string, bounds: PanelBounds): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_PANEL_SET_BOUNDS, panelId, bounds),

  /** 显示/隐藏嵌入窗口（会话切换、模态框遮挡时） */
  setVisible: (panelId: string, visible: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_PANEL_SET_VISIBLE, panelId, visible),

  /** 关闭面板：终止程序与虚拟显示器 */
  kill: (panelId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_PANEL_KILL, panelId),

  /** 切换放大镜（与面板内中键等效；仅缩放模式有效）。
   * 返回切换后三态：0=关 1=跟随 2=固定；直嵌模式/无会话返回 null */
  toggleLoupe: (panelId: string): Promise<number | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_PANEL_TOGGLE_LOUPE, panelId),

  /** 监听面板状态变化（程序退出、启动失败等） */
  onStateChanged: (
    callback: (data: { panelId: string; state: AppPanelRunState; detail?: string }) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { panelId: string; state: AppPanelRunState; detail?: string },
    ) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.APP_PANEL_STATE_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.APP_PANEL_STATE_CHANGED, listener)
  },
}
