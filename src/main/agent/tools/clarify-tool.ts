/**
 * Clarify 工具 — 向用户提问，支持多选或开放式问答。
 *
 * 工作方式：
 * 1. LLM 调用 clarify(question, choices?) 工具
 * 2. 主进程通过 IPC 将问题和选项发送到渲染进程
 * 3. 渲染进程弹出选择弹窗，等待用户回答
 * 4. 用户选择后通过 IPC 返回结果
 * 5. 主进程将结果返回给 LLM
 *
 * 选项上限 4 个，UI 层会自动追加"其他（自行输入）"选项。
 */

import { ToolDefinition, ToolResult } from '../../../core/types/agent'
import { logger } from '../../utils/logger'

// ==================== 回调注册 ====================

/** Clarify 回调函数类型 */
export type ClarifyCallback = (
  question: string,
  choices: string[] | null,
) => Promise<string>

let clarifyCallback: ClarifyCallback | null = null

/**
 * 设置 Clarify 回调函数。
 * 由 agent-service.ts 在启动时注册，用于触发 IPC 交互流程。
 */
export function setClarifyCallback(cb: ClarifyCallback | null): void {
  clarifyCallback = cb
}

// ==================== 工具定义 ====================

/**
 * Clarify 工具定义。
 *
 * 用于 LLM 向用户提问，支持两种模式：
 * 1. 多选模式：提供最多 4 个选项，用户选择或自行输入
 * 2. 开放式模式：不提供选项，用户自由回答
 */
export const clarifyTool: ToolDefinition = {
  name: 'clarify',
  description:
    '向用户提问，支持多选或开放式问答。'
    + '当用户请求模糊不清、需要用户提供关键信息、或需要用户做决策时使用此工具。'
    + '使用方式：提供 question 参数（必填），可选提供 choices 参数（最多 4 个选项）。'
    + '有 choices 时用户从选项中选择或自行输入；无 choices 时用户自由输入回答。'
    + 'UI 会通过弹窗展示你的问题并收集用户回答。'
    + '适用场景：用户说"那个文件"但不知具体指哪个、"帮我分析一下"但不清楚分析什么数据、'
    + '"处理一下"但不确定处理方式。'
    + '注意：不要用于简单的是/否确认（应自行做出合理选择），也不要用它来替代本可以用 search_files/read_file 等工具获取的信息。',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: '要向用户展示的问题文本。',
      },
      choices: {
        type: 'array',
        items: { type: 'string', description: '一个答案选项文本。' },
        description:
          '最多 4 个答案选项。省略此参数则为开放式问答。'
          + 'UI 会自动追加一个"其他（自行输入）"选项。',
      },
    },
    required: ['question'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const question = String(args.question ?? '').trim()
    if (!question) {
      return { success: false, output: '问题文本不能为空' }
    }

    // 规范化选项
    let choices: string[] | null = null
    if (Array.isArray(args.choices)) {
      const rawChoices = args.choices
        .map((c: unknown) => String(c).trim())
        .filter((c: string) => c.length > 0)
      if (rawChoices.length === 0) choices = null
      else if (rawChoices.length > 4) choices = rawChoices.slice(0, 4)
      else choices = rawChoices
    }

    if (!clarifyCallback) {
      return {
        success: false,
        output: 'Clarify 工具未初始化，无法向用户提问。',
      }
    }

    logger.debug('[Clarify] 提问:', question, choices ? `选项: ${choices.join(', ')}` : '(开放式)')

    try {
      const userResponse = await clarifyCallback(question, choices)
      logger.debug('[Clarify] 用户回答:', userResponse)

      return {
        success: true,
        output: JSON.stringify({
          question,
          choices_offered: choices,
          user_response: userResponse.trim(),
        }, null, 2),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('[Clarify] 获取用户回答失败:', message)
      return {
        success: false,
        output: `获取用户回答失败：${message}`,
      }
    }
  },
}
