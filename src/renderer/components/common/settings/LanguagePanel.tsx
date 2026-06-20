/**
 * 语言设置面板
 */

import React from 'react'
import { LANGUAGES } from '../../../i18n'
import type { LanguageCode } from '../../../i18n/types'
import { useI18n } from '../../../i18n'

interface LanguagePanelProps {
  currentLang: LanguageCode
  onLangChange: (lang: LanguageCode) => void
}

export function LanguagePanel({ currentLang, onLangChange }: LanguagePanelProps) {
  const { t } = useI18n()

  return (
    <div className="setting-item">
      <div className="setting-label">
        <div className="setting-label-text">{t('settings.language')}</div>
        <div className="setting-desc">{t('settings.languageDesc')}</div>
      </div>
      <div className="setting-control">
        <select
          className="setting-select"
          value={currentLang}
          onChange={(e) => onLangChange(e.target.value as LanguageCode)}
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
