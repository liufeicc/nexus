/**
 * SettingsModal 配置 Hook
 *
 * 封装所有状态、useEffect、配置加载/保存、测试处理器。
 * 内部调用 useI18n() 和 useAppStore()，仿照 use-dynamic-island-config 模式。
 */

import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../../store'
import { LANGUAGES, setGlobalLanguage, getCurrentLanguage } from '../../../i18n'
import type { LanguageCode } from '../../../i18n/types'
import { useI18n } from '../../../i18n'

export type SettingsCategory = 'mainModel' | 'subModel' | 'language' | 'email'

export interface ModelConfig {
  provider: string
  apiUrl: string
  apiKey: string
  model: string
  maxIterations?: number
  timeout?: number
  maxRetries?: number
  contextLength?: number
  accessModes?: string[]
  enableVision?: boolean
}

export interface CatalogEntry {
  id: number
  displayName: string
  modelName: string
  interfaceType: string
  defaultApiUrl: string
}

const KEY_FIELDS: (keyof ModelConfig)[] = ['provider', 'apiUrl', 'model']

const DEFAULT_ADVANCED = { maxIterations: 200, timeout: 600, maxRetries: 3, contextLength: 128000 }

export interface UseSettingsConfigReturn {
  // 导航
  activeCategory: SettingsCategory
  setActiveCategory: (cat: SettingsCategory) => void

  // Agent（主模型专属）
  agentEnabled: boolean
  setAgentEnabled: (v: boolean) => void

  // 主模型状态
  mainModelConfig: ModelConfig
  savedMainConfig: ModelConfig | null
  mainAdvancedOpen: boolean
  setMainAdvancedOpen: (v: boolean) => void
  mainTestStatus: 'idle' | 'testing' | 'success' | 'error'
  mainTestResult: string
  mainDirtyKeyFields: Set<string>
  mainSelectedCatalogId: number | null

  // 副模型状态
  subModelConfig: ModelConfig
  savedSubConfig: ModelConfig | null
  subAdvancedOpen: boolean
  setSubAdvancedOpen: (v: boolean) => void
  subTestStatus: 'idle' | 'testing' | 'success' | 'error'
  subTestResult: string
  subDirtyKeyFields: Set<string>
  subSelectedCatalogId: number | null

  // 模型目录
  modelCatalog: CatalogEntry[]

  // 语言
  currentLang: LanguageCode
  setCurrentLang: (v: LanguageCode) => void
  savedLang: LanguageCode

  // 邮件状态
  emailEnabled: boolean
  setEmailEnabled: (v: boolean) => void
  selectedProvider: string
  setSelectedProvider: (v: string) => void
  emailAddress: string
  setEmailAddress: (v: string) => void
  displayName: string
  setDisplayName: (v: string) => void
  appPassword: string
  setAppPassword: (v: string) => void
  imapHost: string
  setImapHost: (v: string) => void
  imapPort: number
  setImapPort: (v: number) => void
  imapSecure: boolean
  setImapSecure: (v: boolean) => void
  smtpHost: string
  setSmtpHost: (v: string) => void
  smtpPort: number
  setSmtpPort: (v: number) => void
  smtpSecure: boolean
  setSmtpSecure: (v: boolean) => void
  emailTestStatus: 'idle' | 'testing' | 'success' | 'error'
  emailTestResult: string

  // 处理器
  updateMainField: <K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) => void
  updateSubField: <K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) => void
  handleMainCatalogChange: (id: number | null) => void
  handleSubCatalogChange: (id: number | null) => void
  handleMainTest: () => Promise<void>
  handleSubTest: () => Promise<void>
  handleEmailTest: () => Promise<void>
  handleApply: () => Promise<void>
  canApply: () => boolean
  resetMainAdvanced: () => void
  resetSubAdvanced: () => void
}

