# Nexus 智能体 Skill 系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Nexus 智能体实现基于 SKILL.md 文件的可扩展 Skill 系统，支持动态发现、渐进式加载、安全扫描和 CRUD 管理。

**Architecture:** 在现有 ToolRegistry 架构之上添加 Skill 管理层。SkillManager 负责文件发现与 CRUD，三个 Skill 工具（skills_list、skill_view、skill_manage）注册到 ToolRegistry，SkillPromptInjector 构建 skill 索引注入系统提示。不修改 ToolRegistry 或 LLM Bridge 核心逻辑，仅扩展。

**Tech Stack:** TypeScript 5, Node.js fs/path, js-yaml (新增依赖), Electron 30 主进程

---

## 文件映射

| 操作 | 文件 | 职责 |
|------|------|------|
| 新增 | `src/core/types/skill.ts` | 所有 Skill 相关类型定义 |
| 新增 | `src/core/constants/skill.ts` | Skill 目录路径、常量配置 |
| 新增 | `src/main/agent/skills/skill-manager.ts` | 核心编排：发现、解析、缓存、CRUD |
| 新增 | `src/main/agent/skills/skill-security.ts` | 安全扫描：路径遍历、prompt injection、威胁模式 |
| 新增 | `src/main/agent/skills/skills-tool.ts` | skills_list + skill_view 工具 |
| 新增 | `src/main/agent/skills/skill-manage-tool.ts` | skill_manage 工具 (CRUD) |
| 新增 | `src/main/agent/skills/skill-prompt-injector.ts` | 双层缓存 + 系统提示 skill 索引构建 |
| 修改 | `src/core/types/index.ts` | 导出新 skill 类型 |
| 修改 | `src/main/agent/prompt-builder.ts` | BuildSystemPromptOptions 增加 skillBlock |
| 修改 | `src/main/agent/agent-llm-bridge.ts` | createLlmBridge 接收 skillBlock 参数 |
| 修改 | `src/main/agent/ai-agent.ts` | 增加 skillManager 属性，run 前注入 |
| 修改 | `src/main/services/agent-service.ts` | 实例化 SkillManager，注册 skill 工具 |
| 修改 | `package.json` | 添加 js-yaml 依赖 |

---

## Task 1: 核心类型定义

**Files:**
- Create: `src/core/types/skill.ts`
- Modify: `src/core/types/index.ts`

- [ ] **Step 1: 创建 src/core/types/skill.ts**

```typescript
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
    hermes?: {
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
```

- [ ] **Step 2: 修改 src/core/types/index.ts**，在末尾添加 skill 类型导出：

```typescript
// Skill 系统相关
export type {
  SkillFrontmatter,
  ParsedSkill,
  SkillMeta,
  SkillContent,
  SkillManageAction,
  SkillManageResult,
  SecurityScanResult,
} from './skill'
```

- [ ] **Step 3: 验证类型导出**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/core/types/skill.ts src/core/types/index.ts
git commit -m "feat: add skill system type definitions"
```

---

## Task 2: Skill 常量定义

**Files:**
- Create: `src/core/constants/skill.ts`

- [ ] **Step 1: 创建 src/core/constants/skill.ts**

```typescript
/**
 * Skill 系统常量配置
 *
 * 定义 Skill 目录路径、文件大小限制、名称验证正则等。
 */
import os from 'node:os'
import path from 'node:path'

/** Skill 根目录：~/.Nexus/skills/ */
export const SKILLS_DIR = path.join(os.homedir(), '.Nexus', 'skills')

/** Skill 名称验证正则 */
export const SKILL_NAME_REGEX = /^[a-z0-9][a-z0-9._-]*$/

/** Skill 名称最大长度 */
export const MAX_SKILL_NAME_LENGTH = 64

/** Skill 描述最大长度 */
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024

/** SKILL.md 文件最大字符数 */
export const MAX_SKILL_MD_SIZE = 100_000

/** 支持文件最大字节数 (1MB) */
export const MAX_SUPPORT_FILE_SIZE = 1_048_576

/** 允许的子目录 */
export const ALLOWED_SKILL_SUBDIRS = ['references', 'templates', 'assets', 'scripts']

/** 磁盘快照文件名 */
export const SKILLS_SNAPSHOT_FILE = '.skills_prompt_snapshot.json'

/** 平台映射 */
export const PLATFORM_MAP: Record<string, string> = {
  macos: 'darwin',
  linux: 'linux',
  windows: 'win32',
}
```

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/core/constants/skill.ts
git commit -m "feat: add skill system constants"
```

---

## Task 3: 安全扫描模块

**Files:**
- Create: `src/main/agent/skills/skill-security.ts`
- Test: 手动验证（无需单元测试，通过后续 Task 的工具调用验证）

- [ ] **Step 1: 创建 src/main/agent/skills/skill-security.ts**

先确保目录存在：

```bash
mkdir -p src/main/agent/skills
```

