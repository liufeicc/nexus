import type { PromptLanguage } from './types'
import { TOOL_USE_ENFORCEMENT_GUIDANCE } from './tool-enforcement'
import { OPENAI_MODEL_EXECUTION_GUIDANCE, GOOGLE_MODEL_OPERATIONAL_GUIDANCE } from './model-execution-guidance'

/** 需要工具使用强制的模型名称子串 */
const TOOL_USE_ENFORCEMENT_MODELS = ['gpt', 'codex', 'gemini', 'gemma', 'grok']

/** 需要 Google 模型的名称子串 */
const GOOGLE_MODELS = ['gemini', 'gemma']

/**
 * 根据模型名称构建执行纪律提示
 */
export function buildModelExecutionGuidance(model: string, language: PromptLanguage): string {
  const lower = model.toLowerCase()

  const needsEnforcement = TOOL_USE_ENFORCEMENT_MODELS.some(m => lower.includes(m))
  if (!needsEnforcement) return ''

  const parts: string[] = [TOOL_USE_ENFORCEMENT_GUIDANCE[language]]

  if (GOOGLE_MODELS.some(m => lower.includes(m))) {
    parts.push(GOOGLE_MODEL_OPERATIONAL_GUIDANCE[language])
  } else {
    parts.push(OPENAI_MODEL_EXECUTION_GUIDANCE[language])
  }

  return parts.join('\n\n')
}
