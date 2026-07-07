/**
 * 多语言支持 - 类型定义
 */

/** 支持的语言代码 */
export type LanguageCode = 'zh' | 'en' | 'fr' | 'es'

/** 语言选项显示映射 */
export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  zh: '中文',
  en: 'English',
  fr: 'Français',
  es: 'Español',
}

/** 语言选项完整列表 */
export const LANGUAGES: Array<{ code: LanguageCode; label: string }> = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français', },
  { code: 'es', label: 'Español' },
]

/**
 * 将操作系统 locale 映射到支持的语言代码
 * 不支持的语言默认返回 'en'
 */
export function mapLocaleToLanguage(locale: string): LanguageCode {
  if (!locale) return 'en'
  const lower = locale.toLowerCase()
  if (lower.startsWith('zh') || lower.startsWith('cn') || lower.includes('hans')) return 'zh'
  if (lower.startsWith('fr')) return 'fr'
  if (lower.startsWith('es')) return 'es'
  return 'en'
}
