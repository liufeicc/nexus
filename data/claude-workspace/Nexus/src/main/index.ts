/**
 * Nexus 主进程入口文件
 *
 * 职责：
 * 1. 应用生命周期管理
 * 2. 主窗口创建和管理
 * 3. 核心服务初始化
 * 4. IPC 通道注册
 */

import { app, BrowserWindow } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { IPC_CHANNELS } from '../core/constants/ipc-channels'
import { getNexusDirName } from '../core/utils/path-utils'

// ===== 设置 userData 路径（必须在 app.whenReady() 之前） =====
// 开发环境使用 ~/.Nexus_dev，生产环境使用 ~/.Nexus
const configDirName = getNexusDirName()
const userDataPath = path.join(os.homedir(), configDirName)
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true })
}
app.setPath('userData', userDataPath)

// ===== 创建智能体环境目录（用于临时脚本、虚拟环境等） =====
const agentEnvDir = path.join(userDataPath, 'env')
if (!fs.existsSync(agentEnvDir)) {
  fs.mkdirSync(agentEnvDir, { recursive: true })
}
// 导出供其他模块使用（通过环境变量，其他模块通过 process.env.NEXUS_AGENT_ENV_DIR 读取）
process.env.NEXUS_AGENT_ENV_DIR = agentEnvDir
export const AGENT_ENV_DIR = agentEnvDir

// ===== 创建 plans 目录（用于存储智能体生成的执行计划） =====
const plansDir = path.join(userDataPath, 'plans')
if (!fs.existsSync(plansDir)) {
  fs.mkdirSync(plansDir, { recursive: true })
}

// 导入核心服务
import { WindowManager } from './windows/window-manager'
import { OnboardingWindowManager } from './windows/onboarding-window-manager'
import { DynamicIslandManager } from './windows/dynamic-island-manager'
import { registerIpcHandlers, setMainWindow, unregisterIpcHandlers } from './ipc/ipc-handlers'
import { markQuitting } from './ipc/handlers/file-watcher'
import { setDynamicIslandManager } from './ipc/handlers/config'
import { setupInteractiveHandlers } from './services/agent-service'
import { DatabaseService } from './services/database.service'
import { PtyService } from './services/pty.service'
import { BrowserViewService } from './services/browser-view.service'
import { UpdateService } from './services/update-service'
import { installBundledSkills } from './utils/skill-installer'

// 导入日志工具
import { logger, shutdownLogger } from './utils/logger'
import { shutdownModelLogger } from './utils/model-logger'

// 全局窗口管理器实例
let windowManager: WindowManager | null = null
// 全局引导窗口管理器实例
let onboardingWindowManager: OnboardingWindowManager | null = null
// 全局灵动岛窗口管理器实例
let dynamicIslandManager: DynamicIslandManager | null = null
// 标记是否正在创建主窗口（防止重复创建）
let isCreatingMainWindow = false

/**
 * 恢复窗口状态
 */
async function restoreWindowState(window: BrowserWindow) {
  try {
    const configDAO = DatabaseService.getInstance().getConfigDAO()
    const windowState = configDAO.get('windowState')
    if (windowState) {
      const { x, y, width, height, maximized } = windowState
      window.setBounds({ x, y, width, height })
      if (maximized) {
        window.maximize()
      }
      logger.info('[App] 窗口状态已恢复:', windowState)
    }
  } catch (error) {
    logger.error('[App] 恢复窗口状态失败:', error)
  }
}

/**
 * 保存窗口状态
 */
function saveWindowState(window: BrowserWindow) {
  try {
    const configDAO = DatabaseService.getInstance().getConfigDAO()
    const windowState = {
      x: window.getPosition()[0],
      y: window.getPosition()[1],
      width: window.getSize()[0],
      height: window.getSize()[1],
      maximized: window.isMaximized(),
    }
    configDAO.save('windowState', windowState)
    logger.info('[App] 窗口状态已保存:', windowState)
  } catch (error) {
    logger.error('[App] 保存窗口状态失败:', error)
  }
}

/**
 * 窗口创建后的初始化流程（设置引用、注册交互处理器、创建灵动岛）
 */
async function initializeWindowServices(window: BrowserWindow) {
  setMainWindow(window)
  setupInteractiveHandlers(window)

  // 初始化自动更新服务
  const updateService = UpdateService.getInstance()
  updateService.setMainWindow(window)
  updateService.initialize()

  // 创建灵动岛浮动窗口
  dynamicIslandManager = new DynamicIslandManager()
  dynamicIslandManager.createDynamicIslandWindow(window)
  dynamicIslandManager.registerIpcHandlers()
  // 将灵动岛管理器引用传递给配置处理器，以便发送语言变更通知
  setDynamicIslandManager(dynamicIslandManager)
}

/**
 * 创建主窗口并初始化（供引导窗口调用）
 */
