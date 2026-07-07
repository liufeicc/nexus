/**
 * 引导窗口组件
 *
 * 职责：首次启动时引导用户配置主副模型的 API 信息和电子邮件
 * 保存时自动验证必填字段并测试连接，显示测试结果后进入主界面
 */

import React, { useState, useCallback, useEffect } from 'react'
import logoImg from '../../assets/1.png'
import '../../styles/onboarding.css'
import { initLanguage, useI18n } from '../../i18n'

/** 模型目录条目 */
interface CatalogEntry {
  id: number
  displayName: string
  modelName: string
  provider: string
  interfaceType: string
  defaultApiUrl: string
  contextLength: number
  description: string | null
  sortWeight: number
}

/** 模型配置（仅必填字段） */
interface ModelConfig {
  provider: string
  apiUrl: string
  apiKey: string
  model: string
}

/** 邮件配置 */
interface EmailConfig {
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

/** 测试结果 */
interface TestResult {
  success: boolean
  supportsInvoke?: boolean
  supportsStream?: boolean
  supportsVision?: boolean
  contextLength?: number
  error?: string
}

/** 邮件测试结果 */
interface EmailTestResult {
  success: boolean
  message?: string
  error?: string
}

/** 测试状态 */
type TestStatus = 'idle' | 'testing' | 'done'

/** 邮件配置步骤 */
type EmailStep = 'hidden' | 'visible'

const DEFAULT_CONFIG: ModelConfig = {
  provider: 'openai',
  apiUrl: '',
  apiKey: '',
  model: '',
}

/** 邮件服务商预设 */
const EMAIL_PRESETS: Record<string, { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }> = {
  gmail: { imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465 },
  qq: { imapHost: 'imap.qq.com', imapPort: 993, smtpHost: 'smtp.qq.com', smtpPort: 465 },
  '163': { imapHost: 'imap.163.com', imapPort: 993, smtpHost: 'smtp.163.com', smtpPort: 465 },
  outlook: { imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587 },
}

export function OnboardingWindow() {
  // 初始化语言
  const [langReady, setLangReady] = useState(false)
  useEffect(() => {
    initLanguage().then(() => setLangReady(true))
  }, [])

  const { t } = useI18n()

  // 引导步骤
  const [step, setStep] = useState<'welcome' | 'config' | 'testing'>('welcome')

  // 主模型配置
  const [mainConfig, setMainConfig] = useState<ModelConfig>({ ...DEFAULT_CONFIG })
  // 副模型配置
  const [subConfig, setSubConfig] = useState<ModelConfig>({ ...DEFAULT_CONFIG })

  // 模型目录
  const [modelCatalog, setModelCatalog] = useState<CatalogEntry[]>([])
  const [mainSelectedCatalogId, setMainSelectedCatalogId] = useState<number | null>(null)
  const [subSelectedCatalogId, setSubSelectedCatalogId] = useState<number | null>(null)

  // 加载模型目录
  useEffect(() => {
    if (window.electronAPI?.config?.getModelCatalog) {
      window.electronAPI.config.getModelCatalog().then((data) => {
        setModelCatalog(data)
        // 默认选中第1个模型并自动填充
        const first = data[0]
        if (first) {
          setMainConfig({ provider: first.interfaceType, apiUrl: first.defaultApiUrl, apiKey: '', model: first.modelName })
          setSubConfig({ provider: first.interfaceType, apiUrl: first.defaultApiUrl, apiKey: '', model: first.modelName })
          setMainSelectedCatalogId(first.id)
          setSubSelectedCatalogId(first.id)
        }
      }).catch((err) => {
        console.error('[Onboarding] 加载模型目录失败:', err)
      })
    }
  }, [])

  // 测试结果状态
  const [mainTest, setMainTest] = useState<TestResult | null>(null)
  const [subTest, setSubTest] = useState<TestResult | null>(null)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')

  // 邮件配置步骤：hidden=隐藏, visible=显示
  const [emailStep, setEmailStep] = useState<EmailStep>('hidden')

  // 邮件配置状态
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [emailProvider, setEmailProvider] = useState('163')
  const [emailAddress, setEmailAddress] = useState('')
  const [emailDisplayName, setEmailDisplayName] = useState('')
  const [emailAppPassword, setEmailAppPassword] = useState('')
  const [emailImapHost, setEmailImapHost] = useState('')
  const [emailImapPort, setEmailImapPort] = useState(993)
  const [emailImapSecure, setEmailImapSecure] = useState(true)
  const [emailSmtpHost, setEmailSmtpHost] = useState('')
  const [emailSmtpPort, setEmailSmtpPort] = useState(465)
  const [emailSmtpSecure, setEmailSmtpSecure] = useState(true)
  const [emailTestStatus, setEmailTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [emailTestResult, setEmailTestResult] = useState<EmailTestResult | null>(null)

  // 验证错误
  const [validationError, setValidationError] = useState('')

  // 更新主模型字段
  const updateMain = useCallback((updates: Partial<ModelConfig>) => {
    setMainConfig(prev => ({ ...prev, ...updates }))
    setValidationError('')
  }, [])

  // 更新副模型字段
  const updateSub = useCallback((updates: Partial<ModelConfig>) => {
    setSubConfig(prev => ({ ...prev, ...updates }))
    setValidationError('')
  }, [])

  // 测试单个模型
  const testModel = useCallback(async (config: ModelConfig): Promise<TestResult> => {
    const result = await window.electronAPI.config.testModel({
      provider: config.provider,
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      model: config.model,
    })
    return result
  }, [])

  // 格式化测试结果为中文描述
  const formatTestResult = useCallback((result: TestResult): string => {
    if (!result.success) return result.error || t('settings.testFailed')
    const parts: string[] = [t('common.testSuccess')]
    if (result.supportsInvoke) parts.push(t('settings.supportInvoke'))
    if (result.supportsStream) parts.push(t('settings.supportStream'))
    if (result.supportsVision !== undefined) parts.push(result.supportsVision ? t('settings.supportVision') : t('settings.notSupportVision'))
    if (result.contextLength) parts.push(`${t('settings.contextWindow')}: ${result.contextLength} token`)
    return parts.join('，')
  }, [])

  // 选择邮件服务商时自动填充
  const handleEmailProviderChange = useCallback((provider: string) => {
    setEmailProvider(provider)
    if (provider === 'custom') {
      setEmailImapHost('')
      setEmailSmtpHost('')
      return
    }
    const preset = EMAIL_PRESETS[provider]
    if (preset) {
      setEmailImapHost(preset.imapHost)
      setEmailImapPort(preset.imapPort)
      setEmailSmtpHost(preset.smtpHost)
      setEmailSmtpPort(preset.smtpPort)
    }
  }, [])

  // 测试邮件连接
  const handleEmailTest = useCallback(async () => {
    if (!emailAddress || !emailAppPassword || !emailImapHost || !emailSmtpHost) {
      setEmailTestStatus('error')
      setEmailTestResult({ success: false, error: t('email.emailValidationFillFields') })
      return
    }
    setEmailTestStatus('testing')
    setEmailTestResult(null)
    try {
      const result = await window.electronAPI.config.testEmail({
        imapHost: emailImapHost,
        imapPort: emailImapPort,
        imapSecure: emailImapSecure,
        smtpHost: emailSmtpHost,
        smtpPort: emailSmtpPort,
        smtpSecure: emailSmtpSecure,
        email: emailAddress,
        appPassword: emailAppPassword,
      })
      setEmailTestResult(result)
      if (result.success) {
        setEmailTestStatus('success')
      } else {
        setEmailTestStatus('error')
      }
    } catch (err) {
      setEmailTestStatus('error')
      setEmailTestResult({ success: false, error: String(err) })
    }
  }, [emailAddress, emailAppPassword, emailImapHost, emailImapPort, emailImapSecure, emailSmtpHost, emailSmtpPort, emailSmtpSecure])

  // 获取构建后的邮件配置对象
  const getEmailConfig = useCallback((): EmailConfig | undefined => {
    if (!emailEnabled) return undefined
    return {
      enabled: true,
      account: {
        email: emailAddress,
        appPassword: emailAppPassword,
        imapHost: emailImapHost,
        imapPort: emailImapPort,
        imapSecure: emailImapSecure,
        smtpHost: emailSmtpHost,
        smtpPort: emailSmtpPort,
        smtpSecure: emailSmtpSecure,
        displayName: emailDisplayName || undefined,
      },
    }
  }, [emailEnabled, emailAddress, emailAppPassword, emailImapHost, emailImapPort, emailImapSecure, emailSmtpHost, emailSmtpPort, emailSmtpSecure, emailDisplayName])

  // 验证模型配置并开始测试
  const handleSaveAndContinue = useCallback(async () => {
    setValidationError('')

    // 1. 验证主模型必填
    const mainMissing: string[] = []
    if (!mainConfig.apiUrl) mainMissing.push(t('settings.apiUrl'))
    if (!mainConfig.apiKey) mainMissing.push(t('settings.apiKey'))
    if (!mainConfig.model) mainMissing.push(t('settings.modelName'))
    if (mainMissing.length > 0) {
      setValidationError(t('onboarding.mainModelRequired')?.replace('{fields}', mainMissing.join('、')) || `主模型缺少必填项: ${mainMissing.join('、')}`)
      return
    }

    // 2. 验证副模型必填
    const subMissing: string[] = []
    if (!subConfig.apiUrl) subMissing.push(t('settings.apiUrl'))
    if (!subConfig.apiKey) subMissing.push(t('settings.apiKey'))
    if (!subConfig.model) subMissing.push(t('settings.modelName'))
    if (subMissing.length > 0) {
      setValidationError(t('onboarding.subModelRequired')?.replace('{fields}', subMissing.join('、')) || `副模型缺少必填项: ${subMissing.join('、')}`)
      return
    }

    // 3. 进入测试步骤
    setStep('testing')
    setTestStatus('testing')
    setMainTest(null)
    setSubTest(null)

    // 4. 并行测试两个模型
    const [mainResult, subResult] = await Promise.all([
      testModel(mainConfig),
      testModel(subConfig),
    ])

    setMainTest(mainResult)
    setSubTest(subResult)
    setTestStatus('done')
  }, [mainConfig, subConfig, testModel])

  // 进入主界面（调用 onboardingComplete）
  const handleEnterApp = useCallback(async () => {
    try {
      // 构建完整的 agentConfig（包含测试结果和默认高级参数）
      const mainModes: string[] = []
      if (mainTest?.supportsInvoke) mainModes.push('invoke')
      if (mainTest?.supportsStream) mainModes.push('stream')

      const subModes: string[] = []
      if (subTest?.supportsInvoke) subModes.push('invoke')
      if (subTest?.supportsStream) subModes.push('stream')

      const fullMainConfig = {
        ...mainConfig,
        maxIterations: 200,
        timeout: 600000,
        maxRetries: 3,
        contextLength: mainTest?.contextLength || undefined,
        accessModes: mainModes,
        enableVision: mainTest?.supportsVision !== undefined ? mainTest.supportsVision : true,
      }

      const fullSubConfig = {
        ...subConfig,
        timeout: 600000,
        maxRetries: 3,
        contextLength: subTest?.contextLength || undefined,
        accessModes: subModes,
        enableVision: subTest?.supportsVision !== undefined ? subTest.supportsVision : true,
      }

      const emailConfig = getEmailConfig()

      await window.electronAPI.onboardingComplete(fullMainConfig as any, fullSubConfig as any, emailConfig as any)
    } catch (err) {
      console.error('[Onboarding] 保存配置失败:', err)
    }
  }, [mainConfig, subConfig, mainTest, subTest, getEmailConfig])

  // 跳过引导
  const handleSkip = useCallback(async () => {
    try {
      await window.electronAPI.onboardingSkip()
    } catch (err) {
      console.error('[Onboarding] 跳过失败:', err)
    }
  }, [])

  // 回到配置页（测试失败时）
  const handleBackToConfig = useCallback(() => {
    setStep('config')
    setTestStatus('idle')
    setMainTest(null)
    setSubTest(null)
    setEmailStep('hidden')
  }, [])

  // ---- 欢迎页 ----
  if (!langReady) {
    return <div className="ob-container" />
  }

  if (step === 'welcome') {
    return (
      <div className="ob-container ob-welcome">
        <div className="ob-logo">
          <img src={logoImg} alt="Nexus Logo" width="100" height="100" />
        </div>
        <h1 className="ob-welcome-title">{t('onboarding.welcomeTitle')}</h1>
        <p className="ob-welcome-desc">
          {t('onboarding.welcomeDesc')}
        </p>
        <div className="ob-welcome-actions">
          <button className="ob-btn ob-btn-primary" onClick={() => setStep('config')}>
            {t('onboarding.startConfig')}
          </button>
          <button className="ob-btn ob-btn-skip" onClick={handleSkip}>
            {t('onboarding.skip')}
          </button>
        </div>
      </div>
    )
  }

  // ---- 测试页 ----
  if (step === 'testing') {
    const allDone = testStatus === 'done'
    const allSuccess = allDone && mainTest?.success && subTest?.success
    const hasError = allDone && (!mainTest?.success || !subTest?.success)

    return (
      <div className="ob-container">
        <div className="ob-header">
          <h2 className="ob-title">{t('onboarding.testingModels')}</h2>
        </div>
        <div className="ob-form">
          {/* 测试中提示 */}
          {!allDone && (
            <div className="ob-testing-indicator">
              <div className="ob-spinner" />
              <span>{t('onboarding.testing')}</span>
            </div>
          )}

          {/* 主模型测试结果 */}
          <div className={`ob-test-card ${mainTest ? (mainTest.success ? 'success' : 'error') : 'pending'}`}>
            <div className="ob-test-card-title">{t('settings.mainModel')}</div>
            {mainTest ? (
              <div className="ob-test-card-result">
                {formatTestResult(mainTest)}
              </div>
            ) : (
              <div className="ob-test-card-pending">{t('onboarding.waiting')}</div>
            )}
          </div>

          {/* 副模型测试结果 */}
          <div className={`ob-test-card ${subTest ? (subTest.success ? 'success' : 'error') : 'pending'}`}>
            <div className="ob-test-card-title">{t('settings.subModel')}</div>
            {subTest ? (
              <div className="ob-test-card-result">
                {formatTestResult(subTest)}
              </div>
            ) : (
              <div className="ob-test-card-pending">{t('onboarding.waiting')}</div>
            )}
          </div>

          {/* 邮件配置（可选，点击"继续"后显示） */}
          {allSuccess && emailStep === 'visible' && (
            <div className="ob-section" style={{ marginTop: 16 }}>
              <div className="ob-section-title-row">
                <div className="ob-section-title">{t('email.email')}</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={emailEnabled}
                    onChange={(e) => setEmailEnabled(e.target.checked)}
                  />
                  {t('email.emailEnabled')}
                </label>
              </div>

              {emailEnabled && (
                <>
                  {/* 服务商选择 */}
                  <div className="ob-field">
                    <label>{t('email.emailProvider')}</label>
                    <select
                      value={emailProvider}
                      onChange={(e) => handleEmailProviderChange(e.target.value)}
                    >
                      <option value="gmail">Gmail</option>
                      <option value="qq">QQ 邮箱</option>
                      <option value="163">163 邮箱</option>
                      <option value="outlook">Outlook</option>
                      <option value="custom">{t('email.providerCustom')}</option>
                    </select>
                  </div>

                  {/* 邮箱地址 */}
                  <div className="ob-field">
                    <label>{t('email.emailAddress')}</label>
                    <input
                      type="text"
                      value={emailAddress}
                      onChange={(e) => setEmailAddress(e.target.value)}
                    />
                  </div>

                  {/* 显示名称 */}
                  <div className="ob-field">
                    <label>{t('email.displayName')}</label>
                    <input
                      type="text"
                      value={emailDisplayName}
                      placeholder={t('email.displayName')}
                      onChange={(e) => setEmailDisplayName(e.target.value)}
                    />
                  </div>

                  {/* 授权码 */}
                  <div className="ob-field">
                    <label>{t('email.appPassword')}</label>
                    <input
                      type="password"
                      value={emailAppPassword}
                      onChange={(e) => setEmailAppPassword(e.target.value)}
                    />
                  </div>

                  {/* IMAP 配置 */}
                  <div className="ob-field">
                    <label>{t('email.imapServer')}</label>
                    <input
                      type="text"
                      value={emailImapHost}
                      onChange={(e) => setEmailImapHost(e.target.value)}
                    />
                  </div>
                  <div className="ob-field">
                    <label>{t('email.imapPort')}</label>
                    <input
                      type="number"
                      value={emailImapPort}
                      onChange={(e) => setEmailImapPort(Number(e.target.value))}
                    />
                  </div>

                  {/* SMTP 配置 */}
                  <div className="ob-field">
                    <label>{t('email.smtpServer')}</label>
                    <input
                      type="text"
                      value={emailSmtpHost}
                      onChange={(e) => setEmailSmtpHost(e.target.value)}
                    />
                  </div>
                  <div className="ob-field">
                    <label>{t('email.smtpPort')}</label>
                    <input
                      type="number"
                      value={emailSmtpPort}
                      onChange={(e) => setEmailSmtpPort(Number(e.target.value))}
                    />
                  </div>

                  {/* 测试按钮和结果 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <button
                      className="ob-btn ob-btn-primary"
                      disabled={emailTestStatus === 'testing'}
                      onClick={handleEmailTest}
                    >
                      {emailTestStatus === 'testing' ? t('email.emailTestConnection') + '...' : t('email.emailTestConnection')}
                    </button>
                    {emailTestResult && (
                      <span style={{
                        fontSize: 13,
                        color: emailTestResult.success ? '#38a169' : '#e53e3e',
                      }}>
                        {emailTestResult.success ? t('email.emailTestSuccess') : emailTestResult.error}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 底部按钮 */}
          <div className="ob-footer">
            {hasError && (
              <button className="ob-btn ob-btn-primary" onClick={handleBackToConfig}>
                {t('onboarding.backToConfig')}
              </button>
            )}
            {allSuccess && emailStep === 'hidden' && (
              <button className="ob-btn ob-btn-primary" onClick={() => setEmailStep('visible')}>
                {t('onboarding.continue')}
              </button>
            )}
            {allSuccess && emailStep === 'visible' && (
              <button className="ob-btn ob-btn-primary" onClick={handleEnterApp}>
                {t('onboarding.saveAndContinue')}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ---- 配置页 ----
  return (
    <div className="ob-container">
      {/* 顶部标题栏（无跳过按钮） */}
      <div className="ob-header">
        <h2 className="ob-title">{t('onboarding.configTitle')}</h2>
      </div>

      {/* 配置表单 */}
      <div className="ob-form">
        {/* 验证错误提示 */}
        {validationError && (
          <div className="ob-test-result error" style={{ marginBottom: 16 }}>{validationError}</div>
        )}

        {/* 主模型 */}
        <ModelSection
          label={t('settings.mainModel')}
          config={mainConfig}
          selectedCatalogId={mainSelectedCatalogId}
          catalog={modelCatalog}
          onUpdate={updateMain}
          onCatalogChange={(id) => {
            if (id === null) {
              setMainSelectedCatalogId(null)
            } else {
              const entry = modelCatalog.find(m => m.id === id)!
              updateMain({ provider: entry.interfaceType, apiUrl: entry.defaultApiUrl, model: entry.modelName })
              setMainSelectedCatalogId(id)
            }
          }}
          t={t}
        />

        {/* 副模型 */}
        <ModelSection
          label={t('settings.subModel')}
          config={subConfig}
          selectedCatalogId={subSelectedCatalogId}
          catalog={modelCatalog}
          onUpdate={updateSub}
          onCatalogChange={(id) => {
            if (id === null) {
              setSubSelectedCatalogId(null)
            } else {
              const entry = modelCatalog.find(m => m.id === id)!
              updateSub({ provider: entry.interfaceType, apiUrl: entry.defaultApiUrl, model: entry.modelName })
              setSubSelectedCatalogId(id)
            }
          }}
          t={t}
          onCopyFromMain={() => setSubConfig({ ...mainConfig })}
        />

        {/* 底部按钮 */}
        <div className="ob-footer">
          <button className="ob-btn ob-btn-skip" onClick={handleSkip}>
            {t('onboarding.skipConfig')}
          </button>
          <button className="ob-btn ob-btn-primary" onClick={handleSaveAndContinue}>
            {t('onboarding.saveAndContinue')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 模型配置组件 */
function ModelSection({
  label,
  config,
  selectedCatalogId,
  catalog,
  onUpdate,
  onCatalogChange,
  onCopyFromMain,
  t,
}: {
  label: string
  config: ModelConfig
  selectedCatalogId: number | null
  catalog: CatalogEntry[]
  onUpdate: (updates: Partial<ModelConfig>) => void
  onCatalogChange: (id: number | null) => void
  onCopyFromMain?: () => void
  t: (key: string) => string
}) {
  return (
    <div className="ob-section">
      <div className="ob-section-title-row">
        <div className="ob-section-title">{label}</div>
        {onCopyFromMain && (
          <button className="ob-btn ob-btn-copy" onClick={onCopyFromMain}>
            {t('onboarding.copyFromMain')}
          </button>
        )}
      </div>

      {/* 模型选择下拉框 */}
      <div className="ob-field">
        <label>{t('settings.modelCatalog')}</label>
        <select
          value={selectedCatalogId ?? ''}
          onChange={(e) => {
            const val = e.target.value
            if (val === '') {
              onCatalogChange(null)
            } else {
              onCatalogChange(Number(val))
            }
          }}
        >
          {catalog.map(m => (
            <option key={m.id} value={m.id}>{m.displayName} ({m.modelName})</option>
          ))}
          <option value="">{t('settings.customModel')}</option>
        </select>
      </div>

      {/* 接口类型 */}
      <div className="ob-field">
        <label>{t('settings.interfaceType')}</label>
        <select
          value={config.provider}
          onChange={(e) => onUpdate({ provider: e.target.value })}
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </div>

      {/* API 地址 */}
      <div className="ob-field">
        <label>{t('settings.apiUrl')}</label>
        <input
          type="text"
          value={config.apiUrl}
          placeholder="https://api.openai.com/v1"
          onChange={(e) => onUpdate({ apiUrl: e.target.value })}
        />
      </div>

      {/* API Key */}
      <div className="ob-field">
        <label>{t('settings.apiKey')}</label>
        <input
          type="password"
          value={config.apiKey}
          placeholder="sk-..."
          onChange={(e) => onUpdate({ apiKey: e.target.value })}
        />
      </div>

      {/* 模型名称 */}
      <div className="ob-field">
        <label>{t('settings.modelName')}</label>
        <input
          type="text"
          value={config.model}
          placeholder="gpt-4o"
          onChange={(e) => onUpdate({ model: e.target.value })}
        />
      </div>
    </div>
  )
}