export function useSettingsConfig(): UseSettingsConfigReturn {
  const { settingsModalVisible, setSettingsModalVisible, agentEnabled, setAgentEnabled } = useAppStore()
  const { t } = useI18n()

  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('mainModel')
  const [savedMainConfig, setSavedMainConfig] = useState<ModelConfig | null>(null)
  const [savedSubConfig, setSavedSubConfig] = useState<ModelConfig | null>(null)
  const [mainModelConfig, setMainModelConfig] = useState<ModelConfig>({
    provider: 'openai', apiUrl: '', apiKey: '', model: '',
    maxIterations: 200, timeout: 600, maxRetries: 3,
    contextLength: 128000, accessModes: [], enableVision: true,
  })
  const [subModelConfig, setSubModelConfig] = useState<ModelConfig>({
    provider: 'openai', apiUrl: '', apiKey: '', model: '',
    timeout: 600, maxRetries: 3, contextLength: 128000, accessModes: [],
  })
  const [mainAdvancedOpen, setMainAdvancedOpen] = useState(false)
  const [subAdvancedOpen, setSubAdvancedOpen] = useState(false)
  const [mainTestStatus, setMainTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [mainTestResult, setMainTestResult] = useState('')
  const [subTestStatus, setSubTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [subTestResult, setSubTestResult] = useState('')
  const [mainDirtyKeyFields, setMainDirtyKeyFields] = useState<Set<string>>(new Set())
  const [subDirtyKeyFields, setSubDirtyKeyFields] = useState<Set<string>>(new Set())
  const [currentLang, setCurrentLang] = useState<LanguageCode>('zh')
  const [savedLang, setSavedLang] = useState<LanguageCode>('zh')
  const [modelCatalog, setModelCatalog] = useState<CatalogEntry[]>([])
  const [mainSelectedCatalogId, setMainSelectedCatalogId] = useState<number | null>(null)
  const [subSelectedCatalogId, setSubSelectedCatalogId] = useState<number | null>(null)
  // 邮件状态
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [emailSavedEnabled, setEmailSavedEnabled] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('gmail')
  const [emailAddress, setEmailAddress] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState(993)
  const [imapSecure, setImapSecure] = useState(true)
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(465)
  const [smtpSecure, setSmtpSecure] = useState(true)
  const [emailTestStatus, setEmailTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [emailTestResult, setEmailTestResult] = useState('')

  // 配置加载
  useEffect(() => {
    if (!settingsModalVisible) return

    const loadConfig = async () => {
      try {
        const mainConfig = await window.electronAPI.config.get('agentConfig')
        if (mainConfig) {
          const loadedMain: ModelConfig = {
            provider: mainConfig.provider ?? 'openai',
            apiUrl: mainConfig.apiUrl ?? '',
            apiKey: mainConfig.apiKey ?? '',
            model: mainConfig.model ?? '',
            maxIterations: mainConfig.maxIterations ?? 200,
            timeout: mainConfig.timeout ? Math.floor(mainConfig.timeout / 1000) : 600,
            maxRetries: mainConfig.maxRetries ?? 3,
            contextLength: mainConfig.contextLength ?? 128000,
            accessModes: mainConfig.accessModes ?? [],
            enableVision: mainConfig.enableVision !== undefined ? mainConfig.enableVision : true,
          }
          setMainModelConfig(loadedMain)
          setSavedMainConfig({ ...loadedMain })
          if (mainConfig.accessModes && mainConfig.accessModes.length > 0) {
            setAgentEnabled(true)
          }
        }

        const subConfig = await window.electronAPI.config.get('subAgentConfig')
        if (subConfig) {
          const loadedSub: ModelConfig = {
            provider: subConfig.provider ?? 'openai',
            apiUrl: subConfig.apiUrl ?? '',
            apiKey: subConfig.apiKey ?? '',
            model: subConfig.model ?? '',
            timeout: subConfig.timeout ? Math.floor(subConfig.timeout / 1000) : 600,
            maxRetries: subConfig.maxRetries ?? 3,
            contextLength: subConfig.contextLength ?? 128000,
            accessModes: subConfig.accessModes ?? [],
          }
          setSubModelConfig(loadedSub)
          setSavedSubConfig({ ...loadedSub })
        }

        // 重置测试状态
        setMainTestStatus('idle')
        setMainTestResult('')
        setSubTestStatus('idle')
        setSubTestResult('')
        setMainDirtyKeyFields(new Set())
        setSubDirtyKeyFields(new Set())

        // 加载模型目录
        try {
          const catalog = await window.electronAPI.config.getModelCatalog()
          if (catalog && catalog.length > 0) setModelCatalog(catalog)
        } catch { /* 忽略 */ }

        // 加载语言配置
        try {
          const saved = getCurrentLanguage()
          setCurrentLang(saved)
          setSavedLang(saved)
        } catch { /* 忽略 */ }

        // 加载邮件配置
        try {
          const emailConfig = await window.electronAPI.config.get('emailConfig')
          if (emailConfig && emailConfig.enabled && emailConfig.account) {
            setEmailEnabled(true)
            setEmailSavedEnabled(true)
            setEmailAddress(emailConfig.account.email ?? '')
            setDisplayName(emailConfig.account.displayName ?? '')
            setAppPassword(emailConfig.account.appPassword ?? '')
            setImapHost(emailConfig.account.imapHost ?? '')
            setImapPort(emailConfig.account.imapPort ?? 993)
            setImapSecure(emailConfig.account.imapSecure !== undefined ? emailConfig.account.imapSecure : true)
            setSmtpHost(emailConfig.account.smtpHost ?? '')
            setSmtpPort(emailConfig.account.smtpPort ?? 465)
            setSmtpSecure(emailConfig.account.smtpSecure !== undefined ? emailConfig.account.smtpSecure : true)
            // 根据已有配置反推提供商
            if (emailConfig.account.imapHost?.includes('gmail')) setSelectedProvider('gmail')
            else if (emailConfig.account.imapHost?.includes('qq')) setSelectedProvider('qq')
            else if (emailConfig.account.imapHost?.includes('163')) setSelectedProvider('163')
            else if (emailConfig.account.smtpHost?.includes('outlook')) setSelectedProvider('outlook')
            else setSelectedProvider('custom')
          } else {
            setEmailEnabled(false)
            setEmailSavedEnabled(false)
          }
        } catch { /* 忽略 */ }

        // 重置邮件测试状态
        setEmailTestStatus('idle')
        setEmailTestResult('')
      } catch (err) {
        console.error('[SettingsModal] 加载配置失败:', err)
      }
    }

    loadConfig()
  }, [settingsModalVisible, setAgentEnabled])

  // Escape 键关闭弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && settingsModalVisible) {
        setSettingsModalVisible(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [settingsModalVisible, setSettingsModalVisible])

  // 字段更新
  const updateMainField = <K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) => {
    setMainModelConfig(prev => ({ ...prev, [key]: value }))
    if (KEY_FIELDS.includes(key)) {
      setMainDirtyKeyFields(prev => { const next = new Set(prev); next.add(key); return next })
      setMainTestStatus('idle')
      setMainTestResult('')
    }
  }

  const updateSubField = <K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) => {
    setSubModelConfig(prev => ({ ...prev, [key]: value }))
    if (KEY_FIELDS.includes(key)) {
      setSubDirtyKeyFields(prev => { const next = new Set(prev); next.add(key); return next })
      setSubTestStatus('idle')
      setSubTestResult('')
    }
  }

  // 目录选择处理
  const handleMainCatalogChange = (id: number | null) => {
    if (id === null) {
      setMainSelectedCatalogId(null)
    } else {
      const entry = modelCatalog.find(m => m.id === id)
      if (entry) {
        updateMainField('provider', entry.interfaceType)
        updateMainField('apiUrl', entry.defaultApiUrl)
        updateMainField('model', entry.modelName)
        setMainSelectedCatalogId(entry.id)
        setMainDirtyKeyFields(prev => { const next = new Set(prev); next.delete('provider'); next.delete('apiUrl'); return next })
      }
    }
  }

  const handleSubCatalogChange = (id: number | null) => {
    if (id === null) {
      setSubSelectedCatalogId(null)
    } else {
      const entry = modelCatalog.find(m => m.id === id)
      if (entry) {
        updateSubField('provider', entry.interfaceType)
        updateSubField('apiUrl', entry.defaultApiUrl)
        updateSubField('model', entry.modelName)
        setSubSelectedCatalogId(entry.id)
        setSubDirtyKeyFields(prev => { const next = new Set(prev); next.delete('provider'); next.delete('apiUrl'); return next })
      }
    }
  }

  // 高级参数重置
  const resetMainAdvanced = () => {
    setMainModelConfig(prev => ({ ...prev, ...DEFAULT_ADVANCED }))
  }

  const resetSubAdvanced = () => {
    setSubModelConfig(prev => ({ ...prev, ...DEFAULT_ADVANCED }))
  }

  // 变化检测
  const hasConfigChanges = (config: ModelConfig, saved: ModelConfig | null, isSub = false): boolean => {
    if (!saved) return true
    const baseChanges =
      config.provider !== saved.provider ||
      config.apiUrl !== saved.apiUrl ||
      config.apiKey !== saved.apiKey ||
      config.model !== saved.model ||
      config.timeout !== saved.timeout ||
      config.maxRetries !== saved.maxRetries ||
      (config.contextLength ?? -1) !== (saved.contextLength ?? -1) ||
      JSON.stringify(config.accessModes ?? null) !== JSON.stringify(saved.accessModes ?? null) ||
      config.enableVision !== saved.enableVision
    if (!isSub && config.maxIterations !== saved.maxIterations) return true
    return baseChanges
  }

  const hasEmailChanges = (): boolean => {
    if (emailEnabled !== emailSavedEnabled) return true
    if (!emailEnabled && !emailSavedEnabled) return false
    return emailAddress !== '' || imapHost !== '' || smtpHost !== ''
  }

  const canApply = (): boolean => {
    const mainHasChanges = hasConfigChanges(mainModelConfig, savedMainConfig)
    const subHasChanges = hasConfigChanges(subModelConfig, savedSubConfig, true)
    const langHasChanges = currentLang !== savedLang
    const emailHasChanges = hasEmailChanges()
    if (!mainHasChanges && !subHasChanges && !langHasChanges && !emailHasChanges) return false
    if (mainDirtyKeyFields.size > 0 && mainTestStatus !== 'success') return false
    if (subDirtyKeyFields.size > 0 && subTestStatus !== 'success') return false
    return true
  }

  // 通用模型测试
  const runModelTest = async (
    config: ModelConfig,
    setStatus: (s: 'idle' | 'testing' | 'success' | 'error') => void,
    setResult: (r: string) => void,
    setConfig: React.Dispatch<React.SetStateAction<ModelConfig>>
  ) => {
    try {
      const result = await window.electronAPI.config.testModel({
        provider: config.provider, apiUrl: config.apiUrl,
        apiKey: config.apiKey, model: config.model,
      })
      if (result.success) {
        setStatus('success')
        const parts: string[] = [t('common.testSuccess')]
        if (result.supportsInvoke) parts.push(t('settings.supportInvoke'))
        if (result.supportsStream) parts.push(t('settings.supportStream'))
        if (result.supportsVision !== undefined) parts.push(result.supportsVision ? t('settings.supportVision') : t('settings.notSupportVision'))
        if (result.contextLength) parts.push(`${t('settings.contextWindow')}: ${result.contextLength} token`)
        setResult(parts.join('，'))
        const modes: string[] = []
        if (result.supportsInvoke) modes.push('invoke')
        if (result.supportsStream) modes.push('stream')
        setConfig(prev => ({
          ...prev,
          accessModes: modes,
          contextLength: (result.contextLength && result.contextLength > 0) ? result.contextLength : prev.contextLength,
          enableVision: result.supportsVision !== undefined ? result.supportsVision : (prev.enableVision !== undefined ? prev.enableVision : true),
        }))
      } else {
        setStatus('error')
        setResult(result.error || t('settings.testFailed'))
      }
    } catch (err) {
      setStatus('error')
      setResult(err instanceof Error ? err.message : t('settings.testFailed'))
    }
  }

  const handleMainTest = async () => {
    if (!mainModelConfig.apiUrl || !mainModelConfig.apiKey || !mainModelConfig.model) {
      setMainTestStatus('error')
      setMainTestResult(t('settings.validationFillFields'))
      return
    }
    setMainTestStatus('testing')
    setMainTestResult(t('settings.testingConnection'))
    await runModelTest(mainModelConfig, setMainTestStatus, setMainTestResult, setMainModelConfig)
  }

  const handleSubTest = async () => {
    if (!subModelConfig.apiUrl || !subModelConfig.apiKey || !subModelConfig.model) {
      setSubTestStatus('error')
      setSubTestResult(t('settings.validationFillFields'))
      return
    }
    setSubTestStatus('testing')
    setSubTestResult(t('settings.testingConnection'))
    await runModelTest(subModelConfig, setSubTestStatus, setSubTestResult, setSubModelConfig)
  }

  const handleEmailTest = async () => {
    if (!emailAddress || !appPassword) {
      setEmailTestStatus('error')
      setEmailTestResult(t('settings.emailValidationFillFields'))
      return
    }
    setEmailTestStatus('testing')
    setEmailTestResult(t('settings.testingConnection'))
    try {
      const result = await window.electronAPI.config.testEmail({
        imapHost, imapPort, imapSecure,
        smtpHost, smtpPort, smtpSecure,
        email: emailAddress, appPassword,
      })
      if (result.success) {
        setEmailTestStatus('success')
        setEmailTestResult(result.message || t('settings.emailTestSuccess'))
      } else {
        setEmailTestStatus('error')
        setEmailTestResult(result.error || t('settings.emailTestFailed'))
      }
    } catch (err) {
      setEmailTestStatus('error')
      setEmailTestResult(err instanceof Error ? err.message : t('settings.emailTestFailed'))
    }
  }

  const handleApply = async () => {
    try {
      const mainToSave = { ...mainModelConfig }
      if (mainToSave.timeout) mainToSave.timeout = mainToSave.timeout * 1000
      await window.electronAPI.config.save('agentConfig', mainToSave)
      setSavedMainConfig({ ...mainModelConfig })
      setMainDirtyKeyFields(new Set())

      const subToSave = { ...subModelConfig }
      if (subToSave.timeout) subToSave.timeout = subToSave.timeout * 1000
      await window.electronAPI.config.save('subAgentConfig', subToSave)
      setSavedSubConfig({ ...subModelConfig })
      setSubDirtyKeyFields(new Set())

      if (currentLang !== savedLang) {
        await setGlobalLanguage(currentLang)
        setSavedLang(currentLang)
      }

      await window.electronAPI.config.save('emailConfig', {
        enabled: emailEnabled,
        account: emailEnabled ? {
          email: emailAddress, displayName, appPassword,
          imapHost, imapPort, imapSecure,
          smtpHost, smtpPort, smtpSecure,
        } : null,
      })
      setEmailSavedEnabled(emailEnabled)
    } catch (err) {
      setMainTestStatus('error')
      setMainTestResult(err instanceof Error ? err.message : t('settings.saveFailed'))
    }
  }

  return {
    activeCategory, setActiveCategory,
    agentEnabled, setAgentEnabled,
    mainModelConfig, savedMainConfig, mainAdvancedOpen, setMainAdvancedOpen,
    mainTestStatus, mainTestResult, mainDirtyKeyFields, mainSelectedCatalogId,
    subModelConfig, savedSubConfig, subAdvancedOpen, setSubAdvancedOpen,
    subTestStatus, subTestResult, subDirtyKeyFields, subSelectedCatalogId,
    modelCatalog,
    currentLang, setCurrentLang, savedLang,
    emailEnabled, setEmailEnabled,
    selectedProvider, setSelectedProvider,
    emailAddress, setEmailAddress,
    displayName, setDisplayName,
    appPassword, setAppPassword,
    imapHost, setImapHost,
    imapPort, setImapPort,
    imapSecure, setImapSecure,
    smtpHost, setSmtpHost,
    smtpPort, setSmtpPort,
    smtpSecure, setSmtpSecure,
    emailTestStatus, emailTestResult,
    updateMainField, updateSubField,
    handleMainCatalogChange, handleSubCatalogChange,
    handleMainTest, handleSubTest, handleEmailTest, handleApply,
    canApply, resetMainAdvanced, resetSubAdvanced,
  }
}
