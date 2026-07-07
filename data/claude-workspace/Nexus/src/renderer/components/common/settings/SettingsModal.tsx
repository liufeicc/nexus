/**
 * 设置对话框外壳组件
 *
 * 职责：模态框布局、侧边栏导航、面板组合。
 * 所有状态和处理器委托给 useSettingsConfig hook。
 */

import React, { useEffect } from 'react'
import { useAppStore, captureAllBrowsersBeforeModal, clearAllBrowserSnapshots } from '../../../store'
import { useSettingsConfig, type SettingsCategory } from './use-settings-config'
import { ModelConfigPanel } from './ModelConfigPanel'
import { LanguagePanel } from './LanguagePanel'
import { EmailConfigPanel } from './EmailConfigPanel'
import { useI18n } from '../../../i18n'

export function SettingsModal() {
  const { settingsModalVisible, setSettingsModalVisible } = useAppStore()
  const { t } = useI18n()

  const config = useSettingsConfig()

  // 打开设置时捕获浏览器快照（useEffect 确保副作用不在渲染阶段执行）
  useEffect(() => {
    if (settingsModalVisible) {
      captureAllBrowsersBeforeModal()
    }
  }, [settingsModalVisible])

  if (!settingsModalVisible) return null

  return (
    <div className="modal-overlay">
      <div className="modal-container settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <svg className="modal-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
          <h3 className="modal-title">{t('settings.title')}</h3>
        </div>
        <div className="modal-body settings-body">
          <div className="settings-container">
            {/* 左侧导航 */}
            <div className="settings-sidebar">
              <div
                className={`settings-nav-item ${config.activeCategory === 'mainModel' ? 'active' : ''}`}
                onClick={() => config.setActiveCategory('mainModel')}
              >
                {t('settings.mainModel')}
              </div>
              <div
                className={`settings-nav-item ${config.activeCategory === 'subModel' ? 'active' : ''}`}
                onClick={() => config.setActiveCategory('subModel')}
              >
                {t('settings.subModel')}
              </div>
              <div
                className={`settings-nav-item ${config.activeCategory === 'language' ? 'active' : ''}`}
                onClick={() => config.setActiveCategory('language')}
              >
                {t('settings.language')}
              </div>
              <div
                className={`settings-nav-item ${config.activeCategory === 'email' ? 'active' : ''}`}
                onClick={() => config.setActiveCategory('email')}
              >
                {t('settings.email')}
              </div>
            </div>

            {/* 右侧内容区 */}
            <div className="settings-content">
              {/* ===== 主模型 ===== */}
              {config.activeCategory === 'mainModel' && (
                <>
                  {/* 智能体开关 */}
                  <div className="setting-item">
                    <div className="setting-label">
                      <div className="setting-label-text">{t('settings.agent')}</div>
                      <div className="setting-desc">{t('settings.agentDesc')}</div>
                    </div>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={config.agentEnabled}
                        onChange={(e) => config.setAgentEnabled(e.target.checked)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                  <div className="setting-divider" />
                  <div className="setting-section-title">{t('settings.mainModel')}</div>
                  <ModelConfigPanel
                    config={config.mainModelConfig}
                    onUpdateField={config.updateMainField}
                    catalog={config.modelCatalog}
                    selectedCatalogId={config.mainSelectedCatalogId}
                    onCatalogChange={config.handleMainCatalogChange}
                    testStatus={config.mainTestStatus}
                    testResult={config.mainTestResult}
                    onTest={config.handleMainTest}
                    advancedOpen={config.mainAdvancedOpen}
                    onAdvancedToggle={config.setMainAdvancedOpen}
                    onResetAdvanced={config.resetMainAdvanced}
                    showMaxIterations
                    showVisionToggle
                  />
                </>
              )}

              {/* ===== 副模型 ===== */}
              {config.activeCategory === 'subModel' && (
                <>
                  <div className="setting-section-title">{t('settings.subModel')}</div>
                  <ModelConfigPanel
                    config={config.subModelConfig}
                    onUpdateField={config.updateSubField}
                    catalog={config.modelCatalog}
                    selectedCatalogId={config.subSelectedCatalogId}
                    onCatalogChange={config.handleSubCatalogChange}
                    testStatus={config.subTestStatus}
                    testResult={config.subTestResult}
                    onTest={config.handleSubTest}
                    advancedOpen={config.subAdvancedOpen}
                    onAdvancedToggle={config.setSubAdvancedOpen}
                    onResetAdvanced={config.resetSubAdvanced}
                  />
                </>
              )}

              {/* ===== 语言 ===== */}
              {config.activeCategory === 'language' && (
                <LanguagePanel
                  currentLang={config.currentLang}
                  onLangChange={config.setCurrentLang}
                />
              )}

              {/* ===== 邮件 ===== */}
              {config.activeCategory === 'email' && (
                <EmailConfigPanel
                  emailEnabled={config.emailEnabled}
                  onEnabledChange={config.setEmailEnabled}
                  selectedProvider={config.selectedProvider}
                  onProviderChange={config.setSelectedProvider}
                  emailAddress={config.emailAddress}
                  onEmailAddressChange={config.setEmailAddress}
                  displayName={config.displayName}
                  onDisplayNameChange={config.setDisplayName}
                  appPassword={config.appPassword}
                  onAppPasswordChange={config.setAppPassword}
                  imapHost={config.imapHost}
                  onImapHostChange={config.setImapHost}
                  imapPort={config.imapPort}
                  onImapPortChange={config.setImapPort}
                  imapSecure={config.imapSecure}
                  onImapSecureChange={config.setImapSecure}
                  smtpHost={config.smtpHost}
                  onSmtpHostChange={config.setSmtpHost}
                  smtpPort={config.smtpPort}
                  onSmtpPortChange={config.setSmtpPort}
                  smtpSecure={config.smtpSecure}
                  onSmtpSecureChange={config.setSmtpSecure}
                  testStatus={config.emailTestStatus}
                  testResult={config.emailTestResult}
                  onTest={config.handleEmailTest}
                />
              )}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="modal-btn modal-btn-apply"
            onClick={config.handleApply}
            disabled={!config.canApply()}
            title={!config.canApply() ? ((config.mainDirtyKeyFields.size > 0 || config.subDirtyKeyFields.size > 0) ? t('settings.applyTooltipNeedTest') : t('settings.applyTooltipNoChanges')) : ''}
          >
            {t('common.apply')}
          </button>
          <button className="modal-btn modal-btn-confirm" onClick={() => { clearAllBrowserSnapshots(); setSettingsModalVisible(false) }} autoFocus>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
