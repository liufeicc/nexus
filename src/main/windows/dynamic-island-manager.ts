/**
 * 灵动岛窗口管理器
 *
 * 负责创建和管理灵动岛浮动窗口
 * - 作为主窗口的子窗口，跟随主窗口的 z-order 层级
 * - 可点击和拖动
 * - 主窗口关闭时自动关闭
 */

import { BrowserWindow, app, ipcMain } from 'electron'
import path from 'path'

export class DynamicIslandManager {
  private dynamicIslandWindow: BrowserWindow | null = null
  private mainWinRef: BrowserWindow | null = null

  /**
   * 创建灵动岛浮动窗口
   * @param mainWin - 主窗口引用，用于监听关闭事件
   */
  createDynamicIslandWindow(mainWin: BrowserWindow): BrowserWindow {
    // 如果已存在，先销毁
    if (this.dynamicIslandWindow && !this.dynamicIslandWindow.isDestroyed()) {
      this.destroyDynamicIslandWindow()
    }

    this.mainWinRef = mainWin

    const window = new BrowserWindow({
      width: 800,
      height: 36,
      minWidth: 300,
      minHeight: 30,
      useContentSize: true, // 窗口大小包含内容区域（排除系统装饰）
      type: 'toolbar', // 工具栏窗口，在 Linux 上通常无标题栏
      frame: false,
      transparent: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      hasShadow: true,
      roundedCorners: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(app.getAppPath(), 'dist/preload.js'),
      },
    })

    // 加载页面 - 使用独立的入口文件，不加载 globals.css
    if (process.env.VITE_DEV_SERVER_URL) {
      window.loadURL(`${process.env.VITE_DEV_SERVER_URL}dynamic-island.html`)
    } else {
      // 使用 app.getAppPath() 获取应用根目录，兼容 asar 打包
      const appPath = app.getAppPath()
      const filePath = path.join(appPath, 'dist/renderer/dynamic-island.html')
      console.log('[DynamicIsland] Loading file:', filePath, 'exists:', require('fs').existsSync(filePath))
      window.loadFile(filePath)
    }

    // 监听加载失败
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      console.error('[DynamicIsland] Failed to load:', { errorCode, errorDescription, validatedURL })
    })

    this.dynamicIslandWindow = window

    // 设置父窗口，使灵动岛跟随主窗口的 z-order 层级
    window.setParentWindow(mainWin)

    // 设置窗口位置：屏幕顶部靠下 8px（紧贴标题栏下方）
    const primaryDisplay = require('electron').screen.getPrimaryDisplay()
    const { width: screenWidth } = primaryDisplay.workAreaSize
    window.setPosition(Math.round((screenWidth - 800) / 2), 8, false)

    // 监听主窗口关闭，自动关闭灵动岛
    mainWin.on('closed', () => {
      this.destroyDynamicIslandWindow()
    })

    // 监听主窗口最小化，自动隐藏灵动岛
    mainWin.on('minimize', () => {
      if (this.dynamicIslandWindow && !this.dynamicIslandWindow.isDestroyed()) {
        this.dynamicIslandWindow.hide()
      }
    })

    // 监听主窗口还原，自动显示灵动岛
    mainWin.on('restore', () => {
      if (this.dynamicIslandWindow && !this.dynamicIslandWindow.isDestroyed()) {
        this.dynamicIslandWindow.show()
      }
    })

    // 监听主窗口移动和调整大小，自动调整灵动岛相对位置
    const syncIslandPosition = () => {
      if (!this.dynamicIslandWindow || this.dynamicIslandWindow.isDestroyed()) return
      if (mainWin.isDestroyed()) return

      const mainBounds = mainWin.getBounds()
      const islandBounds = this.dynamicIslandWindow.getBounds()
      const islandWidth = islandBounds.width

      // 保持灵动岛在主窗口顶部居中，距顶部 8px
      const x = Math.round(mainBounds.x + (mainBounds.width - islandWidth) / 2)
      const y = mainBounds.y + 8

      this.dynamicIslandWindow.setPosition(x, y, false)
    }

    mainWin.on('move', syncIslandPosition)
    mainWin.on('resize', syncIslandPosition)

    // 窗口加载完成

    return window
  }

  /**
   * 获取灵动岛窗口
   */
  getWindow(): BrowserWindow | null {
    return this.dynamicIslandWindow
  }

  /**
   * 销毁灵动岛窗口
   */
  destroyDynamicIslandWindow(): void {
    if (this.dynamicIslandWindow && !this.dynamicIslandWindow.isDestroyed()) {
      this.dynamicIslandWindow.close()
      this.dynamicIslandWindow = null
    }
    this.mainWinRef = null
  }

  /**
   * 注册 IPC 处理器
   */
  registerIpcHandlers(): void {
    /**
     * 获取灵动岛窗口位置和大小
     */
    ipcMain.handle('dynamic-island:get-bounds', () => {
      if (!this.dynamicIslandWindow || this.dynamicIslandWindow.isDestroyed()) {
        return null
      }
      const bounds = this.dynamicIslandWindow.getBounds()
      return bounds
    })

    /**
     * 获取主窗口边界（用于约束灵动岛拖动范围）
     */
    ipcMain.handle('dynamic-island:get-main-bounds', () => {
      if (!this.mainWinRef || this.mainWinRef.isDestroyed()) {
        return null
      }
      return this.mainWinRef.getBounds()
    })

    /**
     * 设置灵动岛窗口位置
     */
    ipcMain.handle('dynamic-island:set-position', (_event, position: { x: number; y: number }) => {
      if (!this.dynamicIslandWindow || this.dynamicIslandWindow.isDestroyed()) {
        return false
      }
      this.dynamicIslandWindow.setPosition(position.x, position.y)
      return true
    })

    /**
     * 设置灵动岛窗口大小（展开/收起时调整）
     */
    ipcMain.handle('dynamic-island:set-size', (_event, size: { width: number; height: number }) => {
      if (!this.dynamicIslandWindow || this.dynamicIslandWindow.isDestroyed()) {
        return false
      }
      const currentBounds = this.dynamicIslandWindow.getBounds()
      // 使用 setBounds 替代 setSize，在 Linux 上 setSize 可能无法缩小窗口
      this.dynamicIslandWindow.setBounds({
        x: currentBounds.x,
        y: currentBounds.y,
        width: size.width,
        height: size.height,
      }, false)
      return true
    })

    /**
     * 关闭灵动岛窗口
     */
    ipcMain.handle('dynamic-island:close', () => {
      this.destroyDynamicIslandWindow()
      return true
    })

    /**
     * 开始拖动窗口（通过 CSS -webkit-app-region 实现，此处为空操作）
     */
    ipcMain.handle('dynamic-island:start-drag', () => {
      // 拖动通过 CSS -webkit-app-region: drag 实现，不需要主进程处理
      return true
    })
  }

  /**
   * 注销 IPC 处理器
   */
  unregisterIpcHandlers(): void {
    ipcMain.removeHandler('dynamic-island:get-bounds')
    ipcMain.removeHandler('dynamic-island:get-main-bounds')
    ipcMain.removeHandler('dynamic-island:set-position')
    ipcMain.removeHandler('dynamic-island:set-size')
    ipcMain.removeHandler('dynamic-island:close')
    ipcMain.removeHandler('dynamic-island:start-drag')
  }
}
