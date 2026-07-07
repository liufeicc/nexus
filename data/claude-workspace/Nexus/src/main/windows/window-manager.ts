/**
 * 窗口管理器
 * 负责创建和管理应用窗口
 */

import { BrowserWindow, shell, app } from 'electron'
import path from 'path'
import * as fs from 'fs'

export class WindowManager {
  private mainWindow: BrowserWindow | null = null

  /**
   * 获取应用图标路径
   */
  private getAppIconPath(): string | undefined {
    // 开发环境：直接使用 resources 目录下的图标
    const resourcesPath = path.join(__dirname, '../../../resources')
    if (process.platform === 'win32') {
      return path.join(resourcesPath, 'icon.ico')
    }
    // Linux 和 macOS 使用 PNG/ICNS 图标
    const pngPath = path.join(resourcesPath, 'icon.png')
    if (fs.existsSync(pngPath)) {
      return pngPath
    }
    // 如果打包后 resources 不在预期位置，尝试从 process.resourcesPath 获取
    const packedPath = path.join(process.resourcesPath, 'resources', 'icon.png')
    if (fs.existsSync(packedPath)) {
      return packedPath
    }
    return undefined
  }

  /**
   * 创建主窗口
   */
  async createMainWindow(): Promise<BrowserWindow> {
    const icon = this.getAppIconPath()
    const window = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      title: 'Nexus Workbench',
      // macOS: 保留原生 traffic lights，隐藏标题栏
      // Windows/Linux: 完全无边框，使用自定义标题栏
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hidden' as const }
        : { frame: false }),
      backgroundColor: '#f5f5f5',
      icon, // 窗口图标（影响任务栏和 Alt+Tab 显示）
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
      },
    })

    // 保存窗口引用
    this.mainWindow = window

    // 加载应用
    if (process.env.VITE_DEV_SERVER_URL) {
      window.loadURL(process.env.VITE_DEV_SERVER_URL)
      // 开发模式打开 DevTools
      window.webContents.openDevTools()
    } else {
      window.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    // 配置外部链接处理
    window.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    return window
  }

  /**
   * 获取主窗口
   */
  getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  /**
   * 关闭主窗口
   */
  closeMainWindow(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.close()
      this.mainWindow = null
    }
  }
}
