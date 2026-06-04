import React from 'react'
import './styles/globals.css'
import './styles/components.css'
import { MainLayout } from './components/layout/MainLayout'
import { themes, applyTheme } from '../core/constants/themes'
import { useGlobalContextMenu, useKeyboardShortcuts, useSaveOnExit } from './hooks/useGlobalEvents'
import { useAgentFileBridge } from './hooks/use-agent-file-bridge'
import { useAppStore } from './store'
import { ConfirmModal } from './components/common/ConfirmModal'
import { RenameModal } from './components/common/RenameModal'
import { PathSelectorModal } from './components/common/PathSelectorModal'
import { FileRenameModal } from './components/common/FileRenameModal'
import { SettingsModal } from './components/common/SettingsModal'
import { Toast } from './components/common/Toast'
import { ContextMenu } from './components/common/ContextMenu'
import { ApprovalModal } from './components/common/ApprovalModal'
import { ClarifyModal } from './components/common/ClarifyModal'
import { AboutModal } from './components/common/AboutModal'
import { NexusProfileModal } from './components/common/NexusProfileModal'
import { initLanguage, setGlobalLanguageSync } from './i18n'

/**
 * Nexus 应用根组件
 */
function App() {
  const { setCurrentThemeId, setSidebarWidth, setSidebarCollapsed, setAgentEnabled, activeSessionId, showApprovalModal, showClarifyModal } = useAppStore()

  // 初始化全局事件监听
  useGlobalContextMenu()
  useKeyboardShortcuts()
  useSaveOnExit()

  // 智能体文件操作桥接（自动在文件面板打开预览）
  useAgentFileBridge()

  // 交互式 IPC 监听：审批 + clarify
  React.useEffect(() => {
    const cleanupApproval = window.electronAPI.agent.onApprovalRequest((data) => {
      showApprovalModal(data.command, data.description, data.sessionKey)
    })
    const cleanupClarify = window.electronAPI.agent.onClarifyRequest((data) => {
      showClarifyModal(data.question, data.choices)
    })
    return () => {
      cleanupApproval()
      cleanupClarify()
    }
  }, [showApprovalModal, showClarifyModal])

  // 应用启动时加载配置
  React.useEffect(() => {
    const loadConfigs = async () => {
      try {
        // 0. 初始化语言（优先使用已保存配置，否则检测 OS 语言）
        const lang = await initLanguage()
        setGlobalLanguageSync(lang)

        // 1. 获取所有配置
        const configs = await window.electronAPI.config.getAll()

        // 2. 应用主题配置
        const themeConfig = configs.theme
        if (themeConfig && typeof themeConfig === 'object' && themeConfig?.name) {
          const theme = themes.find((t) => t.id === themeConfig.name)
          if (theme) {
            applyTheme(theme)
            setCurrentThemeId(theme.id)
          }
        }

        // 3. 应用侧边栏宽度配置（只接受有效数字）
        if (typeof configs.sidebarWidth === 'number') {
          setSidebarWidth(configs.sidebarWidth)
        }

        // 4. 应用侧边栏收起状态配置（只接受有效布尔值）
        if (typeof configs.sidebarCollapsed === 'boolean') {
          setSidebarCollapsed(configs.sidebarCollapsed)
        }

        // 5. 应用智能体开关配置（默认开启）
        // 注意：只更新 store 状态，不触发 config.save（避免首次启动时写入 false）
        if (configs.agentEnabled !== undefined) {
          useAppStore.setState({ agentEnabled: !!configs.agentEnabled })
        }
      } catch (error) {
        console.error('[App] 加载配置失败:', error)
      }
    }

    loadConfigs()
  }, [setCurrentThemeId, setSidebarWidth, setSidebarCollapsed, setAgentEnabled])

  return (
    <>
      <MainLayout />
      {/* 灵动岛已移至独立窗口，此处不再渲染 */}
      <ConfirmModal />
      <RenameModal />
      <PathSelectorModal />
      <FileRenameModal />
      <SettingsModal />
      <Toast />
      <ContextMenu />
      <ApprovalModal />
      <ClarifyModal />
      <AboutModal />
      <NexusProfileModal />
    </>
  )
}

export default App
