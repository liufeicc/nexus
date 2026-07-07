/**
 * 智能体 LLM 调用桥接层
 *
 * 职责：封装 LLM 调用（流式/非流式）、系统提示构建、API 消息构建。
 * 从 ai-agent.ts 拆分出来，减少主文件体积。
 */

import { AgentMessage } from '../../core/types/agent'
import { LLMClient, LLMResponse, StreamCallbacks } from './llm-client'
import { ToolRegistry } from './tool-registry'
import { buildSystemPrompt, buildNexusProfileBlock, BuildSystemPromptOptions } from './prompt-builder/index'
import { AgentEventManager, createEvent } from './agent-events'
import { NexusConnectionManager } from '../services/nexus-connection-manager'
import { logger } from '../utils/logger'

/**
 * 计划模式系统提示词（追加到 system prompt 末尾）
 *
 * 引导 LLM 按"探索→讨论→生成计划"流程工作，
 * 仅使用只读工具和 write_plan 工具。
 *
 * @param language 用户语言，决定计划内容的生成语言
 */
function getPlanModePrompt(language: string): string {
  const langMap: Record<string, string> = {
    zh: '中文',
    en: 'English',
    fr: 'Français',
    es: 'Español',
  }
  const langName = langMap[language] || '中文'

  return `
## 计划模式 (Plan Mode)

你当前处于**计划模式**，需要遵循以下规则：

### 权限限制
- ✅ 允许：读取文件、搜索文件、搜索互联网、提取网页内容、阅读邮件、查看记忆/技能/任务列表
- ❌ 禁止：修改/创建/删除文件、执行终端命令、发送邮件、修改记忆/技能/任务
- ⭐ 唯一例外：使用 \`write_plan\` 工具写入计划文件

### 工作流程
1. 理解用户需求，主动追问不明确的地方
2. 使用 read_file、search_files 探索代码库结构
3. 使用 web_search、web_extract 查询外部信息
4. 与用户讨论方案，提出多种选择和利弊分析
5. 使用 write_plan 工具写入计划，filename 使用简短英文描述（如 add-dark-mode）

### 计划内容语言
**重要：计划文件的 content 必须使用${langName}撰写**，包括标题、章节标题、步骤描述等所有内容。

### 计划文件格式
\`\`\`markdown
# [计划标题]
## 背景 [为什么需要这个计划]
## 目标 [要达成什么]
## 实施步骤
1. [ ] 步骤一：描述
2. [ ] 步骤二：描述
3. [ ] 步骤三：描述
## 涉及文件 [列出需要修改的文件]
## 验证方法 [如何验证实施结果]
\`\`\`

### write_plan 工具用法
- filename: 简短英文描述，小写，单词间用连字符连接（如 \`add-user-auth\`、\`optimize-query-performance\`）
- content: Markdown 格式的完整计划内容（使用${langName}），每个步骤行必须包含状态标记 \`[ ]\`

### 更新已有计划
**重要：当用户要求修改已有计划时，必须使用与上次完全相同的 filename**，这样 write_plan 会覆盖原文件，而不是创建新文件。
- 如果上一轮对话中已经调用过 write_plan 并使用了某个 filename（如 \`add-dark-mode\`），后续修改计划时必须继续使用同一个 filename
- 不要为修改后的计划生成新的 filename

### 退出计划模式
当用户明确表示要开始执行计划时（如"开始执行"、"执行吧"、"可以开始了"、"start"），
使用 \`exit_plan_mode\` 工具退出计划模式。退出后将自动进入执行阶段，你将获得完整工具集来执行计划。
`
}

/**
 * 执行模式系统提示词（非计划模式下追加）
 *
 * 引导 LLM 在执行计划时使用 update_plan 工具实时标记进度。
 */
const EXECUTION_MODE_PROMPT = `
## 计划执行模式 (Plan Execution Mode)

当用户要求执行某个计划文件时，需要遵循以下规则：

### 执行流程
1. 使用 read_file 读取指定的计划文件（位于 ~/.Nexus/plans/ 或 ~/.Nexus_dev/plans/ 目录）
2. 按"实施步骤"章节中的顺序执行每个步骤
3. 开始执行某步骤前，使用 update_plan 工具标记状态为 in_progress
4. 步骤执行完成后，使用 update_plan 工具标记状态为 completed，可附加 note 说明关键信息
5. 如果步骤执行失败，标记状态为 failed，附加 note 说明失败原因

### update_plan 工具用法
- plan_file: 计划文件名（如 \`add-user-auth.md\`）
- step_number: 步骤序号（从 1 开始）
- status: \`in_progress\`、\`completed\` 或 \`failed\`
- note: 可选，简短备注（如创建的文件路径、关键决策等）

### 重要规则
- 必须实时标记执行状态，不要等到全部完成后批量更新
- 每个步骤开始时立即标记为 in_progress
- 每个步骤完成后立即标记为 completed
- 如果步骤涉及创建文件，note 中记录文件路径

### 自动进入计划模式
当用户提出复杂的开发任务时（涉及多个文件修改、需要架构设计、或需求不够明确），
可以先使用 \`enter_plan_mode\` 工具进入计划模式，进行代码探索和方案讨论，制定好执行计划后再退出计划模式进行执行。
`

/**
 * 打印发送给大模型的完整消息（调试日志）
 */
