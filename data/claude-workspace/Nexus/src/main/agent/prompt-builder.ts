/**
 * 提示构建器 — 组装 LLM 的 system prompt
 *
 * 组装层级：
 * - Agent 身份（DEFAULT_AGENT_IDENTITY）
 * - 平台提示（PLATFORM_HINTS）
 * - 环境提示（buildEnvironmentHints）
 * - 工具使用强制（TOOL_USE_ENFORCEMENT_GUIDANCE）
 * - 模型执行纪律（buildModelExecutionGuidance）
 *
 * 所有函数无状态，buildSystemPrompt() 负责组装。
 */

import os from 'os'

// =========================================================================
// 常量
// =========================================================================

/** Agent 身份描述 — Nexus 版 */
const DEFAULT_AGENT_IDENTITY = (
  'You are Nexus Agent, an intelligent AI assistant running inside the Nexus '
  + 'terminal application. You are helpful, knowledgeable, and direct. '
  + 'You assist users with a wide range of tasks including answering questions, '
  + 'writing and editing code, analyzing information, creative work, and executing '
  + 'actions via your tools. You communicate clearly, admit uncertainty when '
  + 'appropriate, and prioritize being genuinely useful over being verbose unless '
  + 'otherwise directed below. Be targeted and efficient in your exploration and '
  + 'investigations. '
  + 'Always respond in the same language the user is using (Chinese if the user '
  + 'writes in Chinese, English if the user writes in English, etc.).'
)

// =========================================================================
// 平台提示
// =========================================================================

/** 平台提示 — Nexus 仅保留 cli */
const PLATFORM_HINTS: Record<string, string> = {
  cli: (
    'You are a CLI AI Agent. Try not to use markdown but simple text '
    + 'renderable inside a terminal.'
  ),
}

/**
 * 获取平台提示
 * @param platform 平台标识（'cli', 'weixin' 等），默认 'cli'
 */
function buildPlatformHint(platform?: string): string {
  const p = (platform || 'cli').toLowerCase()
  return PLATFORM_HINTS[p] || ''
}

// =========================================================================
// 环境提示
// =========================================================================

/**
 * 检测运行环境并返回环境提示
 */
function buildEnvironmentHints(): string {
  const plat = os.platform()

  if (plat === 'linux') {
    // 检测是否在 WSL
    const release = os.release().toLowerCase()
    if (release.includes('microsoft') || release.includes('wsl')) {
      return (
        'You are running inside WSL (Windows Subsystem for Linux). '
        + 'The Windows host filesystem is mounted under /mnt/ — '
        + '/mnt/c/ is the C: drive, /mnt/d/ is D:, etc. '
        + 'The user\'s Windows files are typically at '
        + '/mnt/c/Users/<username>/Desktop/, Documents/, Downloads/, etc. '
        + 'When the user references Windows paths or desktop files, translate '
        + 'to the /mnt/c/ equivalent.'
      )
    }
    // 普通 Linux：无特殊提示
    return ''
  }

  if (plat === 'darwin') {
    return (
      'You are running on macOS. Use standard macOS paths and conventions. '
      + 'User files are typically in ~/Desktop, ~/Documents, ~/Downloads, etc.'
    )
  }

  if (plat === 'win32') {
    return (
      'You are running on Windows. Use Windows paths (C:\\Users\\...) and conventions. '
      + 'Be careful with path separators — use double backslashes or forward slashes.'
    )
  }

  return ''
}

// =========================================================================
// 智能体环境目录
// =========================================================================

/**
 * 返回智能体环境目录路径（读取主进程设置的环境变量）
 */
function getAgentEnvDir(): string {
  return process.env.NEXUS_AGENT_ENV_DIR || ''
}

/**
 * 构建智能体环境目录提示
 */
function buildEnvDirHint(): string {
  const envDir = getAgentEnvDir()
  return (
    `# Agent Environment Directory\n`
    + `Your dedicated workspace for temporary scripts, virtual environments, `
    + `build artifacts, and runtime files is: \`~/.Nexus/env\` (resolved: \`${envDir}\`).\n`
    + `- Create temporary scripts here (e.g. \`~/.Nexus/env/temp_analysis.py\`)\n`
    + `- Set up Python venv / Node.js node_modules here when needed\n`
    + `- Store intermediate data files, downloaded resources, and build outputs here\n`
    + `- Do NOT clutter the user's home directory or project directories with temporary files\n`
    + `- You can freely create and delete files in this directory as needed`
  )
}

// =========================================================================
// 工具使用强制
// =========================================================================

