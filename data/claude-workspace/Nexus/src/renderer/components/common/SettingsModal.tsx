/**
 * 设置对话框组件
 *
 * 职责：提供应用设置项的 UI，包含左侧分类导航和右侧内容区。
 * 当前支持：模型配置（智能体起停、主模型配置、高级参数）。
 *
 * 保存模式：手动保存。修改字段后需点击"应用"按钮才保存到数据库。
 * 修改关键字段（提供商/API地址/模型名称）后，必须先通过"测试"验证才能点击"应用"。
 */

import React, { useEffect, useState } from 'react'
import { useAppStore, captureAllBrowsersBeforeModal, clearAllBrowserSnapshots } from '../../store'

/** 设置分类 */
type SettingsCategory = 'mainModel' | 'subModel'

/** 模型配置接口（复用 AgentConfig 的子集） */
interface ModelConfig {
  provider: 'openai' | 'anthropic'
  apiUrl: string
  apiKey: string
  model: string
  maxIterations?: number
  timeout?: number
  maxRetries?: number
  contextLength?: number
  accessModes?: string[]  // 支持的访问方式：'stream' | 'invoke'
  enableVision?: boolean  // 是否启用图片识别（视觉）
}

/** 关键字段（修改后必须先测试才能应用） */
const KEY_FIELDS: (keyof ModelConfig)[] = ['provider', 'apiUrl', 'model']

