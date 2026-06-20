import React from 'react'
import ReactDOM from 'react-dom/client'
import { initLanguage, setGlobalLanguage } from './i18n'
import { DynamicIsland } from './components/common/DynamicIsland'

// 初始化语言系统，确保翻译正常工作
initLanguage().catch(() => {})

// 监听主进程发送的语言变更通知
if (window.electronAPI?.config?.onLanguageChanged) {
  window.electronAPI.config.onLanguageChanged((lang: string) => {
    setGlobalLanguage(lang as 'zh' | 'en' | 'fr' | 'es', true).catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DynamicIsland standalone />
  </React.StrictMode>
)
