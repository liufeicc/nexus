/** 系统提示支持的语言 */
export type PromptLanguage = 'zh' | 'en' | 'fr' | 'es'

export interface BuildSystemPromptOptions {
  /** 模型名称（用于模型特异性指导），如 'claude-sonnet-4-6' */
  model?: string
  /** 自定义 agent 身份（覆盖默认身份描述） */
  customIdentity?: string
  /** 平台标识（'cli'、'weixin'、'telegram' 等），默认 'cli' */
  platform?: string
  /** 额外提示（追加到最后） */
  extraPrompt?: string
  /** 记忆系统冻结快照（会话启动时注入） */
  memoryBlock?: string
  /** Skill 索引 block（每次 run 前动态注入） */
  skillBlock?: string
  /** 目录档案 .NEXUS.md 描述（每次 run 前动态注入） */
  nexusProfileBlock?: string
  /** 系统提示语言，默认 'zh' */
  language?: PromptLanguage
}
