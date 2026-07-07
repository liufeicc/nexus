/**
 * 配置类型定义（类型安全版）
 */

import { MemoryConfig } from './memory'
import type { AgentConfig } from './agent'

/**
 * 窗口状态配置
 */
export interface WindowStateConfig {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

/**
 * 常用路径配置项
 */
export interface CommonPathItem {
  name: string
  path: string
  icon?: string
}

/**
 * 终端配置
 */
export interface TerminalConfig {
  defaultShell?: string
  defaultCwd?: string
  fontSize?: number
  fontFamily?: string
}

/**
 * 主题配置
 */
export interface ThemeConfig {
  name: string
}

/**
 * 已知配置键与值的类型映射
 * 新增配置项时在此处声明对应的类型
 */
export interface ConfigValueMap {
  theme: ThemeConfig
  commonPaths: CommonPathItem[]
  windowState: WindowStateConfig
  terminalConfig: TerminalConfig
  sidebarWidth: number
  sidebarCollapsed: boolean
  recentExpanded: boolean
  browserDefaultUrl: string
  agentEnabled: boolean
  /** 智能体危险命令交互式审批开关，默认 true */
  agentInteractive: boolean
  /** 智能体 API 配置（复用 AgentConfig 类型，包含 summaryModel 字段） */
  agentConfig: AgentConfig
  /** 副智能体 API 配置（结构与 agentConfig 类似，但无 maxIterations） */
  subAgentConfig: {
    provider: string
    apiUrl: string
    apiKey: string
    model: string
    timeout?: number
    maxRetries?: number
    contextLength?: number
    accessModes?: string[]
  }
  /** 网络搜索工具配置 */
  webSearch: {
    provider: string
    apiUrl: string
    apiKey: string
  }
  /** 记忆系统配置 */
  memoryConfig: MemoryConfig
  /** 界面语言代码 */
  language: 'zh' | 'en' | 'fr' | 'es'
  /** 邮件工具配置 */
  emailConfig: {
    enabled: boolean
    account: {
      email: string
      appPassword: string
      imapHost: string
      imapPort: number
      imapSecure: boolean
      smtpHost: string
      smtpPort: number
      smtpSecure: boolean
      displayName?: string
    } | null
  }
  /** 引导是否已完成（首次启动配置 AI 模型后设为 true） */
  onboardingComplete: boolean
}

/**
 * 所有已知配置键的联合类型
 */
export type ConfigKey = keyof ConfigValueMap

/**
 * 根据键获取对应值的类型
 * 已知键返回精确类型，未知键返回 any 保持向后兼容
 */
export type ConfigValue<K extends string> = K extends ConfigKey
  ? ConfigValueMap[K]
  : unknown

/**
 * 完整配置对象（用于 getAll 返回值）
 * 仅包含已知键的类型定义
 */
export type ConfigMap = Partial<ConfigValueMap>
