/**
 * 目录档案 NEXUS.md 管理 — IPC 处理器
 *
 * 提供读写、检查目录下 NEXUS.md 文件的能力。
 *
 * NEXUS.md 是每个目录下的描述文件，包含该目录的结构、技术栈、重要文件等。
 * 智能体工作时自动读取并注入 system prompt，避免对本地环境失忆。
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { logger } from '../../utils/logger'
import { NexusProfileAgent } from '../../agent/nexus-profile-agent'

const NEXUS_FILENAME = '.NEXUS.md'
const MAX_CONTENT_LENGTH = 3000 // 前端写入限制

/**
 * 在 Windows 上设置文件隐藏属性（使用 attrib +h）
 * 在 Linux/macOS 上无操作（以 . 开头的文件自动隐藏）
 */
function setHiddenAttribute(filePath: string): void {
  if (process.platform === 'win32') {
    try {
      execSync(`attrib +h "${filePath}"`, { stdio: 'ignore' })
      logger.info(`[NexusProfile] 已设置 Windows 隐藏属性: ${filePath}`)
    } catch (err) {
      logger.warn(`[NexusProfile] 设置 Windows 隐藏属性失败: ${filePath}`, err)
    }
  }
}

/**
 * 注册 NEXUS.md 管理 IPC 处理器
 */
export function registerNexusProfileHandlers(): void {
  // 检查目录下是否存在 NEXUS.md
  ipcMain.handle(
    IPC_CHANNELS.NEXUS_PROFILE_EXISTS,
    (_event, dir: string): { exists: boolean } => {
      try {
        const filePath = join(dir, NEXUS_FILENAME)
        return { exists: existsSync(filePath) }
      } catch (error) {
        logger.error(`[NexusProfile] exists 检查失败: ${dir}`, error)
        return { exists: false }
      }
    }
  )

  // 读取目录下的 NEXUS.md
  ipcMain.handle(
    IPC_CHANNELS.NEXUS_PROFILE_READ,
    (_event, dir: string): { exists: boolean; content: string; error?: string } => {
      try {
        const filePath = join(dir, NEXUS_FILENAME)
        if (!existsSync(filePath)) {
          return { exists: false, content: '' }
        }
        const content = readFileSync(filePath, 'utf-8')
        return { exists: true, content }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`[NexusProfile] 读取失败: ${dir}`, error)
        return { exists: false, content: '', error: message }
      }
    }
  )

  // 写入 NEXUS.md
  ipcMain.handle(
    IPC_CHANNELS.NEXUS_PROFILE_WRITE,
    (_event, dir: string, content: string): { success: boolean; error?: string } => {
      try {
        if (!existsSync(dir)) {
          return { success: false, error: `目录不存在: ${dir}` }
        }
        if (content.length > MAX_CONTENT_LENGTH) {
          return { success: false, error: `内容超出限制（最大 ${MAX_CONTENT_LENGTH} 字符）` }
        }
        const filePath = join(dir, NEXUS_FILENAME)
        writeFileSync(filePath, content, 'utf-8')
        setHiddenAttribute(filePath)
        logger.info(`[NexusProfile] 已写入: ${filePath} (${content.length} 字符)`)
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`[NexusProfile] 写入失败: ${dir}`, error)
        return { success: false, error: message }
      }
    }
  )

  // 自动生成目录说明
  ipcMain.handle(
    IPC_CHANNELS.NEXUS_PROFILE_GENERATE,
    async (_event, dir: string): Promise<{ success: boolean; error?: string }> => {
      try {
        if (!existsSync(dir)) {
          return { success: false, error: `目录不存在: ${dir}` }
        }

        logger.info(`[NexusProfile] 开始自动生成目录说明: ${dir}`)
        const result = await NexusProfileAgent.generate(dir)

        if (result.success) {
          logger.info(`[NexusProfile] 自动生成完成: ${dir}`)
        } else {
          logger.error(`[NexusProfile] 自动生成失败: ${dir} - ${result.error}`)
        }

        return { success: result.success, error: result.error }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`[NexusProfile] 自动生成异常: ${dir}`, error)
        return { success: false, error: message }
      }
    }
  )
}
