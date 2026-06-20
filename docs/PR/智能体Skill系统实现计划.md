# Nexus 智能体 Skill 系统实现计划

## Context

Nexus 智能体当前使用 ToolRegistry 硬编码注册内置工具（read_file, terminal 等）。需要添加类似 HERMES Agent 的 skill 系统，让智能体能够通过 SKILL.md 文件发现和加载可扩展的工具/行为指导，实现技能的动态发现和 CRUD 管理。

**设计原则**：SKILL.md 作为扩展机制，不替换现有内置工具。

---

## 1. 新增文件

| 文件 | 职责 |
|------|------|
| `src/core/types/skill.ts` | SkillMeta, SkillContent, SkillFrontmatter, SkillManageAction 等类型 |
| `src/core/constants/skill.ts` | SKILLS_DIR = `~/.Nexus/skills/`，名称/描述长度限制 |
| `src/main/agent/skills/skill-manager.ts` | 核心编排：发现、解析 frontmatter、缓存、CRUD |
| `src/main/agent/skills/skills-tool.ts` | `skills_list` + `skill_view` 工具实现 |
| `src/main/agent/skills/skill-manage-tool.ts` | `skill_manage` 工具实现（create/edit/patch/delete/write_file/remove_file） |
| `src/main/agent/skills/skill-security.ts` | 路径遍历检测、prompt injection 检测、不可见字符检测、威胁模式匹配 |
| `src/main/agent/skills/skill-prompt-injector.ts` | 构建可用 skill 列表注入系统提示，含双层缓存 |

## 2. 修改现有文件

| 文件 | 修改点 |
|------|--------|
| `src/main/agent/prompt-builder.ts` | `BuildSystemPromptOptions` 增加 `skillBlock`，系统提示中注入 skill 列表 |
| `src/main/agent/ai-agent.ts` | 增加 `skillManager` 属性；在 `run()` 前注入 skill 列表到 LLM Bridge |
| `src/main/services/agent-service.ts` | 实例化 `SkillManager`，注册 skill 工具到 agent |
| `package.json` | 添加 `js-yaml` 依赖（YAML frontmatter 解析） |

## 3. 关键类型定义

```typescript
// src/core/types/skill.ts

/** SKILL.md YAML frontmatter */
interface SkillFrontmatter {
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
  /** 标签列表，支持两种写法：根级 tags 或 metadata.hermes.tags */
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
interface ParsedSkill {
  frontmatter: SkillFrontmatter
  /** Markdown body 部分 */
  body: string
  /** 原始完整内容（编辑时用） */
  rawContent: string
}

/** Tier 1：skills_list 返回的轻量元数据 */
interface SkillMeta {
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
interface SkillContent {
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

/** Skill CRUD 操作类型 */
type SkillManageAction =
  | 'create'      // 创建新 skill 目录 + SKILL.md
  | 'edit'        // 替换整个 SKILL.md 内容
  | 'patch'       // 更新 frontmatter 字段或追加 body
  | 'delete'      // 删除整个 skill 目录
  | 'write_file'  // 在 skill 目录内创建/覆盖文件
  | 'remove_file' // 删除 skill 目录内的文件

/** Skill 管理操作结果 */
interface SkillManageResult {
  success: boolean
  message: string
  skillName?: string
  /** 操作后 skill 目录下的文件列表 */
  files?: string[]
}

/** 安全扫描结果 */
interface SecurityScanResult {
  /** 发现的威胁列表 */
  findings: string[]
  /** 威胁等级：info / warning / critical */
  severity: 'info' | 'warning' | 'critical'
  /** 是否阻止 */
  blocked: boolean
}
```

## 4. SKILL.md 文件格式详解

### 4.1 格式规范

每个 skill 是一个目录，必须包含 `SKILL.md`：

```
skills/
  category/                    # 分类目录（如 software-development, creative）
    skill-name/
      SKILL.md                 # 主指令文件（必填）
      references/              # 参考资料（可选）
        api.md
        examples.md
      templates/               # 模板文件（可选）
        output-template.md
      scripts/                 # 脚本文件（可选）
        setup.sh
      assets/                  # 额外资源（可选）
```

### 4.2 Frontmatter 字段说明

