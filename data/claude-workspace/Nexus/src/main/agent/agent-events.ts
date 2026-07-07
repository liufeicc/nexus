/**
 * 智能体事件系统
 *
 * 职责：管理事件回调注册、触发和状态变更广播。
 * 从 ai-agent.ts 拆分出来，减少主文件体积。
 */

import { AgentEvent, AgentState } from '../../core/types/agent'
import { logger } from '../utils/logger'

/**
 * 创建事件
 */
export function createEvent(type: AgentEvent['type'], data: Record<string, unknown> = {}): AgentEvent {
  return { type, data, timestamp: Date.now() }
}

/**
 * 智能体事件管理器
 *
 * 维护一组事件回调，提供 emit（触发事件）和 setState（状态变更广播）。
 */
export class AgentEventManager {
  private state: AgentState = 'idle'
  private callbacks: Set<(event: AgentEvent) => void> = new Set()

  /**
   * 注册事件回调
   * @returns 取消注册函数
   */
  onEvent(callback: (event: AgentEvent) => void): () => void {
    this.callbacks.add(callback)
    return () => this.callbacks.delete(callback)
  }

  /**
   * 触发事件
   */
  emit(event: AgentEvent): void {
    for (const cb of this.callbacks) {
      try {
        cb(event)
      } catch (err) {
        logger.warn(`[AIAgent] 事件回调异常: ${err}`)
      }
    }
  }

  /**
   * 设置状态并广播变更事件
   */
  setState(newState: AgentState): void {
    if (this.state !== newState) {
      this.state = newState
      this.emit(createEvent('state_change', { state: newState }))
    }
  }

  /**
   * 获取当前状态
   */
  getState(): AgentState {
    return this.state
  }

  /**
   * 重置为 idle 状态
   */
  resetState(): void {
    this.state = 'idle'
  }
}