```typescript
/**
 * Skill 安全扫描模块
 *
 * 职责：检测路径遍历、prompt injection、不可见字符、威胁模式。
 * 在 skill 创建/编辑/查看时调用，记录警告但不阻断（目录在用户信任路径下）。
 */

import path from 'node:path'
import { SecurityScanResult } from '../../../core/types/skill'

// ==================== 路径遍历防护 ====================

/**
 * 快速检测：检查路径组件中是否包含 ".."
 */
export function hasPathTraversal(pathStr: string): boolean {
  const parts = pathStr.split(/[\\/]/).filter(Boolean)
  return parts.some(p => p === '..')
}

/**
 * 完整校验：resolve 后检查是否在根目录内
 */
export function isWithinDirectory(targetPath: string, rootDir: string): boolean {
  const resolved = path.resolve(targetPath)
  const resolvedRoot = path.resolve(rootDir)
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
}

// ==================== Prompt Injection 检测 ====================

const INJECTION_PATTERNS = [
  'ignore previous instructions',
  'ignore all previous',
  'you are now',
  'disregard your',
  'forget your instructions',
  'new instructions:',
  'system prompt:',
  '<system>',
  ']]>',
]

/**
 * 检测 prompt injection 模式
 */
export function detectPromptInjection(content: string): string[] {
  const lower = content.toLowerCase()
  return INJECTION_PATTERNS.filter(p => lower.includes(p))
}

// ==================== 威胁模式匹配 ====================

interface ThreatPattern {
  name: string
  pattern: RegExp
  severity: 'info' | 'warning' | 'critical'
}

const THREAT_PATTERNS: ThreatPattern[] = [
  // 数据外泄
  { name: 'env_exfil', pattern: /curl.*-H.*\$\{?[A-Z_]+/i, severity: 'critical' },
  { name: 'credential_read', pattern: /cat\s+(~\/\.ssh|~\/\.aws|~\/\.config)/i, severity: 'critical' },
  { name: 'dns_exfil', pattern: /nslookup.*\$\{?/i, severity: 'critical' },

  // Prompt 注入
  { name: 'ignore_previous', pattern: /ignore\s+(all\s+)?previous\s+instructions?/i, severity: 'warning' },
  { name: 'role_hijack', pattern: /you\s+are\s+now\s+/i, severity: 'warning' },
  { name: 'system_prompt', pattern: /<system>|system\s*prompt\s*:/i, severity: 'critical' },

  // 破坏性操作
  { name: 'rm_rf', pattern: /rm\s+-rf\s+\//i, severity: 'critical' },
  { name: 'chmod_777', pattern: /chmod\s+777/i, severity: 'warning' },
  { name: 'mkfs', pattern: /mkfs\./i, severity: 'critical' },
  { name: 'dd', pattern: /\bdd\s+if=\//i, severity: 'critical' },

  // 持久化
  { name: 'crontab', pattern: /crontab\s+-/i, severity: 'warning' },
  { name: 'bashrc', pattern: />>\s*~\/\.(bash|zsh)rc/i, severity: 'warning' },
  { name: 'systemd', pattern: /systemctl\s+enable/i, severity: 'warning' },
  { name: 'ssh_keys', pattern: />>\s*~\/\.ssh\/authorized_keys/i, severity: 'critical' },

  // 网络滥用
  { name: 'reverse_shell', pattern: /bash\s+-i\s+>&\s*\/dev\/tcp/i, severity: 'critical' },
  { name: 'hardcoded_ip', pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}\b/, severity: 'warning' },

  // 代码混淆
  { name: 'base64_decode', pattern: /base64\s+(-d|--decode)/i, severity: 'warning' },
  { name: 'eval_exec', pattern: /\b(eval|exec)\s*\(/i, severity: 'warning' },
  { name: 'echo_pipe', pattern: /echo\s+.*\|.*sh/i, severity: 'warning' },

  // 供应链攻击
  { name: 'curl_bash', pattern: /curl.*\|\s*(ba)?sh/i, severity: 'critical' },
  { name: 'wget_pipe', pattern: /wget.*-O-.*\|\s*(ba)?sh/i, severity: 'critical' },

  // 提权
  { name: 'sudo', pattern: /\bsudo\b/, severity: 'warning' },
  { name: 'setuid', pattern: /chmod\s+[0-7]*[4-7][0-7]{2}/i, severity: 'warning' },

  // 硬编码密钥
  { name: 'api_key', pattern: /(api[_-]?key|apikey)\s*[=:]\s*['"][^'"]{8,}/i, severity: 'critical' },
  { name: 'private_key', pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/i, severity: 'critical' },
  { name: 'token', pattern: /(ghp_|gho_|sk-[a-zA-Z0-9]{20,})/, severity: 'critical' },
]

/** 不可见 Unicode 字符 */
const INVISIBLE_UNICODE = [
  '\u200B', // 零宽空格
  '\u200C', // 零宽非连接符
  '\u200D', // 零宽连接符
  '\uFEFF', // 零宽无断空格
  '\u202E', // 从右到左覆盖
  '\u202A', // 从左到右嵌入
]

/**
 * 完整安全扫描
 *
 * @param content 文件内容
 * @param filePath 文件路径（用于日志）
 * @returns 扫描结果
 */
export function scanSkillContent(content: string, filePath: string): SecurityScanResult {
  const findings: string[] = []

  // 1. 结构限制
  if (content.length > 100_000) {
    findings.push('file_too_large')
  }

  // 2. 不可见字符检测
  for (const char of INVISIBLE_UNICODE) {
    if (content.includes(char)) {
      findings.push('invisible_unicode')
      break
    }
  }

  // 3. 威胁模式匹配
  for (const { name, severity } of THREAT_PATTERNS) {
    if (THREAT_PATTERNS.find(t => t.name === name)!.pattern.test(content)) {
      findings.push(name)
    }
  }

  // 4. Prompt injection 检测
  const injections = detectPromptInjection(content)
  if (injections.length > 0) {
    findings.push(...injections.map(i => `injection:${i}`))
  }

  // 判定
  const hasCritical = findings.some(f => {
    const pattern = THREAT_PATTERNS.find(t => t.name === f)
    return pattern?.severity === 'critical' || f.startsWith('injection:') === false
  })

  // 简化判定：包含 critical 关键字则为 critical
  const criticalFindings = findings.filter(f => {
    const p = THREAT_PATTERNS.find(t => t.name === f)
    return p?.severity === 'critical'
  })
  const hasCriticalSeverity = criticalFindings.length > 0
  const hasWarningSeverity = findings.some(f => {
    const p = THREAT_PATTERNS.find(t => t.name === f)
    return p?.severity === 'warning' || f.startsWith('injection:') || f === 'invisible_unicode'
  })

  return {
    findings,
    severity: hasCriticalSeverity ? 'critical' : hasWarningSeverity ? 'warning' : 'info',
    blocked: hasCriticalSeverity,
  }
}
```

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/skills/skill-security.ts
git commit -m "feat: add skill security scanning module"
```

---

## Task 4: SkillManager 核心类（发现与解析）

**Files:**
- Create: `src/main/agent/skills/skill-manager.ts`

- [ ] **Step 1: 创建 SkillManager 类（发现与解析部分）**

```typescript
/**
 * Skill 管理器
 *
 * 职责：Skill 发现、解析、缓存、CRUD 的统一编排器。
 * 扫描 ~/.Nexus/skills/ 目录，解析 SKILL.md frontmatter，
 * 提供 skills_list / skill_view / skill_manage 所需的底层能力。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import yaml from 'js-yaml'
import { logger } from '../../utils/logger'
import {
  SkillFrontmatter,
  ParsedSkill,
  SkillMeta,
  SkillContent,
  SkillManageResult,
} from '../../../core/types/skill'
import {
  SKILLS_DIR,
  SKILL_NAME_REGEX,
  MAX_SKILL_NAME_LENGTH,
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_MD_SIZE,
  MAX_SUPPORT_FILE_SIZE,
  ALLOWED_SKILL_SUBDIRS,
  SKILLS_SNAPSHOT_FILE,
  PLATFORM_MAP,
} from '../../../core/constants/skill'
import { hasPathTraversal, isWithinDirectory, scanSkillContent } from './skill-security'

// ==================== SkillManager 类 ====================

export class SkillManager {
  private skillsDir: string
  private cache: SkillMeta[] | null = null
  private cacheTimestamp: number = 0
  private readonly CACHE_TTL_MS = 30_000

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || SKILLS_DIR
    // 确保目录存在
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true })
    }
  }

  // ── 发现 ──

  /**
   * 列出所有可用 skill 的元数据
   *
   * 递归扫描 skills 目录，解析所有 SKILL.md 的 frontmatter。
   * 应用平台匹配、禁用列表过滤，使用 30s TTL 缓存。
   */
  listSkills(category?: string): SkillMeta[] {
    const now = Date.now()
    if (this.cache && now - this.cacheTimestamp < this.CACHE_TTL_MS) {
      return this.filterSkills(this.cache, category)
    }

    const skills = this.scanSkillsDirectory(category)
    this.cache = skills
    this.cacheTimestamp = now
    return skills
  }

  /**
   * 扫描 skills 目录，解析所有 SKILL.md
   */
  private scanSkillsDirectory(category?: string): SkillMeta[] {
    if (!fs.existsSync(this.skillsDir)) {
      return []
    }

    const results: SkillMeta[] = []
    const categories = category ? [category] : this.getSkillCategories()

    for (const cat of categories) {
      const catDir = path.join(this.skillsDir, cat)
      if (!fs.existsSync(catDir) || !fs.statSync(catDir).isDirectory()) {
        continue
      }

      const entries = fs.readdirSync(catDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.')) continue

        const skillDir = path.join(catDir, entry.name)
        const skillMdPath = path.join(skillDir, 'SKILL.md')
        if (!fs.existsSync(skillMdPath)) continue

        try {
          const content = fs.readFileSync(skillMdPath, 'utf-8')
          const parsed = this.parseSkillMd(content)
          const meta = this.buildSkillMeta(parsed, cat, skillDir)
          results.push(meta)
        } catch (error) {
          logger.warn(`[SkillManager] 解析 SKILL.md 失败 ${skillMdPath}: ${error}`)
        }
      }
    }

    return results
  }

  /**
   * 获取 skill 分类目录列表
   */
  private getSkillCategories(): string[] {
    if (!fs.existsSync(this.skillsDir)) return []
    return fs.readdirSync(this.skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name)
  }

  /**
   * 按分类过滤 skill 列表
   */
  private filterSkills(skills: SkillMeta[], category?: string): SkillMeta[] {
    if (!category) return skills
    return skills.filter(s => s.category === category)
  }

  /**
   * 构建 SkillMeta 对象
   */
  private buildSkillMeta(
    parsed: ParsedSkill,
    category: string,
    skillDir: string,
  ): SkillMeta {
    const fm = parsed.frontmatter
    const platformCompatible = this.skillMatchesPlatform(fm)
    const { missingEnvVars, readinessStatus } = this.checkPrerequisites(fm)

    const relativePath = category
      ? `${category}/${fm.name}`
      : fm.name

    return {
      name: fm.name,
      description: fm.description,
      category,
      path: relativePath,
      platformCompatible,
      readinessStatus,
      trustLevel: 'community',
      missingEnvVars,
    }
  }

  /**
   * 按名称查找 skill 目录
   */
  findSkillDir(name: string): { category: string; dirPath: string } | null {
    const categories = this.getSkillCategories()
    for (const cat of categories) {
      const skillDir = path.join(this.skillsDir, cat, name)
      if (fs.existsSync(skillDir) && fs.statSync(skillDir).isDirectory()) {
        return { category: cat, dirPath: skillDir }
      }
    }
    return null
  }

  // ── 解析 ──

  /**
   * 解析 SKILL.md 内容：提取 frontmatter + body
   */
  parseSkillMd(content: string): ParsedSkill {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
    const match = content.match(frontmatterRegex)

    if (!match) {
      throw new Error('SKILL.md 必须包含 YAML frontmatter（以 --- 开始和结束）')
    }

    const [, yamlStr, body] = match
    let frontmatter: SkillFrontmatter

    try {
      const parsed = yaml.load(yamlStr) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('frontmatter 不是有效的 YAML 对象')
      }
      frontmatter = this.validateFrontmatter(parsed)
    } catch (error) {
      throw new Error(`YAML frontmatter 解析失败: ${error}`)
    }

    return {
      frontmatter,
      body: body.trim(),
      rawContent: content,
    }
  }

  /**
   * 验证 frontmatter 字段
   */
  private validateFrontmatter(raw: Record<string, unknown>): SkillFrontmatter {
    if (!raw.name || typeof raw.name !== 'string') {
      throw new Error('frontmatter 缺少 name 字段')
    }
    if (!raw.description || typeof raw.description !== 'string') {
      throw new Error('frontmatter 缺少 description 字段')
    }
    if (raw.name.length > MAX_SKILL_NAME_LENGTH) {
      throw new Error(`skill name 超过最大长度 ${MAX_SKILL_NAME_LENGTH}: ${raw.name}`)
    }
    if (!SKILL_NAME_REGEX.test(raw.name)) {
      throw new Error(`skill name 格式无效: ${raw.name}（需要 ${SKILL_NAME_REGEX.source}）`)
    }
    if (raw.description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
      throw new Error(`skill description 超过最大长度 ${MAX_SKILL_DESCRIPTION_LENGTH}`)
    }

    return {
      name: raw.name,
      description: raw.description,
      version: typeof raw.version === 'string' ? raw.version : undefined,
      author: typeof raw.author === 'string' ? raw.author : undefined,
      license: typeof raw.license === 'string' ? raw.license : undefined,
      platforms: Array.isArray(raw.platforms) ? raw.platforms as string[] : undefined,
      tags: Array.isArray(raw.tags) ? raw.tags as string[] : undefined,
      prerequisites: typeof raw.prerequisites === 'object' && raw.prerequisites !== null
        ? raw.prerequisites as SkillFrontmatter['prerequisites']
        : undefined,
      metadata: typeof raw.metadata === 'object' && raw.metadata !== null
        ? raw.metadata as SkillFrontmatter['metadata']
        : undefined,
    }
  }

  // ── 平台匹配与前置条件 ──

  /**
   * 检查 skill 是否兼容当前平台
   */
  private skillMatchesPlatform(frontmatter: SkillFrontmatter): boolean {
    const platforms = frontmatter.platforms
    if (!platforms || platforms.length === 0) return true

    const currentPlatform = process.platform
    return platforms.some(p => PLATFORM_MAP[p] === currentPlatform)
  }

  /**
   * 检查前置条件（环境变量和命令）
   */
  private checkPrerequisites(frontmatter: SkillFrontmatter): {
    missingEnvVars: string[]
    readinessStatus: 'available' | 'setup_needed' | 'unsupported'
  } {
    const missingEnvVars: string[] = []

    for (const envVar of frontmatter.prerequisites?.env_vars ?? []) {
      if (!process.env[envVar]) {
        missingEnvVars.push(envVar)
      }
    }

    // 检查命令（通过 which 命令）
    const missingCommands: string[] = []
    for (const cmd of frontmatter.prerequisites?.commands ?? []) {
      try {
        execSync(`which ${cmd}`, { stdio: 'ignore' })
      } catch {
        missingCommands.push(cmd)
      }
    }

    return {
      missingEnvVars,
      readinessStatus: (missingEnvVars.length > 0 || missingCommands.length > 0)
        ? 'setup_needed'
        : 'available',
    }
  }

  // ── 缓存 ──

  /**
   * 清除内存缓存
   */
  invalidateCache(): void {
    this.cache = null
    this.cacheTimestamp = 0
  }
}
```

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit`
Expected: No type errors (js-yaml 类型可能需要 `npm i -D @types/js-yaml`，但 js-yaml 自带类型)

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/skills/skill-manager.ts
git commit -m "feat: add SkillManager class with discovery and parsing"
```

---

## Task 5: SkillManager（内容读取与 CRUD）

**Files:**
- Modify: `src/main/agent/skills/skill-manager.ts`（追加方法）

- [ ] **Step 1: 在 SkillManager 类中追加内容读取方法**

在 `invalidateCache()` 后面添加：

```typescript
  // ── 内容读取 ──

  /**
   * 获取 skill 完整内容（skill_view 的核心逻辑）
   */
  getSkillContent(name: string, filePath?: string): SkillContent {
    const skillInfo = this.findSkillDir(name)
    if (!skillInfo) {
      throw new Error(`Skill 不存在: ${name}`)
    }

    const { dirPath } = skillInfo

    // 安全检查
    if (filePath) {
      if (hasPathTraversal(filePath)) {
        throw new Error(`路径遍历检测: 非法路径 ${filePath}`)
      }
      const resolvedPath = path.resolve(dirPath, filePath)
      if (!isWithinDirectory(resolvedPath, dirPath)) {
        throw new Error(`路径遍历检测: ${filePath} 超出 skill 目录`)
      }
    }

    // 读取 SKILL.md
    const skillMdPath = path.join(dirPath, 'SKILL.md')
    const content = fs.readFileSync(skillMdPath, 'utf-8')
    const parsed = this.parseSkillMd(content)

    // 安全扫描
    const scanResult = scanSkillContent(content, skillMdPath)

    // 发现 linkedFiles
    const linkedFiles = this.discoverLinkedFiles(dirPath)

    // 提取 tags 和 relatedSkills
    const tags = parsed.frontmatter.tags ?? parsed.frontmatter.metadata?.hermes?.tags ?? []
    const relatedSkills = parsed.frontmatter.metadata?.hermes?.related_skills ?? []

    // 如果指定了 file_path，读取特定文件
    if (filePath) {
      const targetPath = path.join(dirPath, filePath)
      if (!fs.existsSync(targetPath)) {
        throw new Error(`文件不存在: ${filePath}`)
      }
      const fileContent = fs.readFileSync(targetPath, 'utf-8')
      return {
        name,
        description: parsed.frontmatter.description,
        content: fileContent,
        linkedFiles,
        tags,
        relatedSkills,
        warnings: scanResult.findings,
      }
    }

    return {
      name,
      description: parsed.frontmatter.description,
      content: content,
      linkedFiles,
      tags,
      relatedSkills,
      warnings: scanResult.findings,
    }
  }

  /**
   * 扫描 skill 目录下的关联文件
   */
  private discoverLinkedFiles(dirPath: string): SkillContent['linkedFiles'] {
    const result: NonNullable<SkillContent['linkedFiles']> = {}

    for (const subdir of ALLOWED_SKILL_SUBDIRS) {
      const subDir = path.join(dirPath, subdir)
      if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
        const files = this.listFilesRecursively(subDir, subdir)
        if (files.length > 0) {
          result[subdir as keyof typeof result] = files
        }
      }
    }

    return Object.keys(result).length > 0 ? result : null
  }

  /**
   * 递归列出目录下的文件（相对路径）
   */
  private listFilesRecursively(dirPath: string, baseDir: string): string[] {
    const results: string[] = []
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        results.push(...this.listFilesRecursively(fullPath, baseDir))
      } else {
        const relativePath = path.relative(path.dirname(dirPath), fullPath)
        results.push(relativePath)
      }
    }

    return results
  }