/** 工具使用强制 — 直接从 Hermes 移植 */
const TOOL_USE_ENFORCEMENT_GUIDANCE = (
  '# Tool-use enforcement\n'
  + 'You MUST use your tools to take action — do not describe what you would do '
  + 'or plan to do without actually doing it. When you say you will perform an '
  + 'action (e.g. "I will run the tests", "Let me check the file", "I will create '
  + 'the project"), you MUST immediately make the corresponding tool call in the same '
  + 'response. Never end your turn with a promise of future action — execute it now.\n'
  + 'Keep working until the task is actually complete. Do not stop with a summary of '
  + 'what you plan to do next time. If you have tools available that can accomplish '
  + 'the task, use them instead of telling the user what you would do.\n'
  + 'Every response should either (a) contain tool calls that make progress, or '
  + '(b) deliver a final result to the user. Responses that only describe intentions '
  + 'without acting are not acceptable.'
)

/** OpenAI/GPT 专属执行纪律 */
const OPENAI_MODEL_EXECUTION_GUIDANCE = (
  '# Execution discipline\n'
  + 'Use tools whenever they improve correctness, completeness, or grounding.\n'
  + 'Do not stop early when another tool call would materially improve the result.\n'
  + 'If a tool returns empty or partial results, retry with a different query or '
  + 'strategy before giving up.\n'
  + 'Keep calling tools until: (1) the task is complete, AND (2) you have verified '
  + 'the result.\n'
  + '\n'
  + '<mandatory_tool_use>\n'
  + 'NEVER answer these from memory or mental computation — ALWAYS use a tool:\n'
  + '- Arithmetic, math, calculations → use terminal\n'
  + '- Hashes, encodings, checksums → use terminal (e.g. sha256sum, base64)\n'
  + '- Current time, date, timezone → use terminal (e.g. date)\n'
  + '- System state: OS, CPU, memory, disk, ports, processes → use terminal\n'
  + '- File contents, sizes, line counts → use read_file, search_files, or terminal\n'
  + '- Git history, branches, diffs → use terminal\n'
  + '- Current facts (weather, news, versions) → use web_search\n'
  + '- File operations (create, modify, delete, rename) → after completing the operation, use memory_add to record what was done\n'
  + '- When asked about "this file" or "the file" after an operation → use memory_search to recall recent file operations\n'
  + 'Your memory and user profile describe the USER, not the system you are '
  + 'running on. The execution environment may differ from what the user profile '
  + 'says about their personal setup.\n'
  + '</mandatory_tool_use>\n'
  + '\n'
  + '<memory_guidance>\n'
  + 'CRITICAL: You MUST use memory tools for all file operations. This is NOT optional.\n'
  + 'After EVERY file operation (create, write, edit, delete, rename, move), you MUST:\n'
  + '1. Call memory_add with: file path, what operation was performed, and key details\n'
  + '2. Example: memory_add("Created ~/a.txt with content 123")\n'
  + 'When the user refers to "this file", "that file", or a previous operation:\n'
  + '1. Call memory_search with relevant keywords to find the context\n'
  + '2. Use the search results to understand what file they mean\n'
  + 'Without memory, you cannot remember past operations between turns.\n'
  + '</memory_guidance>\n'
  + '\n'
  + '<act_dont_ask>\n'
  + 'When a question has an obvious default interpretation, act on it immediately '
  + 'instead of asking for clarification.\n'
  + 'Only ask for clarification when the ambiguity genuinely changes what tool '
  + 'you would call.\n'
  + 'When you need to ask the user a clarifying question, use the `clarify` tool '
  + 'instead of asking in text. The `clarify` tool lets you present structured '
  + 'choices (up to 4 options) or an open-ended question to the user via a UI modal. '
  + 'Use it whenever the user\'s request is vague enough that you need their input '
  + 'before proceeding.\n'
  + '</act_dont_ask>\n'
  + '\n'
  + '<prerequisite_checks>\n'
  + '- Before taking an action, check whether prerequisite discovery, lookup, or '
  + 'context-gathering steps are needed.\n'
  + '- Do not skip prerequisite steps just because the final action seems obvious.\n'
  + '- If a task depends on output from a prior step, resolve that dependency first.\n'
  + '</prerequisite_checks>\n'
  + '\n'
  + '<verification>\n'
  + 'Before finalizing your response:\n'
  + '- Correctness: does the output satisfy every stated requirement?\n'
  + '- Grounding: are factual claims backed by tool outputs or provided context?\n'
  + '- Formatting: does the output match the requested format or schema?\n'
  + '- Safety: if the next step has side effects (file writes, commands, API calls), '
  + 'confirm scope before executing.\n'
  + '</verification>\n'
  + '\n'
  + '<missing_context>\n'
  + '- If required context is missing, do NOT guess or hallucinate an answer.\n'
  + '- Use the appropriate lookup tool when missing information is retrievable.\n'
  + '- If you need the user\'s input to proceed and tools cannot provide it, '
  + 'use the `clarify` tool to ask them (do NOT ask in plain text — the user '
  + 'will see your question in a dedicated modal dialog).\n'
  + '- If you must proceed with incomplete information, label assumptions explicitly.\n'
  + '</missing_context>'
)

