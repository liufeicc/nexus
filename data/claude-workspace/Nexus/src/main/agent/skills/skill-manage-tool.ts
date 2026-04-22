/**
 * Skill 管理工具
 *
 * 提供 skill_manage 工具，支持创建、编辑、修改、删除 skill 及其文件。
 */

import { ToolDefinition } from '../../../core/types/agent'
import { SkillManager } from './skill-manager'

/**
 * 创建 Skill 管理工具
 */
export function createSkillManageTool(skillManager: SkillManager): ToolDefinition {
  return {
    name: 'skill_manage',
    description: '创建、编辑、修改、删除 skill 及管理其文件。'
      + 'action 值: "create" 新建, "edit" 替换, "patch" 修改, '
      + '"delete" 删除, "write_file" 写文件, "remove_file" 删文件',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'edit', 'patch', 'delete', 'write_file', 'remove_file'],
          description: '要执行的管理操作',
        },
        name: {
          type: 'string',
          description: 'skill 名称（除 "create" 外所有操作必填）',
        },
        category: {
          type: 'string',
          description: '"create" 操作的分类（如 "productivity"）',
        },
        content: {
          type: 'string',
          description: '"create"/"edit" 的完整 SKILL.md 内容，或 "write_file" 的文件内容',
        },
        frontmatter: {
          type: 'object',
          description: '"patch" 操作要更新的 frontmatter 字段',
        },
        body_append: {
          type: 'string',
          description: '"patch" 操作追加到 SKILL.md body 的文本',
        },
        file_path: {
          type: 'string',
          description: 'skill 目录内的相对文件路径（用于 "write_file"/"remove_file"）',
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
            const category = typeof args.category === 'string' ? args.category : 'general'
            const content = typeof args.content === 'string' ? args.content : ''

            if (!name) {
              return { success: false, output: '错误: create 操作需要 name 参数' }
            }

            result = skillManager.createSkill(name, category, undefined, content)
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

            result = skillManager.editSkill(name, content)
            break
          }

          case 'patch': {
            const name = typeof args.name === 'string' ? args.name : ''

            if (!name) {
              return { success: false, output: '错误: patch 操作需要 name 参数' }
            }

            result = skillManager.patchSkill(name, {
              frontmatter: typeof args.frontmatter === 'object' && args.frontmatter !== null ? args.frontmatter as Record<string, unknown> : undefined,
              bodyAppend: typeof args.body_append === 'string' ? args.body_append : undefined,
            })
            break
          }

          case 'delete': {
            const name = typeof args.name === 'string' ? args.name : ''

            if (!name) {
              return { success: false, output: '错误: delete 操作需要 name 参数' }
            }

            result = skillManager.deleteSkill(name)
            break
          }

          case 'write_file': {
            const name = typeof args.name === 'string' ? args.name : ''
            const filePath = typeof args.file_path === 'string' ? args.file_path : ''
            const content = typeof args.content === 'string' ? args.content : ''

            if (!name || !filePath) {
              return { success: false, output: '错误: write_file 操作需要 name 和 file_path 参数' }
            }

            result = skillManager.writeSkillFile(name, filePath, content)
            break
          }

          case 'remove_file': {
            const name = typeof args.name === 'string' ? args.name : ''
            const filePath = typeof args.file_path === 'string' ? args.file_path : ''

            if (!name || !filePath) {
              return { success: false, output: '错误: remove_file 操作需要 name 和 file_path 参数' }
            }

            result = skillManager.removeSkillFile(name, filePath)
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
        return { success: false, output: `skill_manage 失败: ${error}` }
      }
    },
  }
}