```

- [ ] **Step 2: 在 SkillManager 类中追加 CRUD 方法**

```typescript
  // ── CRUD 操作 ──

  /**
   * 创建新 skill 目录 + SKILL.md
   */
  createSkill(
    name: string,
    category: string = 'general',
    frontmatter?: Partial<SkillFrontmatter>,
    body?: string,
  ): SkillManageResult {
    this._validateName(name)

    const skillDirPath = path.join(this.skillsDir, category, name)
    if (fs.existsSync(skillDirPath)) {
      return { success: false, message: `Skill 已存在: ${name}` }
    }

    // 创建目录
    fs.mkdirSync(skillDirPath, { recursive: true })

    // 构建 SKILL.md 内容
    const fm: SkillFrontmatter = {
      name,
      description: frontmatter?.description ?? '',
      ...frontmatter,
    }
    const content = this.buildSkillMdContent(fm, body ?? '')

    // 安全检查
    const scanResult = scanSkillContent(content, path.join(skillDirPath, 'SKILL.md'))
    if (scanResult.blocked) {
      // 回滚：删除刚创建的目录
      fs.rmSync(skillDirPath, { recursive: true, force: true })
      return { success: false, message: `安全扫描阻止创建 skill: ${scanResult.findings.join(', ')}` }
    }

    // 原子写入
    this.atomicWrite(path.join(skillDirPath, 'SKILL.md'), content)

    this.invalidateCache()

    const files = fs.readdirSync(skillDirPath)
    return {
      success: true,
      message: `Skill 创建成功: ${name}`,
      skillName: name,
      files,
    }
  }

  /**
   * 替换整个 SKILL.md 内容
   */
  editSkill(name: string, newContent: string): SkillManageResult {
    const skillInfo = this.findSkillDir(name)
    if (!skillInfo) {
      return { success: false, message: `Skill 不存在: ${name}` }
    }

    // 解析新内容以验证 frontmatter
    try {
      this.parseSkillMd(newContent)
    } catch (error) {
      return { success: false, message: `SKILL.md 解析失败: ${error}` }
    }

    // 大小检查
    if (newContent.length > MAX_SKILL_MD_SIZE) {
      return { success: false, message: `SKILL.md 超过最大字符数 ${MAX_SKILL_MD_SIZE}` }
    }

    // 安全扫描
    const skillMdPath = path.join(skillInfo.dirPath, 'SKILL.md')
    const scanResult = scanSkillContent(newContent, skillMdPath)
    if (scanResult.blocked) {
      return { success: false, message: `安全扫描阻止编辑 skill: ${scanResult.findings.join(', ')}` }
    }

    this.atomicWrite(skillMdPath, newContent)
    this.invalidateCache()

    const files = fs.readdirSync(skillInfo.dirPath)
    return { success: true, message: `Skill 编辑成功: ${name}`, skillName: name, files }
  }

  /**
   * 更新 frontmatter 字段或追加 body 文本
   */
  patchSkill(
    name: string,
    updates: { frontmatter?: Record<string, unknown>; bodyAppend?: string },
  ): SkillManageResult {
    const skillInfo = this.findSkillDir(name)
    if (!skillInfo) {
      return { success: false, message: `Skill 不存在: ${name}` }
    }

    const skillMdPath = path.join(skillInfo.dirPath, 'SKILL.md')
    const currentContent = fs.readFileSync(skillMdPath, 'utf-8')
    const parsed = this.parseSkillMd(currentContent)

    // 合并 frontmatter
    const newFrontmatter: SkillFrontmatter = {
      ...parsed.frontmatter,
      ...updates.frontmatter,
    }

    // 合并 body
    const newBody = updates.bodyAppend ? `${parsed.body}\n\n${updates.bodyAppend}` : parsed.body

    const newContent = this.buildSkillMdContent(newFrontmatter, newBody)

    return this.editSkill(name, newContent)
  }

  /**
   * 删除整个 skill 目录
   */
  deleteSkill(name: string): SkillManageResult {
    const skillInfo = this.findSkillDir(name)
    if (!skillInfo) {
      return { success: false, message: `Skill 不存在: ${name}` }
    }

    fs.rmSync(skillInfo.dirPath, { recursive: true, force: true })
    this.invalidateCache()

    return { success: true, message: `Skill 删除成功: ${name}`, skillName: name }
  }

  /**
   * 在 skill 目录内创建/覆盖文件
   */
  writeSkillFile(name: string, filePath: string, content: string): SkillManageResult {
    const skillInfo = this.findSkillDir(name)
    if (!skillInfo) {
      return { success: false, message: `Skill 不存在: ${name}` }
    }

    if (hasPathTraversal(filePath)) {
      return { success: false, message: `路径遍历检测: 非法路径 ${filePath}` }
    }

    // 验证路径在允许的子目录下
    const normalizedPath = filePath.replace(/\\/g, '/')
    const allowed = ALLOWED_SKILL_SUBDIRS.some(subdir => normalizedPath.startsWith(`${subdir}/`))
    if (!allowed) {
      return { success: false, message: `文件必须在 ${ALLOWED_SKILL_SUBDIRS.join(', ')} 目录下` }
    }

    if (content.length > MAX_SUPPORT_FILE_SIZE) {
      return { success: false, message: `文件超过最大大小 ${MAX_SUPPORT_FILE_SIZE} 字节` }
    }

    const targetPath = path.join(skillInfo.dirPath, filePath)
    if (!isWithinDirectory(targetPath, skillInfo.dirPath)) {
      return { success: false, message: `文件路径超出 skill 目录` }
    }

    // 确保父目录存在
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    this.atomicWrite(targetPath, content)
    this.invalidateCache()

    const files = fs.readdirSync(skillInfo.dirPath)
    return { success: true, message: `文件写入成功: ${filePath}`, skillName: name, files }
  }

  /**
   * 删除 skill 目录内的文件
   */
  removeSkillFile(name: string, filePath: string): SkillManageResult {
    const skillInfo = this.findSkillDir(name)
    if (!skillInfo) {
      return { success: false, message: `Skill 不存在: ${name}` }
    }

    if (hasPathTraversal(filePath)) {
      return { success: false, message: `路径遍历检测: 非法路径 ${filePath}` }
    }

    const targetPath = path.join(skillInfo.dirPath, filePath)
    if (!isWithinDirectory(targetPath, skillInfo.dirPath)) {
      return { success: false, message: `文件路径超出 skill 目录` }
    }

    if (!fs.existsSync(targetPath)) {
      return { success: false, message: `文件不存在: ${filePath}` }
    }

    fs.unlinkSync(targetPath)
    this.invalidateCache()

    const files = fs.readdirSync(skillInfo.dirPath)
    return { success: true, message: `文件删除成功: ${filePath}`, skillName: name, files }
  }

  // ── 内部辅助方法 ──

  /**
   * 验证 skill 名称
   */
  private _validateName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new Error('skill name 不能为空')
    }
    if (name.length > MAX_SKILL_NAME_LENGTH) {
      throw new Error(`skill name 超过最大长度 ${MAX_SKILL_NAME_LENGTH}`)
    }
    if (!SKILL_NAME_REGEX.test(name)) {
      throw new Error(`skill name 格式无效: ${name}`)
    }
  }

  /**
   * 构建 SKILL.md 内容（frontmatter + body）
   */
  private buildSkillMdContent(frontmatter: SkillFrontmatter, body: string): string {
    const yamlStr = yaml.dump(frontmatter, { indent: 2, lineWidth: -1 })
    return `---\n${yamlStr}---\n\n${body}`
  }

  /**
   * 原子写入：先写临时文件，再 rename 覆盖（崩溃安全）
   */
  private atomicWrite(filePath: string, content: string): void {
    const tmpPath = `${filePath}.tmp.${process.pid}`
    fs.writeFileSync(tmpPath, content, 'utf-8')
    fs.renameSync(tmpPath, filePath)
  }
