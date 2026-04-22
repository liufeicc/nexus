/**
 * Skill 查询工具
 *
 * 提供 skills_list 和 skill_view 两个工具，实现渐进式披露。
 */

import { ToolDefinition } from '../../../core/types/agent'
import { SkillManager } from './skill-manager'

/**
 * 创建 Skill 查询工具列表
 */
export function createSkillTools(skillManager: SkillManager): ToolDefinition[] {
  return [createSkillsListTool(skillManager), createSkillViewTool(skillManager)]
}

// ==================== skills_list 工具 ====================

function createSkillsListTool(skillManager: SkillManager): ToolDefinition {
  return {
    name: 'skills_list',
    description: '列出所有可用 skill 的元数据（名称、描述、分类）。'
      + '仅返回轻量信息，不加载完整内容。'
      + '使用 skill_view(name) 加载某个 skill 的完整指令。'
      + '在决定使用任何工具之前，先调用此工具了解可用 skill。',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: '可选的分类过滤（如 "software-development"）',
        },
      },
      required: [],
    },
    handler: async (args) => {
      try {
        const category = typeof args.category === 'string' ? args.category : undefined
        const skills = skillManager.listSkills(category)

        if (skills.length === 0) {
          return {
            success: true,
            output: category
              ? `分类 "${category}" 下没有可用 skill。`
              : '没有可用 skill。使用 skill_manage 的 "create" 操作创建新 skill。',
          }
        }

        // 格式化输出
        const lines = skills.map(s => {
          const status = s.platformCompatible
            ? (s.readinessStatus === 'available' ? '✅' : '⚙️')
            : '❌'
          return `${status} **${s.name}** (${s.category || 'general'}): ${s.description}`
        })

        return {
          success: true,
          output: `## 可用 Skill\n\n${lines.join('\n')}\n\n使用 skill_view(name) 加载某个 skill 的完整指令。`,
        }
      } catch (error) {
        return { success: false, output: `skills_list 失败: ${error}` }
      }
    },
  }
}

// ==================== skill_view 工具 ====================

function createSkillViewTool(skillManager: SkillManager): ToolDefinition {
  return {
    name: 'skill_view',
    description: '加载 skill 的完整指令和内容。'
      + '首次调用返回 SKILL.md 内容和 linkedFiles 字典（显示可用的参考/模板/脚本）。'
      + '要访问 linkedFiles，再次调用时传入 file_path 参数。',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'skill 名称（使用 skills_list 查看所有可用 skill）',
        },
        file_path: {
          type: 'string',
          description: '可选：skill 目录内的相对路径（如 "references/api.md"）。'
            + '省略则返回 SKILL.md 内容。',
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

        const filePath = typeof args.file_path === 'string' ? args.file_path : undefined
        const result = skillManager.getSkillContent(name, filePath)

        // 构建输出
        let output = `# ${result.name}\n\n`
        if (result.warnings.length > 0) {
          output += `⚠️ **安全警告**: ${result.warnings.join(', ')}\n\n`
        }

        if (result.linkedFiles) {
          output += '## 关联文件\n\n'
          for (const [type, files] of Object.entries(result.linkedFiles)) {
            output += `### ${type}\n`
            for (const file of files) {
              output += `- \`${file}\`\n`
            }
            output += '\n'
          }
          if (!filePath) {
            output += '要查看特定文件内容，调用 skill_view 并传入 file_path 参数。\n\n'
          }
        }

        if (filePath) {
          output += `## 文件内容: \`${filePath}\`\n\n${result.content}`
        } else {
          output += result.content
        }

        return { success: true, output }
      } catch (error) {
        return { success: false, output: `skill_view 失败: ${error}` }
      }
    },
  }
}
