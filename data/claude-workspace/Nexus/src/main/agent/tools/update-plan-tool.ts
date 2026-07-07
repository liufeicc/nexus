/**
 * update_plan 工具 — 更新计划文件中的步骤执行状态。
 *
 * 仅在非计划模式（planMode === false）下对 LLM 可见。
 * 用于执行计划时，实时标记每个步骤的执行进度。
 *
 * 状态标记格式：
 * - [ ] → 待执行（初始状态）
 * - [>] → 执行中（in_progress）
 * - [x] → 已完成（completed）
 * - [!] → 失败（failed）
 *
 * 步骤行匹配格式：`数字. [状态] 描述`
 * 可选在步骤行后追加缩进备注行：`   > 备注内容`
 */

import fs from 'node:fs'
import path from 'node:path'
import { ToolDefinition, ToolResult } from '../../../core/types/agent'
import { PLANS_DIR } from '../../../core/constants/plan'
import { logger } from '../../utils/logger'

/** 状态值到标记符号的映射 */
const STATUS_MARKERS: Record<string, string> = {
  in_progress: '[>]',
  completed: '[x]',
  failed: '[!]',
}

/** 匹配步骤行的正则：`数字. [状态标记] 描述` */
const STEP_LINE_REGEX = /^(\d+)\.\s+\[[ >x!]\]\s+(.*)$/

/**
 * 创建 update_plan 工具
 *
 * @param getPlanMode 返回当前计划模式状态的函数
 * @returns ToolDefinition
 */
export function createUpdatePlanTool(getPlanMode: () => boolean): ToolDefinition {
  return {
    name: 'update_plan',
    description:
      '更新计划文件中的步骤执行状态。'
      + '仅在非计划模式下可用（执行计划时使用）。'
      + '使用方式：指定计划文件名、步骤序号和状态，可选附加备注。'
      + '状态值：in_progress（执行中）、completed（已完成）、failed（失败）。'
      + '必须实时标记状态，每个步骤开始时标记 in_progress，完成时标记 completed。',
    parameters: {
      type: 'object',
      properties: {
        plan_file: {
          type: 'string',
          description: '计划文件名（如 add-user-auth.md）。',
        },
        step_number: {
          type: 'number',
          description: '步骤序号（从 1 开始）。',
        },
        status: {
          type: 'string',
          enum: ['in_progress', 'completed', 'failed'],
          description: '步骤状态：in_progress（执行中）、completed（已完成）、failed（失败）。',
        },
        note: {
          type: 'string',
          description: '可选，简短备注（如创建的文件路径、关键决策等）。',
        },
      },
      required: ['plan_file', 'step_number', 'status'],
    },
    // 仅当计划模式关闭时，此工具才对 LLM 可见
    checkFn: async () => !getPlanMode(),
    handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const planFile = String(args.plan_file ?? '').trim()
      const stepNumber = Number(args.step_number)
      const status = String(args.status ?? '').trim()
      const note = args.note ? String(args.note).trim() : ''

      // 参数验证
      if (!planFile) {
        return { success: false, output: 'plan_file 参数不能为空' }
      }
      if (!Number.isInteger(stepNumber) || stepNumber < 1) {
        return { success: false, output: 'step_number 必须是正整数' }
      }
      if (!STATUS_MARKERS[status]) {
        return { success: false, output: `无效的 status 值: ${status}，可选值: in_progress, completed, failed` }
      }

      // 确保文件名带 .md 后缀，并验证路径不越界
      const filename = planFile.endsWith('.md') ? planFile : `${planFile}.md`
      const resolvedDir = path.resolve(PLANS_DIR)
      const filePath = path.resolve(resolvedDir, filename)
      if (!filePath.startsWith(resolvedDir + path.sep) && filePath !== resolvedDir) {
        return { success: false, output: `非法的计划文件路径: ${filename}` }
      }

      try {
        // 读取计划文件
        if (!fs.existsSync(filePath)) {
          return { success: false, output: `计划文件不存在: ${filePath}` }
        }

        const content = fs.readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')

        // 找到第 stepNumber 个步骤行并更新状态标记
        let stepCount = 0
        let updatedLineIndex = -1

        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(STEP_LINE_REGEX)
          if (match) {
            stepCount++
            if (stepCount === stepNumber) {
              // 找到目标步骤行，替换状态标记
              const lineNum = match[1]
              const description = match[2]
              const newMarker = STATUS_MARKERS[status]
              lines[i] = `${lineNum}. ${newMarker} ${description}`
              updatedLineIndex = i
              break
            }
          }
        }

        if (updatedLineIndex === -1) {
          return {
            success: false,
            output: `未找到第 ${stepNumber} 个步骤行（文件中共有 ${stepCount} 个步骤）`,
          }
        }

        // 如果提供了备注，在步骤行后插入或替换备注行
        if (note) {
          const noteLine = `   > ${note}`
          // 检查下一行是否已经是备注行（以 `   > ` 开头）
          const nextLineIndex = updatedLineIndex + 1
          if (nextLineIndex < lines.length && lines[nextLineIndex].match(/^\s+>\s+/)) {
            // 替换已有备注行
            lines[nextLineIndex] = noteLine
          } else {
            // 在步骤行后插入新备注行
            lines.splice(nextLineIndex, 0, noteLine)
          }
        }

        // 写回文件
        const updatedContent = lines.join('\n')
        fs.writeFileSync(filePath, updatedContent, 'utf-8')
        logger.info(`[update_plan] 步骤 ${stepNumber} 状态已更新为 ${status}: ${filePath}`)

        return {
          success: true,
          output: `计划文件已更新: ${filename}\n步骤 ${stepNumber} 状态: ${status}${note ? `\n备注: ${note}` : ''}`,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`[update_plan] 更新计划文件失败: ${message}`)
        return {
          success: false,
          output: `更新计划文件失败: ${message}`,
        }
      }
    },
  }
}