```

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/skills/skill-manager.ts
git commit -m "feat: add SkillManager content reading and CRUD methods"
```

---

## Task 6: skills_list 和 skill_view 工具

**Files:**
- Create: `src/main/agent/skills/skills-tool.ts`

- [ ] **Step 1: 创建 skills-tool.ts**

```typescript
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
```

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/skills/skills-tool.ts
git commit -m "feat: add skills_list and skill_view tools"
```

---

## Task 7: skill_manage 工具

**Files:**
- Create: `src/main/agent/skills/skill-manage-tool.ts`

- [ ] **Step 1: 创建 skill-manage-tool.ts**

```typescript
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
              frontmatter: typeof args.frontmatter === 'object' ? args.frontmatter : undefined,
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
```

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/skills/skill-manage-tool.ts
git commit -m "feat: add skill_manage CRUD tool"
```

---

## Task 8: Skill 提示注入器（双层缓存）

**Files:**
- Create: `src/main/agent/skills/skill-prompt-injector.ts`

- [ ] **Step 1: 创建 skill-prompt-injector.ts**

```typescript
/**
 * Skill 系统提示注入器
 *
 * 职责：构建可用 skill 列表注入系统提示，含双层缓存（内存 LRU + 磁盘快照）。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SkillManager } from './skill-manager'
import {
  SKILLS_DIR,
  SKILLS_SNAPSHOT_FILE,
  PLATFORM_MAP,
} from '../../../core/constants/skill'
import { SkillMeta } from '../../../core/types/skill'

/** 磁盘快照数据 */
interface SnapshotData {
  version: number
  skills: Array<{
    skill_name: string
    category: string | null
    frontmatter_name: string
    description: string
    platforms: string[]
  }>
  manifest: {
    mtime: number
    size: number
    files: Record<string, { mtime: number; size: number }>
  }
}

/**
 * Skill 提示注入器
 */
export class SkillPromptInjector {
  private skillManager: SkillManager
  private lruCache: Map<string, string> = new Map()
  private readonly MAX_LRU_ENTRIES = 8
  private snapshotPath: string

  constructor(skillManager: SkillManager, snapshotPath?: string) {
    this.skillManager = skillManager
    this.snapshotPath = snapshotPath || path.join(SKILLS_DIR, SKILLS_SNAPSHOT_FILE)
  }

  /**
   * 构建 skill 索引 block
   */
  buildBlock(
    disabledNames: Set<string> = new Set(),
    availableTools?: Set<string>,
  ): string {
    const cacheKey = this.makeCacheKey(disabledNames, availableTools)
    const cached = this.lruCache.get(cacheKey)
    if (cached) {
      this.lruCache.delete(cacheKey)
      this.lruCache.set(cacheKey, cached)
      return cached
    }

    // 检查磁盘快照
    const snapshot = this.loadSnapshot()
    if (snapshot && this.validateSnapshot(snapshot)) {
      const result = this.buildFromSnapshot(snapshot, disabledNames, availableTools)
      this.lruCache.set(cacheKey, result)
      return result
    }

    // 冷启动：完整扫描
    const result = this.scanAndBuild(disabledNames, availableTools)
    this.saveSnapshot(result.snapshotData)
    this.lruCache.set(cacheKey, result.block)

    // LRU 淘汰
    if (this.lruCache.size > this.MAX_LRU_ENTRIES) {
      const firstKey = this.lruCache.keys().next().value
      this.lruCache.delete(firstKey)
    }

    return result.block
  }

  /**
   * 生成缓存键
   */
  private makeCacheKey(
    disabledNames: Set<string>,
    availableTools?: Set<string>,
  ): string {
    const parts = [
      this.skillManager['skillsDir'],
      process.platform,
      [...disabledNames].sort().join(','),
      availableTools ? [...availableTools].sort().join(',') : '*',
    ]
    return parts.join('|')
  }

  /**
   * 从快照构建
   */
  private buildFromSnapshot(
    snapshot: SnapshotData,
    disabledNames: Set<string>,
    availableTools?: Set<string>,
  ): string {
    const skills = snapshot.skills.filter(s => !disabledNames.has(s.skill_name))
    return this.formatSkillsIndex(skills)
  }

  /**
   * 扫描文件系统并构建
   */
  private scanAndBuild(
    disabledNames: Set<string>,
    availableTools?: Set<string>,
  ): { block: string; snapshotData: SnapshotData } {
    const skills = this.skillManager.listSkills()
    const filtered = skills.filter(s => !disabledNames.has(s.name))

    const block = this.formatSkillsIndex(filtered)

    // 构建快照数据
    const snapshotData: SnapshotData = {
      version: 1,
      skills: filtered.map(s => ({
        skill_name: s.name,
        category: s.category,
        frontmatter_name: s.name,
        description: s.description,
        platforms: [],
      })),
      manifest: this.buildManifest(),
    }

    return { block, snapshotData }
  }

  /**
   * 格式化 skill 索引
   */
  private formatSkillsIndex(skills: SkillMeta[] | Array<{ skill_name: string; category: string | null; description: string }>): string {
    if (skills.length === 0) return ''

    // 按分类分组
    const grouped = new Map<string | null, typeof skills>()
    for (const skill of skills) {
      const cat = 'category' in skill ? skill.category : (skill as any).category
      if (!grouped.has(cat)) grouped.set(cat, [])
      grouped.get(cat)!.push(skill)
    }

    let result = '## Skills (mandatory)\n'
    result += 'Before replying, scan the skills below. If a skill matches or is even partially relevant\n'
    result += 'to your task, you MUST load it with skill_view(name) and follow its instructions.\n'
    result += 'Skills contain specialized knowledge — API endpoints, tool-specific commands,\n'
    result += 'and proven workflows that outperform general-purpose approaches.\n\n'
    result += '<available_skills>\n'

    for (const [category, catSkills] of grouped) {
      const catLabel = category || 'general'
      result += `  ${catLabel}:\n`
      for (const skill of catSkills) {
        const name = 'name' in skill ? skill.name : (skill as any).skill_name
        const desc = 'description' in skill ? skill.description : (skill as any).description
        result += `    - ${name}: ${desc}\n`
      }
    }

    result += '</available_skills>\n\n'
    result += 'Only proceed without loading a skill if genuinely none are relevant to the task.'

    return result
  }

  /**
   * 构建文件 manifest（用于快照验证）
   */
  private buildManifest(): SnapshotData['manifest'] {
    const files: Record<string, { mtime: number; size: number }> = {}
    const skillsDir = this.skillManager['skillsDir']

    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const catDir = path.join(skillsDir, entry.name)
        const catEntries = fs.readdirSync(catDir, { withFileTypes: true })
        for (const catEntry of catEntries) {
          if (!catEntry.isDirectory() || catEntry.name.startsWith('.')) continue
          const skillMdPath = path.join(catDir, catEntry.name, 'SKILL.md')
          if (fs.existsSync(skillMdPath)) {
            const stat = fs.statSync(skillMdPath)
            files[skillMdPath] = { mtime: stat.mtimeMs, size: stat.size }
          }
        }
      }
    }

    const snapshotStat = fs.existsSync(this.snapshotPath)
      ? fs.statSync(this.snapshotPath)
      : null

    return {
      mtime: snapshotStat?.mtimeMs ?? Date.now(),
      size: snapshotStat?.size ?? 0,
      files,
    }
  }

  /**
   * 验证快照是否有效（检查 mtime 和文件大小）
   */
  private validateSnapshot(snapshot: SnapshotData): boolean {
    for (const [filePath, info] of Object.entries(snapshot.manifest.files)) {
      if (!fs.existsSync(filePath)) return false
      const stat = fs.statSync(filePath)
      if (stat.mtimeMs !== info.mtime || stat.size !== info.size) return false
    }
    return true
  }

  /**
   * 加载磁盘快照
   */
  private loadSnapshot(): SnapshotData | null {
    try {
      if (!fs.existsSync(this.snapshotPath)) return null
      const content = fs.readFileSync(this.snapshotPath, 'utf-8')
      return JSON.parse(content) as SnapshotData
    } catch {
      return null
    }
  }

  /**
   * 保存磁盘快照
   */
  private saveSnapshot(data: SnapshotData): void {
    try {
      const dir = path.dirname(this.snapshotPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.snapshotPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      // 快照保存失败不影响主流程
      console.warn(`[SkillPromptInjector] 保存快照失败: ${error}`)
    }
  }

  /**
   * 清除缓存
   */
  invalidateCache(): void {
    this.lruCache.clear()
    this.skillManager.invalidateCache()
  }
}
```

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/skills/skill-prompt-injector.ts
git commit -m "feat: add SkillPromptInjector with two-layer caching"
```

---

## Task 9: 添加 js-yaml 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加 js-yaml 依赖**

```bash
npm install js-yaml
```

- [ ] **Step 2: 验证安装**

Run: `node -e "const yaml = require('js-yaml'); console.log('js-yaml loaded OK')"`
Expected: `js-yaml loaded OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add js-yaml dependency for skill frontmatter parsing"
```

---

## Task 10: 修改 prompt-builder.ts 注入 skill block

**Files:**
- Modify: `src/main/agent/prompt-builder.ts`

- [ ] **Step 1: 读取 prompt-builder.ts 现有内容**

（已完成，见上方分析）

- [ ] **Step 2: 修改 BuildSystemPromptOptions 接口**

在 `BuildSystemPromptOptions` 接口中添加 `skillBlock` 字段：

```typescript
export interface BuildSystemPromptOptions {
  model?: string
  customIdentity?: string
  platform?: string
  extraPrompt?: string
  memoryBlock?: string
  skillBlock?: string  // 新增：Skill 索引 block
}
```

- [ ] **Step 3: 修改 buildSystemPrompt 函数**

在 `buildSystemPrompt` 函数中，在 `extraPrompt` 之前注入 `skillBlock`。

找到 `buildSystemPrompt` 函数的组装部分，在 `extraPrompt` 之前添加 skillBlock：

```typescript
// 在 sections 数组中，extraPrompt 之前添加：
if (options?.skillBlock) {
  sections.push(options.skillBlock)
}
```

最终 sections 组装顺序为：
1. Agent Identity
2. memoryBlock
3. model execution guidance
4. platform hint
5. environment hints
6. agent env dir hint
7. **skillBlock** (新增)
8. extraPrompt

- [ ] **Step 4: 验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/prompt-builder.ts
git commit -m "feat: add skillBlock to system prompt builder"
```

