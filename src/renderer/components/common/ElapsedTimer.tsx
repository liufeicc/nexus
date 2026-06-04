/**
 * 计时器组件
 *
 * 显示从 startTime 到 endTime（或当前时间）的已耗时时长
 * - 运行中（endTime 为 null）：每秒刷新
 * - 已结束（endTime 有值）：显示固定时长
 *
 * 格式：1h 2m 3s / 2m 3s / 3s（省略为零的大单位）
 */

import { useState, useEffect } from 'react'

interface ElapsedTimerProps {
  /** 开始时间戳（毫秒） */
  startTime: number
  /** 结束时间戳（毫秒），null 表示仍在计时 */
  endTime: number | null
}

/** 将毫秒差格式化为 "1h 2m 3s" 格式 */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(' ')
}

export function ElapsedTimer({ startTime, endTime }: ElapsedTimerProps) {
  // 用一个 tick 状态驱动运行中的定时器刷新
  const [, setTick] = useState(0)

  useEffect(() => {
    // 已结束则不需要定时器
    if (endTime != null) return

    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [endTime])

  const elapsed = (endTime ?? Date.now()) - startTime
  if (elapsed < 0) return null

  return (
    <span className="island-elapsed-timer">
      {formatElapsed(elapsed)}
    </span>
  )
}
