/**
 * 灵动岛配置管理 Hook
 * 从 DynamicIsland.tsx 提取
 * 职责：enableVision 配置读取/刷新、上下文使用率监听
 */

import { useState, useEffect } from 'react'

export interface UseDynamicIslandConfigOutput {
  enableVision: boolean
  contextUsagePercent: number
}

export function useDynamicIslandConfig(islandState: string): UseDynamicIslandConfigOutput {
  /** 读取模型配置中的 enableVision */
  const [enableVision, setEnableVision] = useState(true)

  /** 上下文使用百分比（从 stateChange 事件中获取） */
  const [contextUsagePercent, setContextUsagePercent] = useState<number>(0)

  // 挂载时读取配置
  useEffect(() => {
    window.electronAPI?.config.get('agentConfig').then((config: any) => {
      if (config?.enableVision !== undefined) {
        setEnableVision(config.enableVision)
      }
    })
  }, [])

  // 灵动岛展开时刷新配置（确保设置修改后生效）
  useEffect(() => {
    if (islandState === 'showing') {
      window.electronAPI?.config.get('agentConfig').then((config: any) => {
        if (config?.enableVision !== undefined) {
          setEnableVision(config.enableVision)
        }
      })
    }
  }, [islandState])

  // 监听配置变更事件（设置中点击「应用」后实时刷新 enableVision）
  useEffect(() => {
    return window.electronAPI?.onConfigChanged?.((data) => {
      if (data.key === 'agentConfig') {
        window.electronAPI?.config.get('agentConfig').then((config: any) => {
          if (config?.enableVision !== undefined) {
            setEnableVision(config.enableVision)
          }
        })
      }
    })
  }, [])

  // 监听上下文使用率变化
  useEffect(() => {
    const agent = window.electronAPI?.agent
    if (!agent) return

    // 挂载时主动请求初始值
    agent.getContextUsage?.().then((res) => {
      if (typeof res?.contextUsagePercent === 'number') {
        setContextUsagePercent(Math.min(100, Math.max(0, res.contextUsagePercent)))
      }
    })

    const cleanup = agent.onStateChange((data: {
      state: string
      apiCall?: number
      budgetRemaining?: number
      finalResponse?: string | null
      errorMessage?: string | null
      contextUsagePercent?: number
    }) => {
      if (typeof data.contextUsagePercent === 'number') {
        setContextUsagePercent(Math.min(100, Math.max(0, data.contextUsagePercent)))
      }
    })
    return () => cleanup()
  }, [])

  return { enableVision, contextUsagePercent }
}
