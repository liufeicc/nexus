/**
 * 计划模式状态 Hook
 *
 * 管理灵动岛的计划模式开关状态。
 * 计划模式开启后，智能体仅能使用只读工具和 write_plan 工具，
 * 用于"探索→讨论→生成计划"的工作流程。
 *
 * 状态同步：
 * - 用户手动切换：乐观更新本地 state → IPC 同步到主进程
 * - AI 自动切换：主进程广播事件 → useEffect 监听 → 更新本地 state
 */

import { useState, useCallback, useEffect } from 'react'
import { getEffectiveSessionId } from './use-dynamic-island-agent'

/**
 * 计划模式状态管理
 *
 * @returns planMode — 当前是否处于计划模式
 * @returns togglePlanMode — 切换计划模式开关
 */
export function useDynamicIslandPlanMode() {
  const [planMode, setPlanMode] = useState(false)

  /**
   * 切换计划模式
   *
   * 将新状态通过 IPC 同步到主进程的 AIAgent 实例，
   * 确保 LLM Bridge 和 ToolRegistry 能正确读取计划模式状态。
   */
  const togglePlanMode = useCallback(async () => {
    setPlanMode(prev => {
      const newValue = !prev
      // 异步同步到主进程（不阻塞 UI 更新）
      getEffectiveSessionId().then(sessionId => {
        window.electronAPI?.agent?.setPlanMode?.(newValue, sessionId)
      })
      return newValue
    })
  }, [])

  /**
   * 监听 AI 自动切换计划模式事件
   *
   * 当 AI 调用 exit_plan_mode 或 enter_plan_mode 工具时，
   * 主进程会广播此事件，渲染进程据此更新本地状态。
   */
  useEffect(() => {
    const cleanup = window.electronAPI?.agent?.onPlanModeChanged?.((data: { planMode: boolean }) => {
      setPlanMode(data.planMode)
    })
    return cleanup
  }, [])

  return { planMode, togglePlanMode }
}