async function createAndInitMainWindow() {
  if (isCreatingMainWindow) return
  isCreatingMainWindow = true

  try {
    windowManager = new WindowManager()
    const window = await windowManager.createMainWindow()
    await initializeWindowServices(window)
    await restoreWindowState(window)

    // 监听窗口关闭事件
    window.on('close', async (event) => {
      if (isQuitting) return
      event.preventDefault()
      isQuitting = true
      logger.info('[App] 窗口关闭，保存快照...')
      window.webContents.send(IPC_CHANNELS.SNAPSHOT_SAVE_ON_EXIT)
      await new Promise(resolve => setTimeout(resolve, 1000))
      logger.info('[App] 快照保存完成')
      window.removeAllListeners('close')
      window.close()
    })

    logger.info('[App] 主窗口创建完成')
  } catch (error) {
    logger.error('[App] 创建主窗口失败:', error)
    app.quit()
  }
}

/**
 * 初始化应用
 */
async function initializeApp() {
  logger.info('[App] 开始初始化...')

  try {
    // 1. 初始化数据库服务
    await DatabaseService.getInstance().initialize()
    logger.info('[App] 数据库服务初始化完成')

    // 2. 注册 IPC 处理器
    registerIpcHandlers()
    logger.info('[App] IPC 处理器注册完成')

    // 3. 检查是否需要引导
    const configDAO = DatabaseService.getInstance().getConfigDAO()
    const onboardingComplete = configDAO.get('onboardingComplete')

    if (onboardingComplete) {
      // 已完成引导，直接创建主窗口
      logger.info('[App] 引导已完成，创建主窗口')
      await createAndInitMainWindow()
    } else {
      // 首次启动，安装内置 Skills
      const { installed } = await installBundledSkills()
      logger.info('[App] Skills 安装完成:', installed)

      // 创建引导窗口
      logger.info('[App] 首次启动，创建引导窗口')
      onboardingWindowManager = new OnboardingWindowManager()
      await onboardingWindowManager.createOnboardingWindow()
      // 注册引导窗口 IPC 处理器（保存配置后创建主窗口）
      onboardingWindowManager.registerIpcHandlers(createAndInitMainWindow)
    }

    logger.info('[App] 应用初始化完成')
  } catch (error) {
    logger.error('[App] 初始化失败:', error)
    app.quit()
  }
}

/**
 * 应用就绪时创建主窗口
 */
app.whenReady().then(() => {
  // 设置应用名称
  app.setName('Nexus')

  // 初始化应用
  initializeApp()

  // macOS: 点击 dock 图标重新激活窗口
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0 && windowManager && !isCreatingMainWindow) {
      await createAndInitMainWindow()
    }
  })
})

/**
 * 退出前保存快照
 */
async function saveSnapshotBeforeQuit(): Promise<void> {
  const mainWindow = windowManager?.getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) {
    logger.info('[App] 退出时没有可用窗口，跳过快照保存')
    return
  }

  logger.info('[App] 退出前保存快照...')
  mainWindow.webContents.send(IPC_CHANNELS.SNAPSHOT_SAVE_ON_EXIT)
  await new Promise(resolve => setTimeout(resolve, 1000))
  logger.info('[App] 快照保存完成')
}

/** 退出流程标记，防止重复保存 */
let isQuitting = false

/**
 * 所有窗口关闭时退出应用（macOS 除外）
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!isQuitting) {
      isQuitting = true
      cleanup()
    }
    app.quit()
  }
})

/**
 * 应用退出前清理资源（备用路径，如 Mac 菜单退出、或窗口 close 事件未拦截时）
 */
app.on('before-quit', async (event) => {
  if (isQuitting) return

  event.preventDefault()
  isQuitting = true
  logger.info('[App] before-quit: 保存快照...')

  await saveSnapshotBeforeQuit()
  cleanup()
  app.quit()
})

/**
 * 清理资源
 */
function cleanup() {
  // 标记退出状态，阻止文件监视器发送 IPC 消息
  markQuitting()

  // 清理 IPC 处理器和文件监视器
  unregisterIpcHandlers()

  // 清理灵动岛窗口
  if (dynamicIslandManager) {
    dynamicIslandManager.unregisterIpcHandlers()
    dynamicIslandManager.destroyDynamicIslandWindow()
    dynamicIslandManager = null
  }

  // 清理引导窗口
  if (onboardingWindowManager) {
    onboardingWindowManager.closeWithoutOnboarding()
    onboardingWindowManager = null
  }

  // 保存窗口状态
  if (windowManager?.getMainWindow() && !windowManager.getMainWindow()?.isDestroyed()) {
    saveWindowState(windowManager.getMainWindow()!)
  }

  // 销毁所有 PTY 进程
  PtyService.getInstance().dispose()

  // 销毁所有 BrowserView
  BrowserViewService.getInstance().dispose()

  // 关闭数据库连接
  DatabaseService.getInstance().close()

  // 关闭日志写入流
  shutdownLogger()
  shutdownModelLogger()

  // 清理窗口管理器
  windowManager = null

  logger.info('[App] 资源清理完成')
}

/**
 * 导出窗口管理器供渲染进程使用
 */
export { windowManager }
