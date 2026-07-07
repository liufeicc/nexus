/**
 * Nexus 连接管理 Hook
 * 从 FileBrowserPanel.tsx 提取
 * 职责：连接/断开 Nexus，监听连接状态变化
 */

import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../../store'
import { t } from '../../i18n'

export interface UseNexusConnectionInput {
  panelId: string
}

export interface UseNexusConnectionOutput {
  isConnected: boolean
  handleToggleNexus: () => void
}

export function useNexusConnection({
  panelId,
}: UseNexusConnectionInput): UseNexusConnectionOutput {
  const { showToast, nexusDataPanelId, setNexusDataPanelId } = useAppStore()

  const isConnected = nexusDataPanelId === panelId

  const handleToggleNexus = useCallback(() => {
    if (isConnected) {
      // 仅断开数据轨连接（不影响浏览器轨）
      window.electronAPI.nexus.disconnectData()
      setNexusDataPanelId(null)
      showToast(t('nexus.disconnected'), 1500)
    } else {
      window.electronAPI.nexus.connectFile(panelId)
      setNexusDataPanelId(panelId)
      showToast(t('nexus.connected'), 1500)
    }
  }, [isConnected, panelId, setNexusDataPanelId, showToast])

  // 监听连接状态变化（主进程通知，只处理数据轨事件）
  useEffect(() => {
    const cleanup = window.electronAPI.nexus.onConnectionStateChanged((data) => {
      if (data.track !== 'data') return
      if (data.connected) {
        setNexusDataPanelId(data.panelId)
      } else {
        setNexusDataPanelId(null)
      }
    })
    return cleanup
  }, [setNexusDataPanelId])

  // 组件卸载时自动断开连接
  useEffect(() => {
    return () => {
      if (useAppStore.getState().nexusDataPanelId === panelId) {
        window.electronAPI.nexus.disconnectData()
        useAppStore.getState().setNexusDataPanelId(null)
      }
    }
  }, [panelId])

  return { isConnected, handleToggleNexus }
}
