/**
 * Todo 工具 — 规划和跟踪多步骤任务
 *
 * 使用工厂函数创建，每个实例绑定到独立的 TodoStore。
 * 避免全局状态导致的跨会话污染。
 */

import { ToolDefinition, ToolResult } from '../../../core/types/agent'
import { TodoStore, TodoItem } from './todo-store'

const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const

/**
 * 创建 todo 工具实例，绑定到指定的 TodoStore
 */
export function createTodoTool(getStore: () => TodoStore): ToolDefinition {
  return {
    name: 'todo',
    description: (
      '管理任务列表，用于规划和跟踪多步骤任务的进度。'
      + '适用于 3 步以上的复杂任务，或用户提供多个任务时。\n\n'
      + '读取：不提供 todos 参数即可读取当前列表。\n\n'
      + '写入：提供 todos 数组来创建/更新任务项\n'
      + '- merge=false（默认）：用新列表替换整个列表\n'
      + '- merge=true：按 id 更新已有项，追加新项\n\n'
      + '每个任务项: {id: string, content: string, '
      + 'status: pending|in_progress|completed|cancelled}\n'
      + '列表顺序即优先级。同时只有一个任务处于 in_progress 状态。\n'
      + '任务完成后立即标记 completed。如果某项失败，取消并添加修订项。\n\n'
      + '始终返回完整的当前任务列表和统计摘要。'
    ),
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: '要写入的任务数组。不提供则读取当前列表。',
          items: {
            type: 'object',
            description: '单个任务项',
            properties: {
              id: {
                type: 'string',
                description: '唯一任务标识（智能体自定义）',
              },
              content: {
                type: 'string',
                description: '任务描述',
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                description: '任务状态',
              },
            },
            required: ['id', 'content', 'status'],
          },
        },
        merge: {
          type: 'boolean',
          description: 'true: 按 id 更新已有项并追加新项。false（默认）: 替换整个列表。',
        },
      },
      required: [],
    },
    handler: async (args): Promise<ToolResult> => {
      const merge = args.merge === true
      const todosInput = args.todos as TodoItem[] | undefined
      const store = getStore()

      let items: TodoItem[]
      if (todosInput !== undefined && Array.isArray(todosInput)) {
        items = store.write(todosInput, merge)
      } else {
        items = store.read()
      }

      const output = formatTodos(items)
      const summary = buildSummary(items)

      return {
        success: true,
        output: `${output}\n\n统计: 共 ${summary.total} 项 | 待处理 ${summary.pending} | 进行中 ${summary.in_progress} | 已完成 ${summary.completed} | 已取消 ${summary.cancelled}`,
        data: { todos: items, summary },
      }
    },
  }
}

/**
 * 格式化 todo 工具注入文本（供上下文压缩使用）
 */
export function formatTodoForInjection(store: TodoStore): string | null {
  return store.formatForInjection()
}

/**
 * 构建统计摘要
 */
function buildSummary(items: TodoItem[]) {
  const pending = items.filter(i => i.status === 'pending').length
  const inProgress = items.filter(i => i.status === 'in_progress').length
  const completed = items.filter(i => i.status === 'completed').length
  const cancelled = items.filter(i => i.status === 'cancelled').length
  return { total: items.length, pending, in_progress: inProgress, completed, cancelled }
}

/**
 * 格式化任务列表为可读文本
 */
function formatTodos(items: TodoItem[]): string {
  if (items.length === 0) return '任务列表为空'

  const icons: Record<string, string> = {
    pending: '[ ]',
    in_progress: '[>]',
    completed: '[x]',
    cancelled: '[~]',
  }
  const lines = items.map(t =>
    `  ${icons[t.status] ?? '[?]'} [${t.id}] (${t.status}): ${t.content}`
  )
  return `任务列表 (${items.length} 项):\n${lines.join('\n')}`
}
