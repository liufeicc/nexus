/**
 * 多语言翻译 Hook
 *
 * 提供简单的 t(key) 函数，支持嵌套 key 如 'sidebar.title'
 * 语言配置存储在 SQLite 中，启动时从配置读取，未设置时根据操作系统语言自动检测
 */

import { useState, useCallback, useEffect } from 'react'
import type { LanguageCode } from './types'
export type { LanguageCode } from './types'
export { LANGUAGES, LANGUAGE_LABELS, mapLocaleToLanguage } from './types'
import { mapLocaleToLanguage } from './types'

// ===== 翻译文件懒加载缓存 =====
let translationsCache: Record<string, Record<string, unknown>> = {}

/**
 * 异步加载翻译文件
 */
async function loadTranslations(lang: LanguageCode): Promise<Record<string, unknown>> {
  if (translationsCache[lang]) {
    return translationsCache[lang]
  }
  try {
    const mod = await import(`./locales/${lang}.json`)
    translationsCache[lang] = mod.default
    return mod.default
  } catch {
    // 回退到英文
    if (lang !== 'en') {
      const enMod = await import('./locales/en.json')
      translationsCache[lang] = enMod.default
      return enMod.default
    }
    return {}
  }
}

/**
 * 通过点号路径访问嵌套对象，如 getNested(obj, 'sidebar.title')
 * 支持参数替换，如 getNested(obj, 'dynamicIsland.historyToggle', { count: 3 })
 * 将 "对话 {count} 轮，点击查看" 替换为 "对话 3 轮，点击查看"
 */
function getNested(obj: Record<string, unknown>, path: string, params?: Record<string, string | number>): string {
  const keys = path.split('.')
  let current: unknown = obj
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return path
    current = (current as Record<string, unknown>)[key]
  }
  if (typeof current !== 'string') return path
  // 参数替换
  if (params) {
    return current.replace(/\{(\w+)\}/g, (_, paramKey) => {
      const value = params[paramKey]
      return value !== undefined ? String(value) : `{${paramKey}}`
    })
  }
  return current
}

/**
 * 全局当前语言状态（跨组件共享）
 */
let globalLanguage: LanguageCode = 'en'
let globalTranslations: Record<string, unknown> = {}
let languageChangeListeners: Set<() => void> = new Set()

/**
 * 同步设置全局语言（用于初始化）
 */
export function setGlobalLanguageSync(lang: LanguageCode) {
  globalLanguage = lang
  // 如果缓存中已有翻译直接使用，否则标记为空（首次渲染后异步加载会填充）
  globalTranslations = translationsCache[lang] || {}
}

/**
 * 异步设置语言（加载翻译文件）
 * @param skipSave 跳过持久化（用于灵动岛等跨窗口同步场景，避免循环保存）
 */
export async function setGlobalLanguage(lang: LanguageCode, skipSave = false): Promise<void> {
  const translations = await loadTranslations(lang)
  globalLanguage = lang
  globalTranslations = translations
  // 持久化到配置
  if (!skipSave && typeof window !== 'undefined' && window.electronAPI?.config?.save) {
    window.electronAPI.config.save('language', lang).catch(() => {})
  }
  languageChangeListeners.forEach(fn => fn())
}

/**
 * 初始化语言系统
 * 优先使用已保存的配置，否则检测操作系统语言
 */
export async function initLanguage(): Promise<LanguageCode> {
  // 尝试从配置读取
  try {
    const saved = await window.electronAPI?.config?.get('language')
    if (saved && ['zh', 'en', 'fr', 'es'].includes(saved)) {
      const lang = saved as LanguageCode
      const translations = await loadTranslations(lang)
      globalLanguage = lang
      globalTranslations = translations
      return lang
    }
  } catch {
    // 配置读取失败，继续回退
  }

  // 检测操作系统语言
  let lang: LanguageCode = 'en'
  try {
    const osLocale = await window.electronAPI?.app?.getLocale?.()
    lang = mapLocaleToLanguage(osLocale || '')
  } catch {
    // OS 检测失败，用默认英文
  }

  // 确保翻译一定被加载
  try {
    const translations = await loadTranslations(lang)
    globalLanguage = lang
    globalTranslations = translations
    return lang
  } catch {
    // 终极回退：强制加载英文
    const translations = await loadTranslations('en')
    globalLanguage = 'en'
    globalTranslations = translations
    return 'en'
  }
}

/**
 * 获取当前语言
 */
export function getCurrentLanguage(): LanguageCode {
  return globalLanguage
}

/**
 * 非 React 环境翻译函数（用于 store、工具函数等）
 * 注意：此函数不会响应语言变化，仅返回当前全局翻译
 */
export function t(key: string, params?: Record<string, string | number>): string {
  if (!globalTranslations || Object.keys(globalTranslations).length === 0) return key
  return getNested(globalTranslations, key, params)
}

/**
 * React Hook: 使用 i18n 翻译
 *
 * 返回:
 * - t(key: string): string - 翻译函数
 * - language: LanguageCode - 当前语言
 * - setLanguage(lang: LanguageCode): Promise<void> - 切换语言
 */
export function useI18n() {
  const [, forceUpdate] = useState(0)

  // 订阅语言变化
  useEffect(() => {
    const listener = () => forceUpdate(n => n + 1)
    languageChangeListeners.add(listener)
    return () => {
      languageChangeListeners.delete(listener)
    }
  }, [])

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    if (!globalTranslations || Object.keys(globalTranslations).length === 0) return key
    return getNested(globalTranslations, key, params)
  }, [])

  const setLanguage = useCallback(async (lang: LanguageCode) => {
    await setGlobalLanguage(lang)
  }, [])

  return {
    t,
    language: globalLanguage,
    setLanguage,
  }
}