| 字段 | 必填 | 约束 | 作用 |
|------|------|------|------|
| `name` | 是 | `^[a-z0-9][a-z0-9._-]*$`，≤64 字符 | Skill 唯一标识 |
| `description` | 是 | ≤1024 字符 | 在 skills_list 中展示 |
| `version` | 否 | 语义化版本 | 版本管理 |
| `author` | 否 | 字符串 | 作者信息 |
| `license` | 否 | 许可证标识 | 如 MIT |
| `platforms` | 否 | `["macos","linux","windows"]` 子集 | 平台限制 |
| `tags` | 否 | 字符串数组 | 分类标签 |
| `prerequisites.env_vars` | 否 | 环境变量名数组 | 运行时检查缺失变量 |
| `prerequisites.commands` | 否 | 命令名数组 | 运行时检查缺失命令 |
| `metadata.hermes.tags` | 否 | 字符串数组 | 扩展标签 |
| `metadata.hermes.related_skills` | 否 | skill 名称数组 | 关联 skill 交叉引用 |
| `metadata.hermes.homepage` | 否 | URL | 项目主页 |

### 4.3 Body 常见结构模式

| 章节 | 作用 | 示例 skill |
|------|------|-----------|
| `## When to use` | 何时使用（激活触发器） | apple-notes, ascii-art |
| `## When NOT to Use` | 何时不该使用 | minecraft, ascii-art |
| `## Quick Reference` | 命令速查表 | ascii-art, arxiv |
| `## Prerequisites` | 安装/设置步骤 | notion, github-auth |
| `## Steps` | 编号工作流程 | minecraft, github-auth |
| `## Decision Flow` | 工具选择逻辑树 | ascii-art |
| `## Pitfalls` | 常见失败模式 | minecraft, github-auth |
| `## Troubleshooting` | 故障排查指南 | github-auth |
| `## Notes` | 操作提示和注意事项 | 所有 skill |

### 4.4 SKILL.md 完整示例

```markdown
---
name: data-analysis
description: 数据分析和可视化技能，支持 Pandas、Matplotlib、Seaborn
version: 1.0.0
author: liufei
license: MIT
platforms: [linux, macos, windows]
tags: [data, visualization, python]
prerequisites:
  commands: [python3, pip]
metadata:
  hermes:
    tags: [data-science, python]
    related_skills: [jupyter-kernel]
---

# Data Analysis Skill

## When to use
- 需要分析 CSV、Excel 等结构化数据
- 需要生成统计图表或数据报告

## When NOT to Use
- 仅需简单数学计算（直接用 terminal）
- 数据量超过百万行（考虑数据库查询）

## Prerequisites

```bash
pip install pandas matplotlib seaborn
```

## Steps

1. 读取数据文件（使用 `read_file` 或 `terminal` 确认文件格式）
2. 使用 Python 进行数据清洗和处理
3. 生成可视化图表
4. 输出分析报告

## Decision Flow

```
是否需要交互探索？
  ├─ 是 → 使用 jupyter-kernel skill
  └─ 否 → 继续
数据量 < 10万行？
  ├─ 是 → 使用 pandas
  └─ 否 → 使用 polars
```

## Pitfalls
- CSV 编码问题：优先尝试 UTF-8，失败则尝试 GBK
- 大文件内存溢出：使用 chunksize 分块读取
- 图表中文乱码：需配置 matplotlib 中文字体

## Notes
- 默认使用 matplotlib 生成 PNG 图片
- 图表输出保存到当前工作目录
```

---

## 5. 核心设计

### 5.1 SkillManager（核心引擎）

**职责**：Skill 发现、解析、缓存、CRUD 的统一编排器。