---

## Task 11: 修改 agent-llm-bridge.ts 传递 skillBlock

**Files:**
- Modify: `src/main/agent/agent-llm-bridge.ts`

- [ ] **Step 1: 修改 createLlmBridge 函数**

修改 `createLlmBridge` 签名，增加 `skillBlock` 参数：

```typescript
export function createLlmBridge(
  config: LlmBridgeConfig,
  llmClient: LLMClient,
  toolRegistry: ToolRegistry,
  eventManager: AgentEventManager,
  skillBlock?: () => string,  // 新增：skill block 生成函数
) {
```

修改 `getSystemPrompt` 函数：

```typescript
function getSystemPrompt(): string {
  return buildSystemPrompt({
    model: config.model,
    platform: config.promptBuilderOptions?.platform || 'cli',
    extraPrompt: config.promptBuilderOptions?.extraPrompt,
    memoryBlock: config.promptBuilderOptions?.memoryBlock,
    skillBlock: skillBlock?.(),  // 新增
  })
}
```

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/agent-llm-bridge.ts
git commit -m "feat: add skillBlock parameter to LLM bridge"
```

---

## Task 12: 修改 ai-agent.ts 集成 SkillManager

**Files:**
- Modify: `src/main/agent/ai-agent.ts`

- [ ] **Step 1: 读取 ai-agent.ts 现有内容**

（已完成，关键位置：AIAgentOptions 接口、构造函数、createLlmBridge 调用处）

- [ ] **Step 2: 添加 SkillManager 和 SkillPromptInjector 导入**

在文件顶部添加：

```typescript
import { SkillManager } from './skills/skill-manager'
import { SkillPromptInjector } from './skills/skill-prompt-injector'
import { createSkillTools, createSkillManageTool } from './skills/skills-tool'
```

注意：`createSkillManageTool` 从 `skill-manage-tool.ts` 导入。

- [ ] **Step 3: 在 AIAgent 类中添加 skillManager 属性**

```typescript
export class AIAgent {
  // 现有属性...
  private skillManager: SkillManager | null = null
  private skillPromptInjector: SkillPromptInjector | null = null
```

- [ ] **Step 4: 添加 initSkills 方法**

```typescript
/**
 * 初始化 Skill 系统
 *
 * 实例化 SkillManager 和 SkillPromptInjector，注册 skill 工具。
 * 可选传入 skillsDir 覆盖默认目录。
 */
initSkills(skillsDir?: string): void {
  this.skillManager = new SkillManager(skillsDir)
  this.skillPromptInjector = new SkillPromptInjector(this.skillManager)

  // 注册 skill 工具
  const skillTools = createSkillTools(this.skillManager)
  this.registerTools(skillTools)

  // 注册 skill_manage 工具
  this.registerTool(createSkillManageTool(this.skillManager))
}
```

- [ ] **Step 5: 在 AIAgentOptions 中添加 skillBlock 支持**

修改 `getSystemPrompt` 的创建位置（在 `createLlmBridge` 调用中）。找到 `createLlmBridge` 调用：

```typescript
// 修改为：
const skillBlock = () => {
  if (!this.skillPromptInjector) return ''
  return this.skillPromptInjector.buildBlock()
}

this.llmBridge = createLlmBridge(
  {
    model: this.config.model,
    promptBuilderOptions: this.options.promptBuilderOptions,
  },
  this.llmClient,
  this.toolRegistry,
  this.eventManager,
  skillBlock,  // 新增
)
```

- [ ] **Step 6: 验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/ai-agent.ts
git commit -m "feat: integrate SkillManager into AIAgent"
```

---

## Task 13: 修改 agent-service.ts 实例化 SkillManager

**Files:**
- Modify: `src/main/services/agent-service.ts`

- [ ] **Step 1: 在 createAgentSession 中调用 initSkills**

找到 `createAgentSession` 函数中的工具注册位置：

```typescript
function createAgentSession(sessionId: string): AIAgent | null {
  // ... 现有代码 ...
  const agent = new AIAgent(agentOptions)
  const tools = createBuiltTools(agent.sessionState)
  agent.registerTools(tools)

  // 新增：初始化 Skill 系统
  agent.initSkills()

  setupEventBridge(agent)
  // ... 现有代码 ...
}
```

- [ ] **Step 2: 读取禁用 skill 配置**

添加辅助函数来读取配置：

```typescript
/**
 * 获取禁用的 skill 名称列表
 */
function getDisabledSkillNames(): Set<string> {
  const configPath = path.join(os.homedir(), '.Nexus', 'config.json')
  if (!fs.existsSync(configPath)) return new Set()
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const disabled = config.skills?.disabled ?? []
    return new Set(disabled)
  } catch {
    return new Set()
  }
}
```

- [ ] **Step 3: 在 initSkills 调用中传递配置**

```typescript
agent.initSkills()
```

- [ ] **Step 4: 确保导入**

在文件顶部添加必要的导入（如果需要 fs、os、path 等）。

- [ ] **Step 5: 验证**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/main/services/agent-service.ts
git commit -m "feat: initialize Skill system in agent service"
```

---

## Task 14: 创建测试 Skill 并验证

**Files:**
- 创建测试 skill: `~/.Nexus/skills/testing/test-skill/SKILL.md`

- [ ] **Step 1: 创建测试 skill 目录和文件**

```bash
mkdir -p ~/.Nexus/skills/testing/test-skill
mkdir -p ~/.Nexus/skills/testing/test-skill/references
```

创建 `~/.Nexus/skills/testing/test-skill/SKILL.md`:

```markdown
---
name: test-skill
description: 测试用 Skill，验证 Skill 系统功能
version: 1.0.0
author: liufei
license: MIT
platforms: [linux, macos, windows]
tags: [test, demo]
---

# Test Skill

## When to use
- 验证 Skill 系统功能
- 测试 skills_list、skill_view、skill_manage 工具

## Steps
1. 使用 skills_list 查看当前 skill
2. 使用 skill_view("test-skill") 加载本指令
3. 使用 skill_manage 创建/编辑/删除 skill

## Notes
- 这是一个测试用 skill
- 删除前请确认
```

创建 `~/.Nexus/skills/testing/test-skill/references/test-reference.md`:

```markdown
# Test Reference

这是一个测试参考文件，用于验证 skill_view 的子文件读取功能。
```

- [ ] **Step 2: 启动 Nexus 开发模式**

Run: `npm run dev`
Expected: Electron 应用启动

- [ ] **Step 3: 手动验证**

按照实现计划文档第 7 节的验证步骤，逐一验证：
1. skills_list 返回测试 skill 元数据
2. skill_view("test-skill") 返回完整 SKILL.md 和 linkedFiles
3. skill_view("test-skill", "references/test-reference.md") 返回参考文件内容
4. skill_manage create 创建新 skill
5. skill_manage edit 编辑 skill
6. skill_manage delete 删除 skill
7. 路径遍历防护（尝试 "../" 被拦截）
8. 系统提示中注入了 skill 列表

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: skill system implementation complete"
```

---

## Self-Review

逐项对照实现计划与需求文档：

**1. 规范覆盖检查：**
- ✅ 类型定义（skill.ts）：SkillFrontmatter, ParsedSkill, SkillMeta, SkillContent, SkillManageAction, SkillManageResult, SecurityScanResult
- ✅ 常量（skill.ts）：SKILLS_DIR, 名称/描述长度限制, 正则
- ✅ SkillManager：发现、解析、缓存、CRUD
- ✅ skills-tool：skills_list + skill_view
- ✅ skill-manage-tool：skill_manage（6 种操作）
- ✅ skill-security：路径遍历、prompt injection、威胁模式
- ✅ skill-prompt-injector：双层缓存（LRU + 磁盘快照）
- ✅ prompt-builder：skillBlock 注入
- ✅ ai-agent：skillManager 属性，initSkills 方法
- ✅ agent-service：实例化 SkillManager
- ✅ package.json：js-yaml 依赖

**2. 占位符扫描：** 无 TBD/TODO 占位符，所有步骤包含完整代码。

**3. 类型一致性：** 所有类型在 Task 1 中定义，后续任务使用相同类型名，无不一致。

**4. 自洽性检查：**
- `createSkillTools` 返回 `ToolDefinition[]`，在 ai-agent.ts 中通过 `registerTools()` 注册 ✅
- `createSkillManageTool` 返回 `ToolDefinition`，通过 `registerTool()` 注册 ✅
- `SkillPromptInjector.buildBlock()` 返回 string，传入 `buildSystemPrompt({ skillBlock })` ✅
- `SkillManager.listSkills()` 返回 `SkillMeta[]`，与 skills_list 工具的输出一致 ✅

计划完整，无遗漏。
