/**
 * 状态栏组件
 */

import React from 'react'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../store'
import { OperationTips } from '../common/OperationTips'

export function StatusBar() {
  const { t } = useI18n()
  const { activeSessionId } = useAppStore()

  return (
    <footer className="status-bar">
      <div className="status-bar-left" style={{ flex: 1 }} />
      <div className="status-bar-right">
        {activeSessionId
          ? <OperationTips />
          : <span>{t('statusbar.newSessionHint')}</span>}
      </div>
    </footer>
  )
}

export default StatusBar