```typescript
class SkillManager {
  private skillsDir: string              // ~/.Nexus/skills/
  private cache: SkillMeta[] | null      // 内存缓存
  private cacheTimestamp: number         // 缓存时间戳
  private readonly CACHE_TTL_MS = 30000  // 30 秒 TTL

  // ── 发现 ──
  listSkills(category?: string): SkillMeta[]
    // 递归扫描 skills 目录，解析所有 SKILL.md 的 frontmatter
    // 应用平台匹配、禁用列表过滤
    // 使用 30s TTL 缓存

  getSkillContent(name: string, filePath?: string): SkillContent
    // 查找 skill 目录 → 读取 SKILL.md
    // 解析 frontmatter + body
    // 安全检查（路径遍历、prompt injection）
    // 发现 linkedFiles（扫描 references/templates/scripts/assets）

  findSkillDir(name: string): PathObject | null
    // 按名称查找 skill 目录（支持分类路径如 "mlops/axolotl"）

  // ── 解析 ──
  parseSkillMd(content: string): ParsedSkill
    // YAML frontmatter 解析 + body 提取

  // ── 安全 ──
  hasPathTraversal(pathStr: string): boolean
    // 检测 ".." 路径遍历组件

  isWithinDirectory(target: string, root: string): boolean
    // path.resolve() + startsWith() 校验目标路径在根目录内

  detectPromptInjection(content: string): string[]
    // 正则匹配常见注入模式

  scanSkill(content: string, filePath: string): SecurityScanResult
    // 完整安全扫描（结构限制 + 威胁模式 + 不可见字符）

  // ── CRUD ──
  createSkill(name, category?, frontmatter?, body?): SkillManageResult
    // 创建目录 + 写入 SKILL.md（原子写入）

  editSkill(name: string, newContent: string): SkillManageResult
    // 替换整个 SKILL.md（写入前安全扫描）

  patchSkill(name: string, updates: {frontmatter?, bodyAppend?}): SkillManageResult
    // 更新 frontmatter 字段或追加 body 文本

  deleteSkill(name: string): SkillManageResult
    // 删除整个 skill 目录

  writeSkillFile(name: string, filePath: string, content: string): SkillManageResult
    // 在 skill 目录内创建/覆盖文件

  removeSkillFile(name: string, filePath: string): SkillManageResult
    // 删除 skill 目录内的文件

  // ── 缓存 ──
  invalidateCache(): void
    // 清除内存缓存 + 系统提示缓存
}
```

### 5.2 渐进式披露（Progressive Disclosure）

核心思想：**"先给最小信息让 LLM 决定是否深入，再按需加载"**。

```
用户消息: "帮我用 LoRA 微调一个模型"
         ↓
    ┌─────────────────────────────────────────┐
    │ Tier 1: skills_list()                   │
    │ 返回: [{name, description, category,     │
    │        readinessStatus, trustLevel}]    │
    │ 不含任何文件内容                         │
    │ Token: ~200-500（假设 50 个 skill）      │
    └─────────────────────────────────────────┘
         ↓
    LLM 扫描列表，发现 "axolotl" 匹配需求
         ↓
    ┌─────────────────────────────────────────┐
    │ Tier 2: skill_view("axolotl")           │
    │ 返回: SKILL.md 全文 + linkedFiles 列表  │
    │ Token: ~2000（~200 行 markdown）         │
    └─────────────────────────────────────────┘
         ↓
    LLM 阅读指令，发现 "详见 references/dataset-formats.md"
         ↓
    ┌─────────────────────────────────────────┐
    │ Tier 3: skill_view("axolotl",           │
    │   "references/dataset-formats.md")      │
    │ 返回: 特定文件内容                       │
    │ Token: ~500                             │
    └─────────────────────────────────────────┘
         ↓
    LLM 按指令执行操作
```

**Token 经济学对比：**

| 方案 | Token 消耗 | 问题 |
|------|-----------|------|
| 全量注入 | 50 个 skill × 2000 = **100K tokens** | 上下文窗口爆满，费用极高 |
| 渐进加载 | 500 + 2000 + 500 = **~3000 tokens**（按需） | 只加载需要的，省 97% |

**实际场景：**
- 用户问"怎么微调模型" → 只加载 axolotl 的 SKILL.md（2K tokens）
- 用户问"列出所有可用技能" → 只加载 metadata（500 tokens）
- 大部分对话只需要 Tier 1，极少数需要 Tier 3

### 5.3 安全机制

#### 5.3.1 路径遍历防护

