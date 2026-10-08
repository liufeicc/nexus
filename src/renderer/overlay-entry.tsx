/**
 * 共享置顶弹层窗口渲染入口
 *
 * 承载从主窗口迁移过来的全部覆盖式弹层（按批次挂载）。
 * 独立 renderer：独立 store 实例（bridge-client 打补丁为瘦客户端）、
 * 独立初始化语言/主题（与主窗口经 config 广播保持同步）。
 */

import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './styles/globals.css'
import './styles/components.css'
import { initLanguage, setGlobalLanguageSync } from './i18n'
import { themes, applyTheme } from '../core/constants/themes'
import { initOverlayClient, onOverlayReady } from './overlay/bridge-client'

// ===== 语言初始化（复用灵动岛模式） =====
initLanguage().then(lang => {
  setGlobalLanguageSync(lang)
}).catch(() => {})
if (window.electronAPI?.config?.onLanguageChanged) {
  window.electronAPI.config.onLanguageChanged((lang: string) => {
    setGlobalLanguageSync(lang as 'zh' | 'en' | 'fr' | 'es')
  })
}

// ===== 主题初始化与同步：overlay 必须与主窗口共用同一套 CSS 变量 =====
function applySavedTheme(): void {
  window.electronAPI.config.getAll().then(configs => {
    const themeConfig = configs.theme as { name?: string } | undefined
    if (themeConfig?.name) {
      const theme = themes.find(t => t.id === themeConfig.name)
      if (theme) applyTheme(theme)
    }
  }).catch(() => {})
}
applySavedTheme()
if (window.electronAPI?.onConfigChanged) {
  window.electronAPI.onConfigChanged(({ key }: { key: string }) => {
    if (key === 'theme') applySavedTheme()
  })
}

// ===== 桥接初始化（store 打补丁 + 握手） =====
initOverlayClient()

// 弹层组件按迁移批次挂载（B1-B8 全量）
import { Toast } from './components/common/Toast'
import { ConfirmModal } from './components/common/ConfirmModal'
import { AboutModal } from './components/common/AboutModal'
import { RenameModal } from './components/common/RenameModal'
import { FileRenameModal } from './components/common/FileRenameModal'
import { PathSelectorModal } from './components/common/PathSelectorModal'
import { SettingsModal } from './components/common/SettingsModal'
import { ApprovalModal } from './components/common/ApprovalModal'
import { ClarifyModal } from './components/common/ClarifyModal'
import { NexusProfileModal } from './components/common/NexusProfileModal'
import { ContextMenu } from './components/common/ContextMenu'
import { AppPickerOverlay } from './components/app-panel/AppPickerOverlay'

/** 首帧快照到达前不渲染，避免空 store 闪烁 */
function OverlayRoot() {
  const [ready, setReady] = useState(false)
  useEffect(() => onOverlayReady(() => setReady(true)), [])
  if (!ready) return null
  return (
    <>
      <Toast />
      <ConfirmModal />
      <AboutModal />
      <RenameModal />
      <FileRenameModal />
      <PathSelectorModal />
      <SettingsModal />
      <ApprovalModal />
      <ClarifyModal />
      <NexusProfileModal />
      <ContextMenu />
      <AppPickerOverlay />
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<OverlayRoot />)
