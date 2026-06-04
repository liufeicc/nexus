/**
 * 提示构建器主入口 — 组装 LLM 的 system prompt
 *
 * 组装顺序：
 * 1. Agent Identity
 * 2. 记忆系统冻结快照（如有）
 * 3. 目录档案 .NEXUS.md 说明（动态注入）
 * 4. 工具使用强制 + 模型执行纪律
 * 5. 平台提示
 * 6. 环境提示
 * 7. 智能体环境目录
 * 8. Skill 索引（动态注入）
 * 9. 额外提示
 */

import { DEFAULT_AGENT_IDENTITY } from './agent-identity'
import { buildPlatformHint } from './platform-hints'
import { buildEnvironmentHints } from './environment-hints'
import { buildEnvDirHint } from './env-dir-hint'
import { buildModelExecutionGuidance } from './model-guidance-selector'
import type { BuildSystemPromptOptions, PromptLanguage } from './types'

export type { BuildSystemPromptOptions, PromptLanguage } from './types'
export { buildNexusProfileBlock } from './nexus-profile-block'

/**
 * 构建完整的 system prompt
 */
export function buildSystemPrompt(options?: BuildSystemPromptOptions): string {
  const model = options?.model || ''
  const language: PromptLanguage = options?.language || 'zh'
  const identity = options?.customIdentity || DEFAULT_AGENT_IDENTITY[language]
  const platform = options?.platform || 'cli'
  const extra = options?.extraPrompt || ''
  const memoryBlock = options?.memoryBlock
  const skillBlock = options?.skillBlock
  const nexusProfileBlock = options?.nexusProfileBlock

  const sections: string[] = []

  // 1. Agent Identity
  sections.push(identity)

  // 2. 记忆系统冻结快照
  if (memoryBlock) {
    sections.push(memoryBlock)
  }

  // 2.5 目录档案 .NEXUS.md 说明
  if (nexusProfileBlock) {
    sections.push(nexusProfileBlock)
  }

  // 3. 工具使用强制 + 模型执行纪律
  const executionGuidance = buildModelExecutionGuidance(model, language)
  if (executionGuidance) {
    sections.push(executionGuidance)
  }

  // 4. 平台提示
  const platformHint = buildPlatformHint(platform, language)
  if (platformHint) {
    sections.push(platformHint)
  }

  // 5. 环境提示
  const envHints = buildEnvironmentHints(language)
  if (envHints) {
    sections.push(envHints)
  }

  // 6. 智能体环境目录
  sections.push(buildEnvDirHint(language))

  // 7. Skill 索引
  if (skillBlock) {
    sections.push(skillBlock)
  }

  // 8. 额外提示
  if (extra) {
    sections.push(extra)
  }

  return sections.join('\n\n')
}