export function SettingsModal() {
  const { settingsModalVisible, setSettingsModalVisible, agentEnabled, setAgentEnabled } = useAppStore()

  /** 当前选中的分类 */
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('mainModel')

  /** 已保存的配置（从 DB 加载） */
  const [savedMainConfig, setSavedMainConfig] = useState<ModelConfig | null>(null)
  const [savedSubConfig, setSavedSubConfig] = useState<ModelConfig | null>(null)

  /** 当前编辑中的配置（草稿） */
  const [mainModelConfig, setMainModelConfig] = useState<ModelConfig>({
    provider: 'openai',
    apiUrl: '',
    apiKey: '',
    model: '',
  })
  const [subModelConfig, setSubModelConfig] = useState<ModelConfig>({
    provider: 'openai',
    apiUrl: '',
    apiKey: '',
    model: '',
  })

  /** 高级参数展开/折叠 */
  const [mainAdvancedOpen, setMainAdvancedOpen] = useState(false)
  const [subAdvancedOpen, setSubAdvancedOpen] = useState(false)

  /** 测试状态（主模型） */
  const [mainTestStatus, setMainTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [mainTestResult, setMainTestResult] = useState('')

  /** 测试状态（副模型） */
  const [subTestStatus, setSubTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [subTestResult, setSubTestResult] = useState('')

  /** 脏检测：主模型关键字段 */
  const [mainDirtyKeyFields, setMainDirtyKeyFields] = useState<Set<string>>(new Set())
  /** 脏检测：副模型关键字段 */
  const [subDirtyKeyFields, setSubDirtyKeyFields] = useState<Set<string>>(new Set())

  /** 弹窗打开时截图占位 + 加载模型配置 */
  useEffect(() => {
    if (settingsModalVisible) {
      captureAllBrowsersBeforeModal()
      // 从持久化存储加载主模型配置
      window.electronAPI.config.get('agentConfig').then((config: ModelConfig | null) => {
        if (config) {
          const loaded: ModelConfig = {
            provider: config.provider || 'openai',
            apiUrl: config.apiUrl || '',
            apiKey: config.apiKey || '',
            model: config.model || '',
            maxIterations: config.maxIterations,
            timeout: config.timeout,
            maxRetries: config.maxRetries,
            contextLength: config.contextLength,
            accessModes: config.accessModes,
            enableVision: config.enableVision !== undefined ? config.enableVision : true,
          }
          setSavedMainConfig({ ...loaded })
          setMainModelConfig(loaded)
        } else {
          setSavedMainConfig(null)
          setMainModelConfig({
            provider: 'openai',
            apiUrl: '',
            apiKey: '',
            model: '',
            enableVision: true,
          })
        }
      }).catch(() => {})
      // 从持久化存储加载副模型配置
      window.electronAPI.config.get('subAgentConfig').then((config: ModelConfig | null) => {
        if (config) {
          const loaded: ModelConfig = {
            provider: config.provider || 'openai',
            apiUrl: config.apiUrl || '',
            apiKey: config.apiKey || '',
            model: config.model || '',
            timeout: config.timeout,
            maxRetries: config.maxRetries,
            contextLength: config.contextLength,
            accessModes: config.accessModes,
          }
          setSavedSubConfig({ ...loaded })
          setSubModelConfig(loaded)
        } else {
          setSavedSubConfig(null)
          setSubModelConfig({
            provider: 'openai',
            apiUrl: '',
            apiKey: '',
            model: '',
          })
        }
      }).catch(() => {})
      setMainAdvancedOpen(false)
      setSubAdvancedOpen(false)
      setMainTestStatus('idle')
      setMainTestResult('')
      setSubTestStatus('idle')
      setSubTestResult('')
      setMainDirtyKeyFields(new Set())
      setSubDirtyKeyFields(new Set())
    } else {
      clearAllBrowserSnapshots()
    }
  }, [settingsModalVisible])

  /** 键盘事件: Esc 关闭 */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!settingsModalVisible) return
      if (e.key === 'Escape') {
        e.preventDefault()
        setSettingsModalVisible(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [settingsModalVisible, setSettingsModalVisible])

  /** 高级参数默认值 */
  const DEFAULT_ADVANCED = { maxIterations: 90, timeout: 600000, maxRetries: 3, contextLength: 128000 }

  /** 恢复主模型高级参数为默认值 */
  const resetMainAdvanced = () => {
    const next = { ...mainModelConfig, ...DEFAULT_ADVANCED }
    setMainModelConfig(next)
  }

  /** 恢复副模型高级参数为默认值 */
  const resetSubAdvanced = () => {
    const next = { ...subModelConfig, ...DEFAULT_ADVANCED }
    setSubModelConfig(next)
  }

  /** 更新主模型配置字段 */
  const updateMainField = <K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) => {
    setMainModelConfig(prev => ({ ...prev, [key]: value }))
    if (KEY_FIELDS.includes(key)) {
      setMainDirtyKeyFields(prev => {
        const next = new Set(prev)
        next.add(key)
        return next
      })
      setMainTestStatus('idle')
      setMainTestResult('')
    }
  }

  /** 更新副模型配置字段 */
  const updateSubField = <K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) => {
    setSubModelConfig(prev => ({ ...prev, [key]: value }))
    if (KEY_FIELDS.includes(key)) {
      setSubDirtyKeyFields(prev => {
        const next = new Set(prev)
        next.add(key)
        return next
      })
      setSubTestStatus('idle')
      setSubTestResult('')
    }
  }

  /** 检测"应用"按钮是否应该启用（任一配置有未保存更改即可） */
  const canApply = (): boolean => {
    const mainHasChanges = hasConfigChanges(mainModelConfig, savedMainConfig)
    const subHasChanges = hasConfigChanges(subModelConfig, savedSubConfig, true)

    if (!mainHasChanges && !subHasChanges) return false

    // 主模型关键字段有脏数据且未测试通过
    if (mainDirtyKeyFields.size > 0 && mainTestStatus !== 'success') return false
    // 副模型关键字段有脏数据且未测试通过
    if (subDirtyKeyFields.size > 0 && subTestStatus !== 'success') return false

    return true
  }

  /** 检测配置是否有变化 */
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

    // 主模型额外检查 maxIterations
    if (!isSub && config.maxIterations !== saved.maxIterations) return true

    return baseChanges
  }

  /** 测试主模型连接 */
  const handleMainTest = async () => {
    if (!mainModelConfig.apiUrl || !mainModelConfig.apiKey || !mainModelConfig.model) {
      setMainTestStatus('error')
      setMainTestResult('请填写 API 地址、API 密钥和模型名称')
      return
    }
    setMainTestStatus('testing')
    setMainTestResult('正在测试连接...')
    await runModelTest(mainModelConfig, setMainTestStatus, setMainTestResult, setMainModelConfig)
  }

  /** 测试副模型连接 */
  const handleSubTest = async () => {
    if (!subModelConfig.apiUrl || !subModelConfig.apiKey || !subModelConfig.model) {
      setSubTestStatus('error')
      setSubTestResult('请填写 API 地址、API 密钥和模型名称')
      return
    }
    setSubTestStatus('testing')
    setSubTestResult('正在测试连接...')
    await runModelTest(subModelConfig, setSubTestStatus, setSubTestResult, setSubModelConfig)
  }

  /** 通用模型测试逻辑 */
  const runModelTest = async (
    config: ModelConfig,
    setStatus: (s: 'idle' | 'testing' | 'success' | 'error') => void,
    setResult: (r: string) => void,
    setConfig: React.Dispatch<React.SetStateAction<ModelConfig>>
  ) => {
    try {
      const result = await window.electronAPI.config.testModel({
        provider: config.provider,
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        model: config.model,
      })
      if (result.success) {
        setStatus('success')
        const parts: string[] = ['连接成功']
        if (result.supportsInvoke) parts.push('支持 invoke')
        if (result.supportsStream) parts.push('支持 stream')
        if (result.supportsVision !== undefined) parts.push(result.supportsVision ? '支持视觉' : '不支持视觉')
        if (result.contextLength) parts.push(`上下文窗口: ${result.contextLength} token`)
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
        setResult(result.error || '测试失败')
      }
    } catch (err) {
      setStatus('error')
      setResult(err instanceof Error ? err.message : '测试失败')
    }
  }

  /** 应用配置（保存到数据库） */
  const handleApply = async () => {
    try {
      // 保存主模型配置
      await window.electronAPI.config.save('agentConfig', mainModelConfig)
      setSavedMainConfig({ ...mainModelConfig })
      setMainDirtyKeyFields(new Set())
      // 保存副模型配置
      await window.electronAPI.config.save('subAgentConfig', subModelConfig)
      setSavedSubConfig({ ...subModelConfig })
      setSubDirtyKeyFields(new Set())
      setSettingsModalVisible(false)
    } catch (err) {
      setMainTestStatus('error')
      setMainTestResult(err instanceof Error ? err.message : '保存失败')
    }
  }

  if (!settingsModalVisible) {
    return null
  }

  return (
    <div className="modal-overlay" onClick={() => setSettingsModalVisible(false)}>
      <div className="modal-container settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <svg className="modal-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
          <h3 className="modal-title">设置</h3>
        </div>
        <div className="modal-body settings-body">
          <div className="settings-container">
              {/* 左侧分类导航 */}
              <div className="settings-sidebar">
                <div
                  className={`settings-nav-item ${activeCategory === 'mainModel' ? 'active' : ''}`}
                  onClick={() => setActiveCategory('mainModel')}
                >
                  主模型配置
                </div>
                <div
                  className={`settings-nav-item ${activeCategory === 'subModel' ? 'active' : ''}`}
                  onClick={() => setActiveCategory('subModel')}
                >
                  副模型配置
                </div>
              </div>

              {/* 右侧内容区 */}
              <div className="settings-content">
                {/* ===== 主模型配置 ===== */}
                {activeCategory === 'mainModel' && (
                  <>
                    {/* 智能体开关 */}
                    <div className="setting-item">
                      <div className="setting-label">
                        <div className="setting-label-text">智能体</div>
                        <div className="setting-desc">智能助手启动或关闭</div>
                      </div>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={agentEnabled}
                          onChange={(e) => setAgentEnabled(e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>

                    <div className="setting-divider" />

                    <div className="setting-section-title">模型配置</div>

                    <div className="setting-item">
                      <div className="setting-label">
                        <div className="setting-label-text">提供商</div>
                      </div>
                      <div className="setting-control">
                        <select
                          className="setting-select"
                          value={mainModelConfig.provider}
                          onChange={(e) => updateMainField('provider', e.target.value as 'openai' | 'anthropic')}
                        >
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                        </select>
                      </div>
                    </div>

                    <div className="setting-item">
                      <div className="setting-label">
                        <div className="setting-label-text">API 地址</div>
                        <div className="setting-desc">模型 API 的接口地址</div>
                      </div>
                      <div className="setting-control">
                        <input
                          type="text"
                          className="setting-input"
                          placeholder="https://api.openai.com/v1"
                          value={mainModelConfig.apiUrl}
                          onChange={(e) => updateMainField('apiUrl', e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="setting-item">
                      <div className="setting-label">
                        <div className="setting-label-text">API 密钥</div>
                        <div className="setting-desc">用于身份验证的密钥</div>
                      </div>
                      <div className="setting-control">
                        <input
                          type="password"
                          className="setting-input"
                          placeholder="sk-..."
                          value={mainModelConfig.apiKey}
                          onChange={(e) => updateMainField('apiKey', e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="setting-item">
                      <div className="setting-label">
                        <div className="setting-label-text">模型名称</div>
                        <div className="setting-desc">如 gpt-4o、claude-sonnet-4-6</div>
                      </div>
                      <div className="setting-control">
                        <input
                          type="text"
                          className="setting-input"
                          placeholder="gpt-4o"
                          value={mainModelConfig.model}
                          onChange={(e) => updateMainField('model', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* 测试按钮和结果 */}
                    <div className="setting-item">
                      <div className="setting-label">
                        <div className="setting-label-text">连接测试</div>
                        <div className="setting-desc">测试模型连接是否正常</div>
                      </div>
                      <div className="setting-control">
                        <button
                          className={`btn-test-model ${mainTestStatus === 'testing' ? 'btn-test-loading' : ''}`}
                          onClick={handleMainTest}
                          disabled={mainTestStatus === 'testing'}
                        >
                          {mainTestStatus === 'testing' ? '测试中...' : '测试'}
                        </button>
                      </div>
                    </div>

                    {/* 测试结果显示 */}
                    {mainTestResult && (
                      <div className={`test-result ${mainTestStatus === 'success' ? 'test-result-success' : 'test-result-error'}`}>
                        {mainTestResult}
                      </div>
                    )}

                    {/* 高级参数（可折叠） */}
                    <div className="setting-collapsible">
                      <div className="setting-collapsible-header">
                        <div
                          className="collapsible-title"
                          onClick={() => setMainAdvancedOpen(!mainAdvancedOpen)}
                        >
                          <svg
                            className={`collapsible-arrow ${mainAdvancedOpen ? 'open' : ''}`}
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/>
                          </svg>
                          高级参数
                        </div>
                        <button
                          className="btn-reset-advanced"
                          onClick={resetMainAdvanced}
                          title="恢复默认值"
                        >
                          恢复默认
                        </button>
                      </div>
                      {mainAdvancedOpen && (
                        <div className="setting-collapsible-body">
                          {/* 视觉开关 */}
                          <div className="setting-item">
                            <div className="setting-label">
                              <div className="setting-label-text">视觉</div>
                              <div className="setting-desc">允许附加图片并发送给模型进行识别</div>
                            </div>
                            <div className="setting-control">
                              <label className="toggle-switch">
                                <input
                                  type="checkbox"
                                  checked={mainModelConfig.enableVision !== false}
                                  onChange={(e) => updateMainField('enableVision', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                              </label>
                            </div>
                          </div>

                          <div className="setting-item">
                            <div className="setting-label">
                              <div className="setting-label-text">最大迭代次数</div>
                              <div className="setting-desc">Agent 单次对话的最大循环次数</div>
                            </div>
                            <div className="setting-control setting-control-narrow">
                              <input
                                type="number"
                                className="setting-input"
                                placeholder="90"
                                value={mainModelConfig.maxIterations ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value === '' ? undefined : Number(e.target.value)
                                  updateMainField('maxIterations', v as any)
                                }}
                              />
                            </div>
                          </div>

                          <div className="setting-item">
                            <div className="setting-label">
                              <div className="setting-label-text">超时时间</div>
                              <div className="setting-desc">请求超时时间（毫秒）</div>
                            </div>
                            <div className="setting-control setting-control-narrow">
                              <input
                                type="number"
                                className="setting-input"
                                placeholder="600000"
                                value={mainModelConfig.timeout ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value === '' ? undefined : Number(e.target.value)
                                  updateMainField('timeout', v as any)
                                }}
                              />
                            </div>
                          </div>

                          <div className="setting-item">
                            <div className="setting-label">
                              <div className="setting-label-text">最大重试次数</div>
                              <div className="setting-desc">请求失败后的最大重试次数</div>
                            </div>
                            <div className="setting-control setting-control-narrow">
                              <input
                                type="number"
                                className="setting-input"
                                placeholder="3"
                                value={mainModelConfig.maxRetries ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value === '' ? undefined : Number(e.target.value)
                                  updateMainField('maxRetries', v as any)
                                }}
                              />
                            </div>
                          </div>

                          <div className="setting-item">
                            <div className="setting-label">
                              <div className="setting-label-text">上下文窗口</div>
                              <div className="setting-desc">模型的上下文窗口大小（token 数）</div>
                            </div>
                            <div className="setting-control setting-control-narrow">
                              <input
                                type="number"
                                className="setting-input"
                                placeholder="128000"
                                value={mainModelConfig.contextLength ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value === '' ? undefined : Number(e.target.value)
                                  updateMainField('contextLength', v as any)
                                }}
                              />
                            </div>
                          </div>

                          {/* 访问方式多选 */}
                          <div className="setting-item">
                            <div className="setting-label">
                              <div className="setting-label-text">访问方式</div>
                              <div className="setting-desc">模型支持的调用方式（测试后自动填写）</div>
                            </div>
                            <div className="setting-control setting-control-checkbox">
                              <label className="checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={(mainModelConfig.accessModes ?? []).includes('stream')}
                                  onChange={(e) => {
                                    const modes = mainModelConfig.accessModes ?? []
                                    const next = e.target.checked
                                      ? [...modes, 'stream'].filter((v, i, a) => a.indexOf(v) === i)
                                      : modes.filter(m => m !== 'stream')
                                    updateMainField('accessModes', next)
                                  }}
                                />
                                <span className="checkbox-text">stream</span>
                              </label>
                              <label className="checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={(mainModelConfig.accessModes ?? []).includes('invoke')}
                                  onChange={(e) => {
                                    const modes = mainModelConfig.accessModes ?? []
                                    const next = e.target.checked
                                      ? [...modes, 'invoke'].filter((v, i, a) => a.indexOf(v) === i)
                                      : modes.filter(m => m !== 'invoke')
                                    updateMainField('accessModes', next)
                                  }}
                                />
                                <span className="checkbox-text">invoke</span>
                              </label>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* ===== 副模型配置 ===== */}
                {activeCategory === 'subModel' && (
                  <>
                    <div className="setting-section-title">模型配置</div>

                    <div className="setting-item">
                      <div className="setting-label">
                        <div className="setting-label-text">提供商</div>
                      </div>
                      <div className="setting-control">
                        <select
                          className="setting-select"
                          value={subModelConfig.provider}
                          onChange={(e) => updateSubField('provider', e.target.value as 'openai' | 'anthropic')}
                        >
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                        </select>
                      </div>
                    </div>

                    <div className="setting-item">
                      <div className="setting-label">
                        <div className="setting-label-text">API 地址</div>
                        <div className="setting-desc">模型 API 的接口地址</div>
                      </div>
                      <div className="setting-control">
                        <input
                          type="text"
                          className="setting-input"
                          placeholder="https://api.openai.com/v1"
                          value={subModelConfig.apiUrl}
                          onChange={(e) => updateSubField('apiUrl', e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="setting-item">
                      <div className="setting-label">
                        <div className="setting-label-text">API 密钥</div>
                        <div className="setting-desc">用于身份验证的密钥</div>
                      </div>
                      <div className="setting-control">
                        <input
                          type="password"
                          className="setting-input"
                          placeholder="sk-..."
                          value={subModelConfig.apiKey}
                          onChange={(e) => updateSubField('apiKey', e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="setting-item">
                      <div className="setting-label">
                        <div className="setting-label-text">模型名称</div>
                        <div className="setting-desc">如 gpt-4o、claude-sonnet-4-6</div>
                      </div>
                      <div className="setting-control">
                        <input
                          type="text"
                          className="setting-input"
                          placeholder="gpt-4o"
                          value={subModelConfig.model}
                          onChange={(e) => updateSubField('model', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* 测试按钮和结果 */}
                    <div className="setting-item">
                      <div className="setting-label">
                        <div className="setting-label-text">连接测试</div>
                        <div className="setting-desc">测试模型连接是否正常</div>
                      </div>
                      <div className="setting-control">
                        <button
                          className={`btn-test-model ${subTestStatus === 'testing' ? 'btn-test-loading' : ''}`}
                          onClick={handleSubTest}
                          disabled={subTestStatus === 'testing'}
                        >
                          {subTestStatus === 'testing' ? '测试中...' : '测试'}
                        </button>
                      </div>
                    </div>

                    {/* 测试结果显示 */}
                    {subTestResult && (
                      <div className={`test-result ${subTestStatus === 'success' ? 'test-result-success' : 'test-result-error'}`}>
                        {subTestResult}
                      </div>
                    )}

                    {/* 高级参数（可折叠） */}
                    <div className="setting-collapsible">
                      <div className="setting-collapsible-header">
                        <div
                          className="collapsible-title"
                          onClick={() => setSubAdvancedOpen(!subAdvancedOpen)}
                        >
                          <svg
                            className={`collapsible-arrow ${subAdvancedOpen ? 'open' : ''}`}
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/>
                          </svg>
                          高级参数
                        </div>
                        <button
                          className="btn-reset-advanced"
                          onClick={resetSubAdvanced}
                          title="恢复默认值"
                        >
                          恢复默认
                        </button>
                      </div>
                      {subAdvancedOpen && (
                        <div className="setting-collapsible-body">
                          {/* 副模型没有"最大迭代次数" */}

                          <div className="setting-item">
                            <div className="setting-label">
                              <div className="setting-label-text">超时时间</div>
                              <div className="setting-desc">请求超时时间（毫秒）</div>
                            </div>
                            <div className="setting-control setting-control-narrow">
                              <input
                                type="number"
                                className="setting-input"
                                placeholder="600000"
                                value={subModelConfig.timeout ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value === '' ? undefined : Number(e.target.value)
                                  updateSubField('timeout', v as any)
                                }}
                              />
                            </div>
                          </div>

                          <div className="setting-item">
                            <div className="setting-label">
                              <div className="setting-label-text">最大重试次数</div>
                              <div className="setting-desc">请求失败后的最大重试次数</div>
                            </div>
                            <div className="setting-control setting-control-narrow">
                              <input
                                type="number"
                                className="setting-input"
                                placeholder="3"
                                value={subModelConfig.maxRetries ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value === '' ? undefined : Number(e.target.value)
                                  updateSubField('maxRetries', v as any)
                                }}
                              />
                            </div>
                          </div>

                          <div className="setting-item">
                            <div className="setting-label">
                              <div className="setting-label-text">上下文窗口</div>
                              <div className="setting-desc">模型的上下文窗口大小（token 数）</div>
                            </div>
                            <div className="setting-control setting-control-narrow">
                              <input
                                type="number"
                                className="setting-input"
                                placeholder="128000"
                                value={subModelConfig.contextLength ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value === '' ? undefined : Number(e.target.value)
                                  updateSubField('contextLength', v as any)
                                }}
                              />
                            </div>
                          </div>

                          {/* 访问方式多选 */}
                          <div className="setting-item">
                            <div className="setting-label">
                              <div className="setting-label-text">访问方式</div>
                              <div className="setting-desc">模型支持的调用方式（测试后自动填写）</div>
                            </div>
                            <div className="setting-control setting-control-checkbox">
                              <label className="checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={(subModelConfig.accessModes ?? []).includes('stream')}
                                  onChange={(e) => {
                                    const modes = subModelConfig.accessModes ?? []
                                    const next = e.target.checked
                                      ? [...modes, 'stream'].filter((v, i, a) => a.indexOf(v) === i)
                                      : modes.filter(m => m !== 'stream')
                                    updateSubField('accessModes', next)
                                  }}
                                />
                                <span className="checkbox-text">stream</span>
                              </label>
                              <label className="checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={(subModelConfig.accessModes ?? []).includes('invoke')}
                                  onChange={(e) => {
                                    const modes = subModelConfig.accessModes ?? []
                                    const next = e.target.checked
                                      ? [...modes, 'invoke'].filter((v, i, a) => a.indexOf(v) === i)
                                      : modes.filter(m => m !== 'invoke')
                                    updateSubField('accessModes', next)
                                  }}
                                />
                                <span className="checkbox-text">invoke</span>
                              </label>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
        </div>
        <div className="modal-footer">
          <button
            className="modal-btn modal-btn-apply"
            onClick={handleApply}
            disabled={!canApply()}
            title={!canApply() ? ((mainDirtyKeyFields.size > 0 || subDirtyKeyFields.size > 0) ? '修改关键字段后需先通过测试' : '没有未保存的更改') : ''}
          >
            应用
          </button>
          <button className="modal-btn modal-btn-confirm" onClick={() => setSettingsModalVisible(false)} autoFocus>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
