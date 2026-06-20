/**
 * 智能体 Task 系统类型定义
 *
 * 涵盖 Task 文件结构、Task 元数据、内容、CRUD 操作结果。
 * 与 Skill 相比更轻量：无 frontmatter、无分类、无关联文件。
 */

// ==================== Task 解析 ====================

/** 解析后的 Task 内容 */
export interface ParsedTask {
  /** 任务标题（从文件第一行 # 标题 或文件名提取） */
  title: string
  /** Markdown body，即步骤描述 */
  body: string
  /** 原始完整内容 */
  rawContent: string
}

// ==================== 渐进式披露 ====================

/** Tier 1：tasks_list 返回的轻量元数据 */
export interface TaskMeta {
  name: string          // 文件名（不含 .md）
  title: string         // 标题
  description: string   // 描述预览（截断后）
}

/** Tier 2：task_view 返回的完整内容 */
export interface TaskContent {
  name: string
  title: string
  content: string       // 完整 .md 文件内容
}

// ==================== CRUD 操作 ====================

/** Task CRUD 操作类型 */
export type TaskManageAction =
  | 'create'      // 创建新 Task .md 文件
  | 'edit'        // 替换整个 Task .md 内容
  | 'delete'      // 删除 Task .md 文件

/** Task 管理操作结果 */
export interface TaskManageResult {
  success: boolean
  message: string
  taskName?: string
  /** 操作后 tasks 目录下的文件列表 */
  files?: string[]
}
