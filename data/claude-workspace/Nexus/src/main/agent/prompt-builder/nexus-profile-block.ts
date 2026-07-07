import type { PromptLanguage } from './types'

/**
 * 构建目录档案 .NEXUS.md 说明 block
 *
 * 注入到 system prompt 中，让模型了解 .NEXUS.md 的作用并主动调用相关工具。
 */
export function buildNexusProfileBlock(language: PromptLanguage, cwd?: string): string {
  switch (language) {
    case 'zh':
      return (
        '# 目录档案 .NEXUS.md\n'
        + '项目中可能存在 `.NEXUS.md` 文件，它是对所在目录的描述，包含：\n'
        + '- 目录概述\n'
        + '- 重要文件/目录结构\n\n'
        + '你拥有以下工具来管理目录档案：\n'
        + `- \`nexus_profile_scan\`：扫描目录下哪些子目录存在 .NEXUS.md（参数: dir）\n`
        + `- \`nexus_profile_read\`：读取指定目录下的 .NEXUS.md 内容（参数: dir）\n`
        + `- \`nexus_profile_write\`：写入/创建 .NEXUS.md（参数: dir, content）\n\n`
        + '使用建议：\n'
        + '- 进入新目录或面对不熟悉的项目时，先用 \`nexus_profile_scan\` 查看哪些子目录已有描述\n'
        + '- 对感兴趣的目录，使用 \`nexus_profile_read\` 了解项目背景和技术栈\n'
        + '- 如果目录下不存在 .NEXUS.md，你可以分析目录结构后使用 \`nexus_profile_write\` 创建\n'
        + '- 目录结构发生重大变化时，主动更新 .NEXUS.md'
        + (cwd ? `\n\n当前工作目录：\`${cwd}\`` : '')
      )
    default:
      return (
        '# Directory Profile .NEXUS.md\n'
        + 'Projects may contain `.NEXUS.md` files, which describe their parent directory including:\n'
        + '- Directory overview\n'
        + '- Important files/directory structure\n\n'
        + 'You have the following tools to manage directory profiles:\n'
        + `- \`nexus_profile_scan\`: Scan which subdirectories contain .NEXUS.md (param: dir)\n`
        + `- \`nexus_profile_read\`: Read the .NEXUS.md content of a directory (param: dir)\n`
        + `- \`nexus_profile_write\`: Write/create a .NEXUS.md (params: dir, content)\n\n`
        + 'Usage guidelines:\n'
        + '- When entering a new directory or unfamiliar project, use \`nexus_profile_scan\` first\n'
        + '- Use \`nexus_profile_read\` to understand project background and tech stack\n'
        + '- If .NEXUS.md does not exist, analyze the structure and use \`nexus_profile_write\` to create one\n'
        + '- Proactively update .NEXUS.md when directory structure changes significantly'
        + (cwd ? `\n\nCurrent working directory: \`${cwd}\`` : '')
      )
  }
}
