/**
 * 引导窗口管理器
 * 负责创建和管理首次启动的引导窗口
 */

import { BrowserWindow, Menu, app, shell, ipcMain } from 'electron'
import path from 'path'
import * as fs from 'fs'

/** 获取应用图标路径 */
function getAppIconPath(): string | undefined {
  const isDev = !app.isPackaged
  const resourcesPath = isDev
    ? path.join(__dirname, '../../resources')
    : path.join(process.resourcesPath, 'resources')

  if (process.platform === 'win32') {
    const icoPath = path.join(resourcesPath, 'icon.ico')
    if (fs.existsSync(icoPath)) return icoPath
  } else if (process.platform === 'darwin') {
    const icnsPath = path.join(resourcesPath, 'icons', 'mac', 'icon.icns')
    if (fs.existsSync(icnsPath)) return icnsPath
  } else {
    const pngPath = path.join(resourcesPath, 'icons', 'linux', '512x512.png')
    if (fs.existsSync(pngPath)) return pngPath
  }
  return undefined
}

/** 引导窗口管理类 */
export class OnboardingWindowManager {
  private window: BrowserWindow | null = null

  /** 创建引导窗口 */
  async createOnboardingWindow(): Promise<BrowserWindow> {
    const icon = getAppIconPath()
    const window = new BrowserWindow({
      width: 680,
      height: 620,
      minWidth: 600,
      minHeight: 550,
      resizable: true,
      frame: true,
      title: 'Nexus 首次设置',
      backgroundColor: '#f5f5f5',
      icon,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
      },
    })

    // 隐藏默认菜单栏
    Menu.setApplicationMenu(null)

    this.window = window

    // 加载引导页面
    if (process.env.VITE_DEV_SERVER_URL) {
      window.loadURL(`${process.env.VITE_DEV_SERVER_URL}onboarding.html`)
      window.webContents.openDevTools()
    } else {
      window.loadFile(path.join(__dirname, '../renderer/onboarding.html'))
    }

    // 配置外部链接处理
    window.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    return window
  }

  /**
   * 注册引导窗口 IPC 处理器
   * 引导窗口通过 IPC 通知主进程配置已完成，触发主窗口创建
   */
  registerIpcHandlers(createMainWindow: () => Promise<void>) {
    // 引导完成：保存配置并创建主窗口
    ipcMain.handle('onboarding:complete', async (_event, data: {
      agentConfig: any
      subAgentConfig: any
      emailConfig?: any
    }) => {
      try {
        const { DatabaseService } = await import('../services/database.service')
        const { invalidateConfigCache } = await import('../services/agent-service')
        const configDAO = DatabaseService.getInstance().getConfigDAO()

        // 保存主副模型配置
        configDAO.save('agentConfig', data.agentConfig)
        configDAO.save('subAgentConfig', data.subAgentConfig)
        // 保存邮件配置（如果提供）
        if (data.emailConfig) {
          configDAO.save('emailConfig', data.emailConfig)
        }
        // 标记引导已完成
        configDAO.save('onboardingComplete', true)
        invalidateConfigCache()

        // 关闭引导窗口
        if (this.window && !this.window.isDestroyed()) {
          this.window.close()
          this.window = null
        }

        // 创建主窗口
        await createMainWindow()
        return { success: true }
      } catch (err) {
        console.error('[Onboarding] 保存配置失败:', err)
        return { success: false, error: String(err) }
      }
    })

    // 跳过引导：直接创建主窗口
    ipcMain.handle('onboarding:skip', async () => {
      try {
        const { DatabaseService } = await import('../services/database.service')
        const configDAO = DatabaseService.getInstance().getConfigDAO()
        configDAO.save('onboardingComplete', true)

        if (this.window && !this.window.isDestroyed()) {
          this.window.close()
          this.window = null
        }

        await createMainWindow()
        return { success: true }
      } catch (err) {
        console.error('[Onboarding] 跳过引导失败:', err)
        return { success: false, error: String(err) }
      }
    })
  }

  /** 关闭引导窗口（不创建主窗口，用于异常退出） */
  closeWithoutOnboarding() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close()
      this.window = null
    }
  }

  /** 获取引导窗口引用 */
  getWindow(): BrowserWindow | null {
    return this.window
  }
}
