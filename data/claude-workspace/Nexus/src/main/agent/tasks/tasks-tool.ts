/**
 * Task 查询工具
 *
 * 提供 tasks_list 和 task_view 两个工具，实现渐进式披露。
 */

import { ToolDefinition } from '../../../core/types/agent'
import { TaskManager } from './task-manager'

/**
 * 创建 Task 查询工具列表
 */
export function createTaskTools(taskManager: TaskManager): ToolDefinition[] {
  return [createTasksListTool(taskManager), createTaskViewTool(taskManager)]
}

// ==================== tasks_list 工具 ====================

function createTasksListTool(taskManager: TaskManager): ToolDefinition {
  return {
    name: 'tasks_list',
    description: '列出所有可用 task 的元数据（名称、标题、描述预览）。'
      + '仅返回轻量信息，不加载完整内容。'
      + '使用 task_view(name) 加载某个 task 的完整内容。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      try {
        const tasks = taskManager.listTasks()

        if (tasks.length === 0) {
          return {
            success: true,
            output: '没有可用 task。使用 task_manage 的 "create" 操作创建新 task。',
          }
        }

        // 格式化输出
        const lines = tasks.map(t => {
          const desc = t.description.length > 100 ? t.description.slice(0, 100) + '...' : t.description
          return `- **${t.name}** (${t.title}): ${desc}`
        })

        return {
          success: true,
          output: `## 可用 Task\n\n${lines.join('\n')}\n\n使用 task_view(name) 加载某个 task 的完整内容。`,
        }
      } catch (error) {
        return { success: false, output: `tasks_list 失败: ${error}` }
      }
    },
  }
}

// ==================== task_view 工具 ====================

function createTaskViewTool(taskManager: TaskManager): ToolDefinition {
  return {
    name: 'task_view',
    description: '加载 task 的完整内容（标题、步骤描述）。'
      + '在执行 task 之前，先调用此工具了解详细步骤。',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'task 名称（使用 tasks_list 查看所有可用 task）',
        },
      },
      required: ['name'],
    },
    handler: async (args) => {
      try {
        const name = typeof args.name === 'string' ? args.name : ''
        if (!name) {
          return { success: false, output: '错误: name 参数必填' }
        }

        const result = taskManager.getTaskContent(name)

        let output = `# ${result.title}\n\n`
        output += result.content

        return { success: true, output }
      } catch (error) {
        return { success: false, output: `task_view 失败: ${error}` }
      }
    },
  }
}
