/**
 * 邮件配置面板
 */

import React from 'react'
import { useI18n } from '../../../i18n'

interface EmailConfigPanelProps {
  emailEnabled: boolean
  onEnabledChange: (enabled: boolean) => void
  selectedProvider: string
  onProviderChange: (provider: string) => void
  emailAddress: string
  onEmailAddressChange: (v: string) => void
  displayName: string
  onDisplayNameChange: (v: string) => void
  appPassword: string
  onAppPasswordChange: (v: string) => void
  imapHost: string
  onImapHostChange: (v: string) => void
  imapPort: number
  onImapPortChange: (v: number) => void
  imapSecure: boolean
  onImapSecureChange: (v: boolean) => void
  smtpHost: string
  onSmtpHostChange: (v: string) => void
  smtpPort: number
  onSmtpPortChange: (v: number) => void
  smtpSecure: boolean
  onSmtpSecureChange: (v: boolean) => void
  testStatus: 'idle' | 'testing' | 'success' | 'error'
  testResult: string
  onTest: () => void
}

export function EmailConfigPanel({
  emailEnabled, onEnabledChange,
  selectedProvider, onProviderChange,
  emailAddress, onEmailAddressChange,
  displayName, onDisplayNameChange,
  appPassword, onAppPasswordChange,
  imapHost, onImapHostChange,
  imapPort, onImapPortChange,
  imapSecure, onImapSecureChange,
  smtpHost, onSmtpHostChange,
  smtpPort, onSmtpPortChange,
  smtpSecure, onSmtpSecureChange,
  testStatus, testResult, onTest,
}: EmailConfigPanelProps) {
  const { t } = useI18n()

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.target.value
    onProviderChange(provider)
    switch (provider) {
      case 'gmail':
        onImapHostChange('imap.gmail.com'); onImapPortChange(993); onImapSecureChange(true)
        onSmtpHostChange('smtp.gmail.com'); onSmtpPortChange(465); onSmtpSecureChange(true)
        break
      case 'qq':
        onImapHostChange('imap.qq.com'); onImapPortChange(993); onImapSecureChange(true)
        onSmtpHostChange('smtp.qq.com'); onSmtpPortChange(465); onSmtpSecureChange(true)
        break
      case '163':
        onImapHostChange('imap.163.com'); onImapPortChange(993); onImapSecureChange(true)
        onSmtpHostChange('smtp.163.com'); onSmtpPortChange(465); onSmtpSecureChange(true)
        break
      case 'outlook':
        onImapHostChange('outlook.office365.com'); onImapPortChange(993); onImapSecureChange(true)
        onSmtpHostChange('smtp-mail.outlook.com'); onSmtpPortChange(587); onSmtpSecureChange(false)
        break
      case 'custom':
        onImapHostChange(''); onImapPortChange(993); onImapSecureChange(true)
        onSmtpHostChange(''); onSmtpPortChange(465); onSmtpSecureChange(true)
        break
    }
  }

  return (
    <>
      {/* 启用开关 */}
      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.emailEnabled')}</div>
          <div className="setting-desc">{t('settings.emailEnabledDesc')}</div>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={emailEnabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>

      <div className="setting-divider" />

      {/* 服务商预设 */}
      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.emailProvider')}</div>
          <div className="setting-desc">{t('settings.emailProviderDesc')}</div>
        </div>
        <div className="setting-control">
          <select
            className="setting-select"
            value={selectedProvider}
            onChange={handleProviderChange}
          >
            <option value="gmail">{t('settings.providerGmail')}</option>
            <option value="qq">{t('settings.providerQq')}</option>
            <option value="163">{t('settings.provider163')}</option>
            <option value="outlook">{t('settings.providerOutlook')}</option>
            <option value="custom">{t('settings.providerCustom')}</option>
          </select>
        </div>
      </div>

      {/* 邮箱地址 */}
      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.emailAddress')}</div>
          <div className="setting-desc">{t('settings.emailAddressDesc')}</div>
        </div>
        <div className="setting-control">
          <input
            type="email"
            className="setting-input"
            placeholder="your@email.com"
            value={emailAddress}
            onChange={(e) => onEmailAddressChange(e.target.value)}
          />
        </div>
      </div>

      {/* 显示名称 */}
      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.displayName')}</div>
          <div className="setting-desc">{t('settings.displayNameDesc')}</div>
        </div>
        <div className="setting-control">
          <input
            type="text"
            className="setting-input"
            placeholder={t('email.displayName')}
            value={displayName}
            onChange={(e) => onDisplayNameChange(e.target.value)}
          />
        </div>
      </div>

      {/* 应用密码 */}
      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.appPassword')}</div>
          <div className="setting-desc">{t('settings.appPasswordDesc')}</div>
        </div>
        <div className="setting-control">
          <input
            type="password"
            className="setting-input"
            placeholder="xxxx-xxxx-xxxx-xxxx"
            value={appPassword}
            onChange={(e) => onAppPasswordChange(e.target.value)}
          />
        </div>
      </div>

      {/* IMAP */}
      <div className="setting-section-title">IMAP</div>

      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.imapServer')}</div>
          <div className="setting-desc">{t('settings.imapServerDesc')}</div>
        </div>
        <div className="setting-control">
          <input
            type="text"
            className="setting-input"
            placeholder="imap.gmail.com"
            value={imapHost}
            onChange={(e) => onImapHostChange(e.target.value)}
          />
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.imapPort')}</div>
          <div className="setting-desc">{t('settings.imapPortDesc')}</div>
        </div>
        <div className="setting-control setting-control-narrow">
          <input
            type="number"
            className="setting-input"
            placeholder="993"
            value={imapPort}
            onChange={(e) => onImapPortChange(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.imapSecure')}</div>
          <div className="setting-desc">{t('settings.imapSecureDesc')}</div>
        </div>
        <div className="setting-control">
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={imapSecure}
              onChange={(e) => onImapSecureChange(e.target.checked)}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>

      {/* SMTP */}
      <div className="setting-section-title">SMTP</div>

      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.smtpServer')}</div>
          <div className="setting-desc">{t('settings.smtpServerDesc')}</div>
        </div>
        <div className="setting-control">
          <input
            type="text"
            className="setting-input"
            placeholder="smtp.gmail.com"
            value={smtpHost}
            onChange={(e) => onSmtpHostChange(e.target.value)}
          />
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.smtpPort')}</div>
          <div className="setting-desc">{t('settings.smtpPortDesc')}</div>
        </div>
        <div className="setting-control setting-control-narrow">
          <input
            type="number"
            className="setting-input"
            placeholder="465"
            value={smtpPort}
            onChange={(e) => onSmtpPortChange(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.smtpSecure')}</div>
          <div className="setting-desc">{t('settings.smtpSecureDesc')}</div>
        </div>
        <div className="setting-control">
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={smtpSecure}
              onChange={(e) => onSmtpSecureChange(e.target.checked)}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>

      {/* 测试按钮和结果 */}
      <div className="setting-item">
        <div className="setting-label">
          <div className="setting-label-text">{t('settings.emailTestConnection')}</div>
          <div className="setting-desc">{t('settings.emailTestConnectionDesc')}</div>
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
    </>
  )
}
