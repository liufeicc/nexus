/**
 * 模型配置面板
 *
 * 参数化组件，通过 props 区分主/副模型。
 */

import React from 'react'
import type { ModelConfig, CatalogEntry } from './use-settings-config'
import { useI18n } from '../../../i18n'

interface ModelConfigPanelProps {
  config: ModelConfig
  onUpdateField: <K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) => void
  catalog: CatalogEntry[]
  selectedCatalogId: number | null
  onCatalogChange: (id: number | null) => void
  testStatus: 'idle' | 'testing' | 'success' | 'error'
  testResult: string
  onTest: () => void
  advancedOpen: boolean
  onAdvancedToggle: (open: boolean) => void
  onResetAdvanced: () => void
  showMaxIterations?: boolean
  showVisionToggle?: boolean
}

export function ModelConfigPanel({
  config, onUpdateField, catalog, selectedCatalogId, onCatalogChange,
  testStatus, testResult, onTest,
  advancedOpen, onAdvancedToggle, onResetAdvanced,
  showMaxIterations, showVisionToggle,
}: ModelConfigPanelProps) {
  const { t } = useI18n()

  return (
    <>
      {/* 模型选择下拉框 */}
      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.modelCatalog')}</div>
          <div className="setting-desc">{t('settings.modelCatalogDesc')}</div>
        </div>
        <div className="setting-control">
          <select
            className="setting-select"
            value={selectedCatalogId ?? ''}
            onChange={(e) => {
              const val = e.target.value
              onCatalogChange(val === '' ? null : Number(val))
            }}
          >
            {catalog.map(m => (
              <option key={m.id} value={m.id}>{m.displayName}</option>
            ))}
            <option value="">{t('settings.customModel')}</option>
          </select>
        </div>
      </div>

      {/* 接口类型 */}
      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.interfaceType')}</div>
        </div>
        <div className="setting-control">
          <select
            className="setting-select"
            value={config.provider}
            onChange={(e) => onUpdateField('provider', e.target.value)}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
      </div>

      {/* API 地址 */}
      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.apiUrl')}</div>
          <div className="setting-desc">{t('settings.apiUrlDesc')}</div>
        </div>
        <div className="setting-control">
          <input
            type="text"
            className="setting-input"
            placeholder="https://api.openai.com/v1"
            value={config.apiUrl}
            onChange={(e) => onUpdateField('apiUrl', e.target.value)}
          />
        </div>
      </div>

      {/* API Key */}
      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.apiKey')}</div>
          <div className="setting-desc">{t('settings.apiKeyDesc')}</div>
        </div>
        <div className="setting-control">
          <input
            type="password"
            className="setting-input"
            placeholder="sk-..."
            value={config.apiKey}
            onChange={(e) => onUpdateField('apiKey', e.target.value)}
          />
        </div>
      </div>

      {/* 模型名称 */}
      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.modelName')}</div>
          <div className="setting-desc">{t('settings.modelNameDesc')}</div>
        </div>
        <div className="setting-control">
          <input
            type="text"
            className="setting-input"
            placeholder="gpt-4o"
            value={config.model}
            onChange={(e) => onUpdateField('model', e.target.value)}
          />
        </div>
      </div>

      {/* 测试按钮和结果 */}
      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.connectionTest')}</div>
          <div className="setting-desc">{t('settings.connectionTestDesc')}</div>
        </div>
        <div className="setting-control">
          <button
            className={`btn-test-model ${testStatus === 'testing' ? 'btn-test-loading' : ''}`}
            onClick={onTest}
            disabled={testStatus === 'testing'}
          >
            {testStatus === 'testing' ? t('common.testing') : t('common.test')}
          </button>
        </div>
      </div>

      {testResult && (
        <div className={`test-result ${testStatus === 'success' ? 'test-result-success' : 'test-result-error'}`}>
          {testResult}
        </div>
      )}

      {/* 高级参数（可折叠） */}
      <div className="setting-collapsible">
        <div className="setting-collapsible-header">
          <div
            className="collapsible-title"
            onClick={() => onAdvancedToggle(!advancedOpen)}
          >
            <svg
              className={`collapsible-arrow ${advancedOpen ? 'open' : ''}`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/>
            </svg>
            {t('settings.advancedParams')}
          </div>
          <button
            className="btn-reset-advanced"
            onClick={onResetAdvanced}
            title={t('settings.restoreDefault')}
          >
            {t('settings.restoreDefault')}
          </button>
        </div>
        {advancedOpen && (
          <div className="setting-collapsible-body">
            {/* 最大迭代次数（仅主模型） */}
            {showMaxIterations && (
              <div className="setting-item">
                <div className="setting-label">
                  <div className="setting-label-text">{t('settings.maxIterations')}</div>
                  <div className="setting-desc">{t('settings.maxIterationsDesc')}</div>
                </div>
                <div className="setting-control setting-control-narrow">
                  <input
                    type="number"
                    className="setting-input"
                    placeholder="200"
                    value={config.maxIterations ?? ''}
                    onChange={(e) => {
                      const v = e.target.value === '' ? undefined : Number(e.target.value)
                      onUpdateField('maxIterations', v as any)
                    }}
                  />
                </div>
              </div>
            )}

            {/* 超时 */}
            <div className="setting-item">
              <div className="setting-label">
                <div className="setting-label-text">{t('settings.timeout')}</div>
                <div className="setting-desc">{t('settings.timeoutDesc')}</div>
              </div>
              <div className="setting-control setting-control-narrow">
                <input
                  type="number"
                  className="setting-input"
                  placeholder="600"
                  value={config.timeout ?? ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? undefined : Number(e.target.value)
                    onUpdateField('timeout', v as any)
                  }}
                />
              </div>
            </div>

            {/* 最大重试 */}
            <div className="setting-item">
              <div className="setting-label">
                <div className="setting-label-text">{t('settings.maxRetries')}</div>
                <div className="setting-desc">{t('settings.maxRetriesDesc')}</div>
              </div>
              <div className="setting-control setting-control-narrow">
                <input
                  type="number"
                  className="setting-input"
                  placeholder="3"
                  value={config.maxRetries ?? ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? undefined : Number(e.target.value)
                    onUpdateField('maxRetries', v as any)
                  }}
                />
              </div>
            </div>

            {/* 上下文窗口 */}
            <div className="setting-item">
              <div className="setting-label">
                <div className="setting-label-text">{t('settings.contextWindow')}</div>
                <div className="setting-desc">{t('settings.contextWindowDesc')}</div>
              </div>
              <div className="setting-control setting-control-narrow">
                <input
                  type="number"
                  className="setting-input"
                  placeholder="128000"
                  value={config.contextLength ?? ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? undefined : Number(e.target.value)
                    onUpdateField('contextLength', v as any)
                  }}
                />
              </div>
            </div>

            {/* 访问方式 */}
            <div className="setting-item">
              <div className="setting-label">
                <div className="setting-label-text">{t('settings.accessModes')}</div>
                <div className="setting-desc">{t('settings.accessModesDesc')}</div>
              </div>
              <div className="setting-control setting-control-checkbox">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={(config.accessModes ?? []).includes('stream')}
                    onChange={(e) => {
                      const modes = config.accessModes ?? []
                      const next = e.target.checked
                        ? [...modes, 'stream'].filter((v, i, a) => a.indexOf(v) === i)
                        : modes.filter(m => m !== 'stream')
                      onUpdateField('accessModes', next)
                    }}
                  />
                  <span className="checkbox-text">stream</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={(config.accessModes ?? []).includes('invoke')}
                    onChange={(e) => {
                      const modes = config.accessModes ?? []
                      const next = e.target.checked
                        ? [...modes, 'invoke'].filter((v, i, a) => a.indexOf(v) === i)
                        : modes.filter(m => m !== 'invoke')
                      onUpdateField('accessModes', next)
                    }}
                  />
                  <span className="checkbox-text">invoke</span>
                </label>
              </div>
            </div>

            {/* 视觉开关（仅主模型） */}
            {showVisionToggle && (
              <div className="setting-item">
                <div className="setting-label">
                  <div className="setting-label-text">{t('settings.vision')}</div>
                  <div className="setting-desc">{t('settings.visionDesc')}</div>
                </div>
                <div className="setting-control">
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={config.enableVision !== false}
                      onChange={(e) => onUpdateField('enableVision', e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