```typescript
// 快速检测：检查路径组件中是否包含 ".."
function hasPathTraversal(pathStr: string): boolean {
  const parts = pathStr.split(/[\\/]/).filter(Boolean)
  return parts.some(p => p === '..')
}

// 完整校验：resolve 后检查是否在根目录内
function isWithinDirectory(targetPath: string, rootDir: string): boolean {
  const resolved = path.resolve(targetPath)
  const resolvedRoot = path.resolve(rootDir)
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
}
```

#### 5.3.2 Prompt Injection 检测

```typescript
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

function detectPromptInjection(content: string): string[] {
  const lower = content.toLowerCase()
  return INJECTION_PATTERNS.filter(p => lower.includes(p))
}
```

检测到注入时**记录日志警告，但不阻断**（因为 skill 文件位于用户信任目录下）。

#### 5.3.3 威胁模式匹配（完整安全扫描）

在 skill 创建/编辑/安装时，执行完整扫描：

```typescript
const THREAT_PATTERNS: Array<{ name: string; pattern: RegExp; severity: string }> = [
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

// 不可见 Unicode 字符检测
const INVISIBLE_UNICODE = [
  '\u200B', // 零宽空格
  '\u200C', // 零宽非连接符
  '\u200D', // 零宽连接符
  '\uFEFF', // 零宽无断空格
  '\u202E', // 从右到左覆盖
  '\u202A', // 从左到右嵌入
]

function scanSkill(content: string, filePath: string): SecurityScanResult {
  const findings: Array<{ name: string; severity: string }> = []

  // 1. 结构限制
  if (content.length > 100_000) {
    findings.push({ name: 'file_too_large', severity: 'warning' })
  }

  // 2. 不可见字符检测
  for (const char of INVISIBLE_UNICODE) {
    if (content.includes(char)) {
      findings.push({ name: 'invisible_unicode', severity: 'warning' })
    }
  }

  // 3. 威胁模式匹配
  for (const { name, pattern, severity } of THREAT_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({ name, severity })
    }
  }

  // 判定
  const hasCritical = findings.some(f => f.severity === 'critical')
  return {
    findings,
    severity: hasCritical ? 'critical' : findings.some(f => f.severity === 'warning') ? 'warning' : 'info',
    blocked: hasCritical,  // critical 级别自动阻止
  }
}
```

#### 5.3.4 CRUD 写入验证管道

每次创建/编辑 skill 时，必须按顺序通过以下验证：

1. `_validateName(name)` — 正则 `^[a-z0-9][a-z0-9._-]*`，max 64 字符
2. `_validateFrontmatter(frontmatter)` — 检查 YAML 结构和必填字段
3. `_validateContentSize(content)` — SKILL.md 最大 10 万字符，支持文件最大 1MB
4. `_validateFilePath(filePath)` — 文件必须在 `references/`、`templates/`、`scripts/`、`assets/` 下
5. **原子写入**：先写临时文件 → `fs.rename()` 覆盖原文件（崩溃安全）
6. **写入后安全扫描**：调用 `scanSkill()`，被阻止则自动回滚（删除临时文件）
7. **缓存失效**：操作成功后清除系统提示缓存

### 5.4 工具定义与注册

#### 5.4.1 工具注册机制

```typescript
// src/main/agent/skills/skills-tool.ts

// skills_list 工具
const SKILLS_LIST_TOOL: ToolDefinition = {
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
  handler: async (args) => { ... }
}

// skill_view 工具
const SKILL_VIEW_TOOL: ToolDefinition = {
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
  handler: async (args) => { ... }
}
```

#### 5.4.2 skill_manage 工具

```typescript
// src/main/agent/skills/skill-manage-tool.ts

const SKILL_MANAGE_TOOL: ToolDefinition = {
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
        description: '"create"/"edit" 的完整 SKILL.md 内容，'
          + '或 "write_file" 的文件内容',
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
  handler: async (args) => { ... }
}
```

### 5.5 系统提示注入

#### 5.5.1 注入格式

在系统提示中注入紧凑的 skill 索引：