function logApiMessages(
  apiMessages: AgentMessage[],
  toolDefs: Array<{ name: string }>,
  mode: '流式' | '非流式',
): void {
  logger.info(`===== 发送给大模型的完整消息 (${mode}) =====`)
  logger.info(`[LLM Bridge] 消息总数: ${apiMessages.length}, 工具数: ${toolDefs.length}`)
  for (let i = 0; i < apiMessages.length; i++) {
    const msg = apiMessages[i]
    const contentPreview = typeof msg.content === 'string'
      ? msg.content.substring(0, 500) + (msg.content!.length > 500 ? '...' : '')
      : JSON.stringify(msg.content).substring(0, 500)
    logger.info(`[LLM Bridge] [${i}] role=${msg.role}, content_length=${msg.content?.length || 0}, preview=${contentPreview}`)
  }
  if (toolDefs.length > 0) {
    logger.info(`[LLM Bridge] 工具列表: ${toolDefs.map(t => t.name).join(', ')}`)
  }
  logger.info('==========================================')
}

/**
 * LLM 桥接配置
 */
interface LlmBridgeConfig {
  model: string
  promptBuilderOptions?: Omit<BuildSystemPromptOptions, 'model'>
}

/**
 * 创建 LLM 桥接实例
 */
export function createLlmBridge(
  config: LlmBridgeConfig,
  llmClient: LLMClient,
  toolRegistry: ToolRegistry,
  eventManager: AgentEventManager,
  skillBlockFn?: () => string,
  getPlanMode?: () => boolean,
) {
  /**
   * 构建系统提示词
   *
   * 根据当前计划模式状态，追加计划模式或执行模式指令段。
   */
  function getSystemPrompt(): string {
    const nexusProfileBlock = buildNexusProfileBlock(
      config.promptBuilderOptions?.language || 'zh',
      process.env.NEXUS_AGENT_ENV_DIR,
    )
    const basePrompt = buildSystemPrompt({
      model: config.model,
      platform: config.promptBuilderOptions?.platform || 'cli',
      extraPrompt: config.promptBuilderOptions?.extraPrompt,
      memoryBlock: config.promptBuilderOptions?.memoryBlock,
      skillBlock: skillBlockFn?.(),
      nexusProfileBlock,
    })

    // 根据计划模式追加指令段
    const planMode = getPlanMode?.() ?? false
    const language = config.promptBuilderOptions?.language || 'zh'
    let prompt = planMode
      ? basePrompt + '\n' + getPlanModePrompt(language)
      : basePrompt + '\n' + EXECUTION_MODE_PROMPT

    // 浏览器连接时追加工具优先级提示
    if (NexusConnectionManager.getInstance().isBrowserConnected()) {
      prompt += '\n\n## Browser Tool Priority\n'
        + 'A browser panel is currently connected. '
        + 'For any web search, browsing, or URL visiting task, '
        + 'you MUST use the "browser" tool instead of "web_search" or "web_extract", '
        + 'so the user can see the operation in real-time in the browser panel.'
    }

    return prompt
  }

  /**
   * 非流式 LLM 调用
   *
   * 计划模式下仅暴露只读工具 + write_plan，否则暴露全部工具。
   */
  async function callLLMNonStream(
    systemPrompt: string,
    messages: AgentMessage[],
  ): Promise<LLMResponse> {
    const apiMessages: AgentMessage[] = [
      { role: 'system' as const, content: systemPrompt, timestamp: Date.now() },
      ...messages,
    ]
    const planMode = getPlanMode?.() ?? false
    const toolDefs = planMode
      ? await toolRegistry.getReadOnlyDefinitions()
      : await toolRegistry.getDefinitions()

    // 打印发送给大模型的完整消息
    logApiMessages(apiMessages, toolDefs, '非流式')

    return llmClient.chat(apiMessages, {
      tools: toolDefs.length > 0 ? toolDefs : undefined,
    })
  }

  /**
   * 流式 LLM 调用
   *
   * 计划模式下仅暴露只读工具 + write_plan，否则暴露全部工具。
   */
  async function callLLMStream(
    systemPrompt: string,
    messages: AgentMessage[],
  ): Promise<LLMResponse> {
    const planMode = getPlanMode?.() ?? false
    const toolDefs = planMode
      ? await toolRegistry.getReadOnlyDefinitions()
      : await toolRegistry.getDefinitions()

    let fullContent = ''

    const callbacks: StreamCallbacks = {
      onChunk: (text: string) => {
        fullContent += text
        eventManager.emit(createEvent('message_delta', { text }))
      },
      onThinking: (text: string) => {
        eventManager.emit(createEvent('thinking', { text }))
      },
      onDone: () => {
        // 完成（实际返回值通过 streamChat 的 Promise 获取）
      },
      onError: () => {
        // 错误已由 streamChat 的 catch 块通过 Promise reject 抛出，无需在此处理
      },
      onToolCallStart: (toolCallId: string, toolName: string) => {
        eventManager.emit(createEvent('tool_calling_started', {
          toolCallId,
          toolName,
        }))
      },
    }

    const apiMessages: AgentMessage[] = [
      { role: 'system' as const, content: systemPrompt, timestamp: Date.now() },
      ...messages,
    ]

    // 打印发送给大模型的完整消息
    logApiMessages(apiMessages, toolDefs, '流式')

    return llmClient.streamChat(apiMessages, callbacks, {
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      thinking: { enabled: true, effort: 'medium' },
    })
  }

  return {
    getSystemPrompt,
    callLLMNonStream,
    callLLMStream,
  }
}

export type LlmBridge = ReturnType<typeof createLlmBridge>
