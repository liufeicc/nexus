/**
 * 计划模式切换工具 — exit_plan_mode 和 enter_plan_mode
 *
 * 让 AI 能自主切换计划模式：
 * - exit_plan_mode：计划模式下，用户要求执行时调用，退出计划模式进入执行阶段
 * - enter_plan_mode：正常模式下，遇到复杂任务时调用，进入计划模式进行探索讨论
 *
 * 两个工具通过 checkFn 互斥可见：
 * - exit_plan_mode 仅在计划模式开启时可见
 * - enter_plan_mode 仅在计划模式关闭时可见
 *
 * onToggle 回调由 agent-service.ts 在注册时绑定，
 * 负责更新 agent 状态并广播 IPC 事件通知 UI。
 */

import { ToolDefinition, ToolResult } from '../../../core/types/agent'
import { logger } from '../../utils/logger'

/**
 * 创建 exit_plan_mode 工具
 *
 * 仅在计划模式下对 LLM 可见。调用后退出计划模式，
 * agent 循环下一次迭代将使用完整工具集执行计划。
 *
 * @param getPlanMode 获取当前计划模式状态的函数
 * @param onToggle 切换计划模式的回调（由 agent-service 绑定）
 */
export function createExitPlanModeTool(
  getPlanMode: () => boolean,
  onToggle: (enabled: boolean) => void,
): ToolDefinition {
  return {
    name: 'exit_plan_mode',
    description:
      '退出计划模式，进入执行阶段。'
      + '仅在计划模式下可用。'
      + '当用户明确表示要开始执行计划时调用此工具（如"开始执行"、"执行吧"、"可以开始了"）。'
      + '退出后，你将获得完整的工具集来执行计划中的每个步骤。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    // 仅在计划模式开启时可见
    checkFn: async () => getPlanMode(),
    handler: async (): Promise<ToolResult> => {
      try {
        onToggle(false)
        logger.info('[exit_plan_mode] 已退出计划模式，进入执行阶段')

        return {
          success: true,
          output: '已退出计划模式，现在可以使用完整工具集来执行计划。',
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`[exit_plan_mode] 退出计划模式失败: ${message}`)
        return {
          success: false,
          output: `退出计划模式失败: ${message}`,
        }
      }
    },
  }
}

/**
 * 创建 enter_plan_mode 工具
 *
 * 仅在非计划模式下对 LLM 可见。调用后进入计划模式，
 * agent 循环下一次迭代将切换到只读工具集进行探索讨论。
 *
 * @param getPlanMode 获取当前计划模式状态的函数
 * @param onToggle 切换计划模式的回调（由 agent-service 绑定）
 */
export function createEnterPlanModeTool(
  getPlanMode: () => boolean,
  onToggle: (enabled: boolean) => void,
): ToolDefinition {
  return {
    name: 'enter_plan_mode',
    description:
      '进入计划模式，进行代码探索和方案讨论。'
      + '仅在非计划模式下可用。'
      + '当用户提出复杂的开发任务时调用此工具，例如：涉及多个文件修改、需要架构设计、需求不够明确。'
      + '进入后，你将使用只读工具探索代码库并与用户讨论方案，最终生成执行计划。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    // 仅在计划模式关闭时可见
    checkFn: async () => !getPlanMode(),
    handler: async (): Promise<ToolResult> => {
      try {
        onToggle(true)
        logger.info('[enter_plan_mode] 已进入计划模式，开始探索讨论')

        return {
          success: true,
          output: '已进入计划模式，现在使用只读工具探索代码库并与用户讨论方案。',
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`[enter_plan_mode] 进入计划模式失败: ${message}`)
        return {
          success: false,
          output: `进入计划模式失败: ${message}`,
        }
      }
    },
  }
}
