/**
 * 预加载脚本
 * 在渲染进程和主进程之间建立安全的通信桥梁
 *
 * 各功能域的 API 已拆分到 ./preload/ 目录下的独立模块中，
 * 本文件负责导入并组合为统一的 electronAPI 对象暴露给渲染进程。
 */

import { contextBridge } from 'electron'

// 各功能域 API
import { config, onConfigChanged } from './preload/config-api'
import { session, snapshot, onSaveOnExit } from './preload/session-api'
import { pty } from './preload/pty-api'
import { fs } from './preload/fs-api'
import { browser } from './preload/browser-api'
import { agent } from './preload/agent-api'
import { nexus, dynamicIsland } from './preload/nexus-api'
import {
  app, platform, clipboard, path,
  showPathSelector,
  minimizeWindow, maximizeWindow, unmaximizeWindow, closeWindow,
  isMaximized, onMaximizedChanged,
  operation, fileAttachment,
  task, skill, inputHistory, memory, update, nexusProfile,
  onboardingComplete, onboardingSkip,
} from './preload/misc-api'

// 组合所有 API 并暴露给渲染进程
const electronAPI = {
  // 功能域模块
  config,
  session,
  snapshot,
  pty,
  app,
  path,
  showPathSelector,
  platform,
  clipboard,
  fs,
  browser,
  operation,
  // 窗口控制
  minimizeWindow,
  maximizeWindow,
  unmaximizeWindow,
  closeWindow,
  isMaximized,
  onMaximizedChanged,
  // 智能体
  agent,
  // 文件附件
  fileAttachment,
  // 灵动岛
  dynamicIsland,
  // 任务与技能
  task,
  skill,
  // Nexus 连接
  nexus,
  // 输入历史
  inputHistory,
  // 引导窗口
  onboardingComplete,
  onboardingSkip,
  // 记忆管理
  memory,
  // 自动更新
  update,
  // 目录档案
  nexusProfile,
  // 全局事件
  onConfigChanged,
  onSaveOnExit,
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export {}
