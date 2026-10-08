/** 应用面板后端接口（跨平台抽象）
 *
 * 一个"应用面板"= 一块虚拟显示器，在其中原生运行桌面程序。
 * 不同平台用不同后端实现同一接口：
 *   - Linux/X11：XephyrBackend（嵌套 X 服务器，原生渲染/输入，无串流）
 *   - Windows：Win32Backend（SetParent 窗口过继，原生渲染/输入；scale 走 DWM Thumbnail）
 *   - macOS：未来 CaptureBackend（ScreenCaptureKit 串流）或并排分屏
 *
 * IPC、preload、渲染组件与后端无关，三平台共用。
 */

import type { BrowserWindow } from 'electron'

/** 面板区域（宿主窗口客户区相对坐标） */
export interface PanelBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 面板运行状态（推送给渲染进程） */
export type AppPanelRunState = 'starting' | 'running' | 'exited' | 'error'

/** 要嵌入运行的桌面程序 */
export interface EmbeddedApp {
  /** 启动命令（如 dbeaver） */
  exec: string
  /** 展示名称 */
  name: string
  /** 图标 dataURL（可选，渲染端展示） */
  iconDataUrl?: string
}

/** 后端状态变化监听器 */
export type AppPanelStateListener = (
  panelId: string,
  state: AppPanelRunState,
  detail?: string,
) => void

/**
 * 应用面板后端接口
 */
export interface AppPanelBackend {
  /** 注入主窗口引用（后端据此获取宿主窗口句柄/尺寸，创建嵌入容器） */
  setMainWindow(window: BrowserWindow): void

  /** 当前环境是否支持 */
  isAvailable(): Promise<{ available: boolean; reason?: string }>

  /** 启动虚拟显示器并在其中运行程序（幂等） */
  launch(
    panelId: string,
    app: EmbeddedApp,
    bounds: PanelBounds,
  ): Promise<{ success: boolean; error?: string }>

  /** 同步面板几何（移动/缩放虚拟显示器输出） */
  setBounds(panelId: string, bounds: PanelBounds): void

  /** 显示/隐藏（会话切换、模态框遮挡时） */
  setVisible(panelId: string, visible: boolean): void

  /** 关闭面板：终止程序与虚拟显示器 */
  kill(panelId: string): Promise<void>

  /** 切换放大镜（scale 模式专属；不适用时返回 null）。
   * 返回三态数值：0=关 1=跟随 2=固定（与 daemon 协议一致） */
  toggleLoupe(panelId: string): Promise<number | null>

  /** 应用退出：关闭全部会话 */
  dispose(): void
}
