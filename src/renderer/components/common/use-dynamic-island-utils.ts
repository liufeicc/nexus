/**
 * 灵动岛工具函数
 * 从 DynamicIsland.tsx 提取
 * 职责：状态映射、文本截断、相对时间格式化
 */

import type { AgentState } from '../../hooks/use-dynamic-island-types'
import { t } from '../../i18n'

/**
 * 将 agentState 映射为灵动岛 data-type
 */
export function agentStateToType(state: AgentState): string {
  switch (state) {
    case 'running': return 'agent'
    case 'stopping': return 'warning'
    case 'error': return 'error'
    case 'completed': return 'success'
    case 'stopped': return 'warning'
    default: return 'info'
  }
}

/**
 * 截断文本，避免在紧凑区域显示过长内容
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '...'
}

/**
 * 将 Unix 时间戳格式化为相对时间描述
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp
  if (diff < 60) return t('relativeTime.justNow')
  if (diff < 3600) {
    const mins = Math.floor(diff / 60)
    return t('relativeTime.minutesAgo').replace('{n}', String(mins))
  }
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600)
    return t('relativeTime.hoursAgo').replace('{n}', String(hours))
  }
  if (diff < 604800) {
    const days = Math.floor(diff / 86400)
    return t('relativeTime.daysAgo').replace('{n}', String(days))
  }
  return new Date(timestamp * 1000).toLocaleDateString()
}
