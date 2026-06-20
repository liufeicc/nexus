/**
 * write_plan 工具 — 将执行计划写入 ~/.Nexus/plans/ 目录。
 *
 * 仅在计划模式（planMode === true）下对 LLM 可见。
 * 文件名由 LLM 根据计划内容生成简短英文描述，如 add-user-auth、refactor-database-layer。
 *
 * 文件名处理规则：
 * - 转为小写
 * - 空格替换为连字符
 * - 去除特殊字符（仅保留字母、数字、连字符）
 */

import fs from 'node:fs'
import path from 'node:path'
import { ToolDefinition, ToolResult } from '../../../core/types/agent'
import { PLANS_DIR } from '../../../core/constants/plan'
import { logger } from '../../utils/logger'

/**
 * 清理文件名：转小写，空格替换连字符，去除特殊字符
 */
function sanitizeFilename(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, '-')           // 空格 → 连字符
    .replace(/[^a-z0-9-]/g, '')     // 仅保留字母、数字、连字符
    .replace(/-+/g, '-')            // 连续连字符合并
    .replace(/^-|-$/g, '')          // 去除首尾连字符
}

/**
 * 创建 write_plan 工具
 *
 * @param getPlanMode 返回当前计划模式状态的函数
 * @returns ToolDefinition
 */
export function createWritePlanTool(getPlanMode: () => boolean): ToolDefinition {
  return {
    name: 'write_plan',
    description:
      '将执行计划写入计划文件（Markdown 格式）。'
      + '仅在计划模式下可用。'
      + '使用方式：提供 filename（简短英文描述，如 add-user-auth）和 content（Markdown 格式的完整计划内容）。'
      + '计划文件将保存到 ~/.Nexus/plans/ 目录，文件名为 {filename}.md。'
      + '每个步骤行必须包含状态标记 [ ]，例如：1. [ ] 创建用户模块。',
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description:
            '计划文件的简短英文描述，小写，单词间用连字符连接。'
            + '例如：add-user-auth、refactor-database-layer、optimize-query-performance。',
        },
        content: {
          type: 'string',
          description:
            'Markdown 格式的完整计划内容。'
            + '必须包含：标题、背景、目标、实施步骤（每步带 [ ] 状态标记）、涉及文件、验证方法。',
        },
      },
      required: ['filename', 'content'],
    },
    // 仅当计划模式开启时，此工具才对 LLM 可见
    checkFn: async () => getPlanMode(),
    handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const rawFilename = String(args.filename ?? '').trim()
      const content = String(args.content ?? '').trim()

      if (!rawFilename) {
        return { success: false, output: 'filename 参数不能为空' }
      }
      if (!content) {
        return { success: false, output: 'content 参数不能为空' }
      }

      // 清理文件名
      const safeFilename = sanitizeFilename(rawFilename)
      if (!safeFilename) {
        return { success: false, output: `文件名 '${rawFilename}' 清理后为空，请使用有效的英文描述` }
      }

      const filePath = path.join(PLANS_DIR, `${safeFilename}.md`)

      try {
        // 确保目录存在
        if (!fs.existsSync(PLANS_DIR)) {
          fs.mkdirSync(PLANS_DIR, { recursive: true })
        }

        fs.writeFileSync(filePath, content, 'utf-8')
        logger.info(`[write_plan] 计划文件已写入: ${filePath}`)

        return {
          success: true,
          output: `计划文件已成功写入: ${filePath}\n文件大小: ${content.length} 字符`,
          data: {
            type: 'plan_document',
            filePath,
            filename: safeFilename,
            content,  // 完整 Markdown 内容，供 UI 直接渲染
          },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`[write_plan] 写入计划文件失败: ${message}`)
        return {
          success: false,
          output: `写入计划文件失败: ${message}`,
        }
      }
    },
  }
}