```
## Skills (mandatory)
Before replying, scan the skills below. If a skill matches or is even partially relevant
to your task, you MUST load it with skill_view(name) and follow its instructions.
Skills contain specialized knowledge — API endpoints, tool-specific commands,
and proven workflows that outperform general-purpose approaches.

<available_skills>
  software-development:
    - systematic-debugging: 系统化调试流程，使用科学方法定位 bug
    - test-driven-development: 先写测试再实现功能的 TDD 工作流
    - requesting-code-review: 代码审查前的自检和提交流程
  creative:
    - ascii-art: 使用 ASCII 字符创作艺术
    - p5js: 使用 p5.js 创建生成式艺术
</available_skills>

Only proceed without loading a skill if genuinely none are relevant to the task.
```

#### 5.5.2 双层缓存

模仿 HERMES 的两层缓存设计：

```typescript
class SkillPromptInjector {
  // ── Layer 1: 内存 LRU 缓存 ──
  private lruCache: Map<string, string> = new Map()
  private readonly MAX_LRU_ENTRIES = 8

  // ── Layer 2: 磁盘快照 ──
  private snapshotPath: string  // ~/.Nexus/skills/.skills_prompt_snapshot.json

  buildBlock(
    skillsDir: string,
    externalDirs: string[],
    disabledNames: Set<string>,
    availableTools?: Set<string>,
  ): string {
    // 1. 检查 LRU 缓存
    const cacheKey = this.makeCacheKey(skillsDir, externalDirs, disabledNames, availableTools)
    const cached = this.lruCache.get(cacheKey)
    if (cached) {
      this.lruCache.delete(cacheKey)
      this.lruCache.set(cacheKey, cached) // move to end
      return cached
    }

    // 2. 检查磁盘快照
    const snapshot = this.loadSnapshot()
    if (snapshot && this.validateSnapshot(snapshot)) {
      const result = this.buildFromSnapshot(snapshot, disabledNames, availableTools)
      this.lruCache.set(cacheKey, result)
      return result
    }

    // 3. 冷启动：完整扫描文件系统 + 写快照
    const { result, snapshotData } = this.scanAndBuild(skillsDir, externalDirs, disabledNames)
    this.saveSnapshot(snapshotData)
    this.lruCache.set(cacheKey, result)

    // LRU 淘汰
    if (this.lruCache.size > this.MAX_LRU_ENTRIES) {
      const firstKey = this.lruCache.keys().next().value
      this.lruCache.delete(firstKey)
    }

    return result
  }
}
```

**磁盘快照格式**（`.skills_prompt_snapshot.json`）：

```json
{
  "version": 1,
  "skills": [
    {
      "skill_name": "axolotl",
      "category": "mlops",
      "frontmatter_name": "axolotl",
      "description": "Fine-tune LLMs with Axolotl",
      "platforms": [],
      "conditions": {}
    }
  ],
  "category_descriptions": {},
  "manifest": {
    "mtime": 1713801600000,
    "size": 102400,
    "files": {
      "/home/liufei/.Nexus/skills/mlops/axolotl/SKILL.md": { "mtime": 1713801600000, "size": 2048 }
    }
  }
}
```

快照通过 mtime/size 校验，文件有变更时失效，保证跨进程重启后仍可用。

#### 5.5.3 Skill 数量与上下文窗口问题

当 skill 特别多时，系统提示中的索引可能超过上下文窗口。现有 HERMES 通过**条件过滤**减少注入量：

```
metadata:
  hermes:
    requires_toolsets: [huggingface]     # 只有 huggingface 可用时才显示
    fallback_for_tools: [curl]           # curl 不可用时才显示
```

**Nexus 中可以采用的策略：**

| 策略 | 说明 |
|------|------|
| **条件激活** | skill 通过 frontmatter 定义 `requires_tools` 等字段，只在匹配条件时注入 |
| **平台 + 禁用过滤** | 按当前平台和用户配置排除无关 skill |
| **分类折叠**（可选，Phase 2） | 系统提示只注入分类名 + 统计数，LLM 需要时再调用 skills_list(category) 展开 |
| **技能路由工具**（可选，Phase 2） | 增加 skill_router 工具，输入任务描述，返回 Top-K 匹配 skill 名称 |

Phase 1 先实现前两种策略。Phase 2 视实际情况考虑添加后两种。

### 5.6 配置和过滤

#### 5.6.1 平台匹配

