import type { PromptLanguage } from './types'

/** 平台提示 — 中文版 */
const PLATFORM_HINTS_ZH: Record<string, string> = {
  cli: (
    '# 输出格式\n你的输出将显示在终端中。'
    + '请使用纯文本而非 Markdown 格式，以确保内容在终端中清晰可读。'
  ),
}

/** 平台提示 — English */
const PLATFORM_HINTS_EN: Record<string, string> = {
  cli: (
    '# Output Format\nYour output will be displayed in a terminal. '
    + 'Use plain text rather than markdown formatting to ensure '
    + 'content is clearly readable in the terminal.'
  ),
}

/** 平台提示 — Français */
const PLATFORM_HINTS_FR: Record<string, string> = {
  cli: (
    '# Format de sortie\nTa sortie sera affichée dans un terminal. '
    + 'Utilise du texte brut plutôt que le formatage Markdown pour garantir '
    + 'que le contenu reste clairement lisible dans le terminal.'
  ),
}

/** 平台提示 — Español */
const PLATFORM_HINTS_ES: Record<string, string> = {
  cli: (
    '# Formato de Salida\nTu salida se mostrará en una terminal. '
    + 'Usa texto plano en lugar de formato markdown para asegurar '
    + 'que el contenido sea claramente legible en la terminal.'
  ),
}

const PLATFORM_HINTS: Record<PromptLanguage, Record<string, string>> = {
  zh: PLATFORM_HINTS_ZH,
  en: PLATFORM_HINTS_EN,
  fr: PLATFORM_HINTS_FR,
  es: PLATFORM_HINTS_ES,
}

/**
 * 获取平台提示
 * @param platform 平台标识（'cli', 'weixin' 等），默认 'cli'
 * @param language 提示语言，默认 'zh'
 */
export function buildPlatformHint(platform: string, language: PromptLanguage): string {
  const p = (platform || 'cli').toLowerCase()
  return PLATFORM_HINTS[language][p] || ''
}