/** Google 模型操作指南 */
const GOOGLE_MODEL_OPERATIONAL_GUIDANCE = (
  '# Google model operational directives\n'
  + 'Follow these operational rules strictly:\n'
  + '- **Absolute paths:** Always construct and use absolute file paths for all '
  + 'file system operations. Combine the project root with relative paths.\n'
  + '- **Verify first:** Use read_file/search_files to check file contents and '
  + 'project structure before making changes. Never guess at file contents.\n'
  + '- **Dependency checks:** Never assume a library is available. Check '
  + 'package.json, requirements.txt, Cargo.toml, etc. before importing.\n'
  + '- **Conciseness:** Keep explanatory text brief — a few sentences, not '
  + 'paragraphs. Focus on actions and results over narration.\n'
  + '- **Parallel tool calls:** When you need to perform multiple independent '
  + 'operations (e.g. reading several files), make all the tool calls in a '
  + 'single response rather than sequentially.\n'
  + '- **Non-interactive commands:** Use flags like -y, --yes, --non-interactive '
  + 'to prevent CLI tools from hanging on prompts.\n'
  + '- **Keep going:** Work autonomously until the task is fully resolved. '
  + 'Don\'t stop with a plan — execute it.\n'
)

/** 需要工具使用强制的模型名称子串 */
const TOOL_USE_ENFORCEMENT_MODELS = ['gpt', 'codex', 'gemini', 'gemma', 'grok']

/** 需要 Google 模型的名称子串 */
const GOOGLE_MODELS = ['gemini', 'gemma']

/**
 * 根据模型名称构建执行纪律提示
 */
function buildModelExecutionGuidance(model: string): string {
  const lower = model.toLowerCase()

  const needsEnforcement = TOOL_USE_ENFORCEMENT_MODELS.some(m => lower.includes(m))
  if (!needsEnforcement) return ''

  const parts: string[] = [TOOL_USE_ENFORCEMENT_GUIDANCE]

  if (GOOGLE_MODELS.some(m => lower.includes(m))) {
    parts.push(GOOGLE_MODEL_OPERATIONAL_GUIDANCE)
  } else {
    parts.push(OPENAI_MODEL_EXECUTION_GUIDANCE)
  }

  return parts.join('\n\n')
}

// =========================================================================
// 主入口
// =========================================================================

export interface BuildSystemPromptOptions {
  /** 模型名称（用于模型特异性指导），如 'claude-sonnet-4-6' */
  model?: string
  /** 自定义 agent 身份（覆盖默认身份描述） */
  customIdentity?: string
  /** 平台标识（'cli'、'weixin'、'telegram' 等），默认 'cli' */
  platform?: string
  /** 额外提示（追加到最后） */
  extraPrompt?: string
  /** 记忆系统冻结快照（会话启动时注入） */
  memoryBlock?: string
  /** Skill 索引 block（每次 run 前动态注入） */
  skillBlock?: string
}

/**
 * 构建完整的 system prompt
 *
 * 组装顺序：
 * 1. Agent Identity
 * 2. 工具使用强制 + 模型执行纪律
 * 3. 平台提示
 * 4. 环境提示
 * 5. 智能体环境目录
 * 6. Skill 索引
 * 7. 额外提示
 *
 * @returns 组装完成的 system prompt 字符串
 */
export function buildSystemPrompt(options?: BuildSystemPromptOptions): string {
  const model = options?.model || ''
  const identity = options?.customIdentity || DEFAULT_AGENT_IDENTITY
  const platform = options?.platform || 'cli'
  const extra = options?.extraPrompt || ''
  const memoryBlock = options?.memoryBlock
  const skillBlock = options?.skillBlock

  const sections: string[] = []

  // 1. Agent Identity
  sections.push(identity)

  // 2. 记忆系统冻结快照（如有）
  if (memoryBlock) {
    sections.push(memoryBlock)
  }

  // 3. 工具使用强制 + 模型执行纪律
  const executionGuidance = buildModelExecutionGuidance(model)
  if (executionGuidance) {
    sections.push(executionGuidance)
  }

  // 4. 平台提示
  const platformHint = buildPlatformHint(platform)
  if (platformHint) {
    sections.push(platformHint)
  }

  // 5. 环境提示
  const envHints = buildEnvironmentHints()
  if (envHints) {
    sections.push(envHints)
  }

  // 6. 智能体环境目录
  sections.push(buildEnvDirHint())

  // 7. Skill 索引（动态注入）
  if (skillBlock) {
    sections.push(skillBlock)
  }

  // 8. 额外提示
  if (extra) {
    sections.push(extra)
  }

  return sections.join('\n\n')
}
