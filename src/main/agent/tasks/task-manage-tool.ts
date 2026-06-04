/**
 * Task 管理工具
 *
 * 提供 task_manage 工具，支持创建、编辑、删除 task。
 */

import { ToolDefinition } from '../../../core/types/agent'
import { TaskManager } from './task-manager'

/**
 * 创建 Task 管理工具
 */
export function createTaskManageTool(taskManager: TaskManager): ToolDefinition {
  return {
    name: 'task_manage',
    description: '创建、编辑、删除 task。'
      + 'action 值: "create" 新建, "edit" 替换, "delete" 删除',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'edit', 'delete'],
          description: '要执行的管理操作',
        },
        name: {
          type: 'string',
          description: 'task 名称（所有操作必填，小写字母/数字开头，可含点、下划线、连字符）',
        },
        content: {
          type: 'string',
          description: '"create"/"edit" 的完整 Task .md 内容',
        },
      },
      required: ['action'],
    },
    handler: async (args) => {
      const action = args.action as string
      try {
        let result

        switch (action) {
          case 'create': {
            const name = typeof args.name === 'string' ? args.name : ''
            const content = typeof args.content === 'string' ? args.content : ''

            if (!name) {
              return { success: false, output: '错误: create 操作需要 name 参数' }
            }

            result = taskManager.createTask(name, content)
            break
          }

          case 'edit': {
            const name = typeof args.name === 'string' ? args.name : ''
            const content = typeof args.content === 'string' ? args.content : ''

            if (!name) {
              return { success: false, output: '错误: edit 操作需要 name 参数' }
            }
            if (!content) {
              return { success: false, output: '错误: edit 操作需要 content 参数' }
            }

            result = taskManager.editTask(name, content)
            break
          }

          case 'delete': {
            const name = typeof args.name === 'string' ? args.name : ''

            if (!name) {
              return { success: false, output: '错误: delete 操作需要 name 参数' }
            }

            result = taskManager.deleteTask(name)
            break
          }

          default:
            return { success: false, output: `错误: 未知操作 "${action}"` }
        }

        const filesList = result.files
          ? `\n\n文件列表: ${result.files.join(', ')}`
          : ''

        return {
          success: result.success,
          output: `${result.message}${filesList}`,
        }
      } catch (error) {
        return { success: false, output: `task_manage 失败: ${error}` }
      }
    },
  }
}
