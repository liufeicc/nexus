/**
 * 后台智能体活动监听 hook
 *
 * 负责监听后台智能体活动事件（如对话历史压缩），
 * 并在灵动岛中显示活动指示器。
 */

import { useEffect, useState } from 'react'

/**
 * 后台活动状态
 */
interface BackgroundActivity {
  type: string       // 'compression' | 'indexing' 等
  status: string     // 'started' | 'progress' | 'completed' | 'error'
  message: string    // 描述信息，如 "正压缩对话历史..."
  progress?: number  // 进度 0-100
}

/**
 * 注册后台智能体活动监听
 * @returns 当前活动状态，无活动时为 null
 */
export function useBackgroundAgentActivity(): { activity: BackgroundActivity | null; isActive: boolean } {
  const [activity, setActivity] = useState<BackgroundActivity | null>(null)

  useEffect(() => {
    const agent = window.electronAPI?.agent
    if (!agent) return

    const cleanup = agent.onBackgroundActivity((data: {
      type: string
      status: string
      message: string
      progress?: number
    }) => {
      if (data.status === 'started' || data.status === 'progress') {
        setActivity(data)
      } else if (data.status === 'completed' || data.status === 'error') {
        // 完成后保留 2 秒再清除
        setActivity(data)
        setTimeout(() => setActivity(null), 2000)
      }
    })

    return () => cleanup()
  }, [])

  return {
    activity,
    isActive: activity !== null && (activity.status === 'started' || activity.status === 'progress'),
  }
}
