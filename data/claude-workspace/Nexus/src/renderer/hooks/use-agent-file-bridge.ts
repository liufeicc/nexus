/**
 * 智能体文件操作桥接 Hook
 *
 * 当智能体调用文件写入工具（write_file、patch）时，
 * 自动在文件面板中打开对应文件的预览。
 * read_file 不会触发打开面板，避免智能体在检查文件存在性时
 * 频繁打开中间文件（如递增编号检查 a_1.txt, a_2.txt ...）。
 * 同时监听智能体状态变化，清除文件活动标记。
 *
 * 注意：仅当文件面板已"连接Nexus"时才会联动显示文件操作过程。
 */

import { useEffect, useRef } from 'react'
import { useAppStore } from '../store'
import { getBasename } from '../../core/utils/path-utils'

/** 触发文件面板联动的工具名称（仅写入类操作） */
const FILE_TOOL_NAMES = new Set(['write_file', 'patch'])

export function useAgentFileBridge(): void {
  const agentOpenFileInFilePanel = useAppStore(s => s.agentOpenFileInFilePanel)
  const agentClearFileActivity = useAppStore(s => s.agentClearFileActivity)
  const prevAgentRunningRef = useRef(false)

  useEffect(() => {
    const agent = window.electronAPI?.agent
    if (!agent) {
      console.warn('[useAgentFileBridge] agent API not available, skipping')
      return
    }

    console.log('[useAgentFileBridge] Hook mounted, setting up listeners')

    // 监听智能体工具调用
    const cleanupToolCall = agent.onToolCall((data) => {
      // 仅当文件面板已"连接Nexus"时才联动显示
      const { nexusDataPanelId, panels } = useAppStore.getState()
      const hasConnectedFilePanel = nexusDataPanelId !== null &&
        panels.some(p => p.id === nexusDataPanelId && p.panelType === 'file-browser')
      if (!hasConnectedFilePanel) return

      console.log('[useAgentFileBridge] toolCall event:', data.toolName, 'args:', data.toolArgs)
      if (FILE_TOOL_NAMES.has(data.toolName) && data.toolArgs?.path) {
        const filePath = String(data.toolArgs.path)
        const fileName = getBasename(filePath)
        const action = data.toolName === 'write_file' ? 'create' : 'edit'
        console.log('[useAgentFileBridge] Opening file in panel:', filePath, fileName, action)
        agentOpenFileInFilePanel(filePath, fileName, action)
      }
    })

    // 监听智能体状态变化，清除活动标记
    const cleanupState = agent.onStateChange((data) => {
      const isNowRunning = data.state === 'running'
      // 从 running 变为非 running 时清除活动标记
      if (prevAgentRunningRef.current && !isNowRunning) {
        agentClearFileActivity()
      }
      prevAgentRunningRef.current = isNowRunning
    })

    return () => {
      cleanupToolCall()
      cleanupState()
    }
  }, [agentOpenFileInFilePanel, agentClearFileActivity])
}
