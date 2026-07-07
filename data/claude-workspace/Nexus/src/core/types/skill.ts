/**
 * 智能体 Skill 系统类型定义
 *
 * 涵盖 SKILL.md 文件结构、Skill 元数据、内容、CRUD 操作及安全扫描结果。
 */

// ==================== SKILL.md 解析 ====================

/** SKILL.md YAML frontmatter */
export interface SkillFrontmatter {
  /** Skill 唯一标识，正则 ^[a-z0-9][a-z0-9._-]*$，max 64 字符 */
  name: string
  /** 简要描述，skills_list 中显示，max 1024 字符 */
  description: string
  /** 语义化版本，如 "1.0.0" */
  version?: string
  /** 作者，如 "community" */
  author?: string
  /** 许可证，如 "MIT" */
  license?: string
  /** 平台限制：["macos", "linux", "windows"] */
  platforms?: string[]
  /** 标签列表 */
  tags?: string[]
  /** 运行前提 */
  prerequisites?: {
    /** 需要的环境变量名 */
    env_vars?: string[]
    /** 需要的命令行工具 */
    commands?: string[]
  }
  /** 扩展元数据 */
  metadata?: {
    nexus?: {
      /** 分类标签 */
      tags?: string[]
      /** 关联 skill 名称列表 */
      related_skills?: string[]
      /** 项目主页 */
      homepage?: string
    }
  }
}

/** 解析后的 SKILL.md 内容 */
export interface ParsedSkill {
  frontmatter: SkillFrontmatter
  /** Markdown body 部分 */
  body: string
  /** 原始完整内容（编辑时用） */
  rawContent: string
}

// ==================== 渐进式披露 ====================

/** Tier 1：skills_list 返回的轻量元数据 */
export interface SkillMeta {
  name: string
  description: string
  /** 分类目录，如 "mlops"、"creative" */
  category: string | null
  /** 相对路径，如 "mlops/axolotl" */
  path: string
  /** 是否兼容当前平台 */
  platformCompatible: boolean
  /** 就绪状态：available / setup_needed / unsupported */
  readinessStatus: 'available' | 'setup_needed' | 'unsupported'
  /** 信任等级：builtin / trusted / community / agent-created */
  trustLevel: 'builtin' | 'trusted' | 'community' | 'agent-created'
  /** 缺失的必要环境变量 */
  missingEnvVars: string[]
}

/** Tier 2：skill_view 返回的完整内容 */
export interface SkillContent {
  name: string
  description: string
  /** SKILL.md 完整内容 */
  content: string
  /** 关联文件列表 */
  linkedFiles: {
    references?: string[]
    templates?: string[]
    assets?: string[]
    scripts?: string[]
  } | null
  tags: string[]
  relatedSkills: string[]
  /** 安全警告（如检测到 prompt injection） */
  warnings: string[]
}

// ==================== CRUD 操作 ====================

/** Skill CRUD 操作类型 */
export type SkillManageAction =
  | 'create'      // 创建新 skill 目录 + SKILL.md
  | 'edit'        // 替换整个 SKILL.md 内容
  | 'patch'       // 更新 frontmatter 字段或追加 body
  | 'delete'      // 删除整个 skill 目录
  | 'write_file'  // 在 skill 目录内创建/覆盖文件
  | 'remove_file' // 删除 skill 目录内的文件

/** Skill 管理操作结果 */
export interface SkillManageResult {
  success: boolean
  message: string
  skillName?: string
  /** 操作后 skill 目录下的文件列表 */
  files?: string[]
}

// ==================== 安全扫描 ====================

/** 安全扫描结果 */
export interface SecurityScanResult {
  /** 发现的威胁列表 */
  findings: string[]
  /** 威胁等级：info / warning / critical */
  severity: 'info' | 'warning' | 'critical'
  /** 是否阻止 */
  blocked: boolean
}