```typescript
const PLATFORM_MAP: Record<string, string> = {
  macos: 'darwin',
  linux: 'linux',
  windows: 'win32',
}

function skillMatchesPlatform(frontmatter: SkillFrontmatter): boolean {
  const platforms = frontmatter.platforms
  if (!platforms || platforms.length === 0) return true  // 无限制，所有平台兼容

  const currentPlatform = process.platform  // 'linux', 'darwin', 'win32'
  return platforms.some(p => PLATFORM_MAP[p] === currentPlatform)
}
```

#### 5.6.2 前置条件检查

```typescript
function checkPrerequisites(frontmatter: SkillFrontmatter): {
  missingEnvVars: string[]
  missingCommands: string[]
  readinessStatus: 'available' | 'setup_needed' | 'unsupported'
} {
  const missingEnvVars: string[] = []
  const missingCommands: string[] = []

  // 检查环境变量
  for (const envVar of frontmatter.prerequisites?.env_vars ?? []) {
    if (!process.env[envVar]) {
      missingEnvVars.push(envVar)
    }
  }

  // 检查命令（通过 which 命令）
  for (const cmd of frontmatter.prerequisites?.commands ?? []) {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' })
    } catch {
      missingCommands.push(cmd)
    }
  }

  return {
    missingEnvVars,
    missingCommands,
    readinessStatus:
      (missingEnvVars.length > 0 || missingCommands.length > 0)
        ? 'setup_needed'
        : 'available',
  }
}
```

#### 5.6.3 禁用列表

从配置文件读取禁用的 skill 名称列表，在 `listSkills()` 和 `getSkillContent()` 中都过滤：

```typescript
// 从 ~/.Nexus/config.json 读取
function getDisabledSkillNames(): Set<string> {
  const configPath = path.join(os.homedir(), '.Nexus', 'config.json')
  if (!fs.existsSync(configPath)) return new Set()

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  const disabled = config.skills?.disabled ?? []
  return new Set(disabled)
}
```

### 5.7 与 ToolRegistry 集成

```
agent-service.ts:
  1. new SkillManager() 实例化
  2. createSkillTools(skillManager) → 得到 skills_list, skill_view, skill_manage 三个 ToolDefinition
  3. agent.registerTools(skillTools) → 注册到现有的 ToolRegistry
  4. 将 skillManager 引用传给 AIAgent，用于后续动态工具注册

ai-agent.ts:
  - 新增 skillManager: SkillManager | null 属性
  - 在 run() 前，通过 skillPromptInjector.buildBlock() 生成 skill 列表注入 LLM Bridge
```

**Skill 工具不需要独立的注册系统**——它们直接注册到 AIAgent 现有的 `ToolRegistry`，复用已有的 `dispatch()` 调用路径。

---

## 6. 目录结构

```
~/.Nexus/
  skills/                          # Skill 根目录
    software-development/
      systematic-debugging/
        SKILL.md
        references/
          debugging-checklist.md
        scripts/
          run-tests.sh
      test-driven-development/
        SKILL.md
      requesting-code-review/
        SKILL.md
    creative/
      ascii-art/
        SKILL.md
      p5js/
        SKILL.md
    productivity/
      notion/
        SKILL.md
    .skills_prompt_snapshot.json   # 磁盘快照（自动管理）
  config.json                      # 用户配置（含 disabled skill 列表）
```

---

## 7. 验证方式

1. **创建测试 skill**：在 `~/.Nexus/skills/` 下手动创建一个测试 SKILL.md
2. **skills_list**：启动 Nexus，发送消息让智能体调用 `skills_list`，验证返回测试 skill 的元数据
3. **skill_view**：调用 `skill_view("test-skill")`，验证返回完整 SKILL.md 内容和 linkedFiles 列表
4. **skill_view 子文件**：调用 `skill_view("test-skill", "references/test.md")`，验证返回特定文件
5. **skill_manage create**：创建新 skill，验证目录和文件生成
6. **skill_manage edit**：编辑 skill，验证内容更新
7. **skill_manage delete**：删除 skill，验证目录清除
8. **安全验证**：尝试 `skill_view` 中使用 `../` 路径遍历，验证被拦截
9. **系统提示验证**：检查系统提示中是否正确注入了 skill 列表
