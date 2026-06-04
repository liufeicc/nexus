/**
 * 终端工具
 *
 * 作用：同步执行终端命令，返回输出、退出码和错误信息。
 *
 * 与 Nexus 现有的 PtyService 不同：
 * - PtyService 是交互式 PTY（用于终端面板，逐字符输出）
 * - terminal-tool 是同步执行（用于智能体，执行完返回结果）
 *
 * 核心功能：
 * - 危险命令检测（30+ 正则模式 + 审批流程）
 * - sudo 命令自动改写（sudo -S -p ''）
 * - 执行失败重试（最多 3 次，指数退避）
 * - ANSI 转义序列完整清理
 * - 敏感信息脱敏（API Key、Token、私钥等）
 * - 退出码语义解释（grep=1、diff=1 等正常退出码）
 *
 * 参数：
 * - command: 要执行的命令（如 "ls -la"）
 * - cwd: 工作目录（可选，默认为智能体环境目录）
 * - timeout: 超时时间（毫秒，默认 180000）
 */

import { spawn, ChildProcess } from 'child_process'
import os from 'os'
import path from 'path'
import { ToolDefinition, ToolResult } from '../../../core/types/agent'
import { getNexusDirName } from '../../../core/utils/path-utils'
import { logger } from '../../utils/logger'
import { stripAnsi } from '../utils/ansi-strip'
import { redactSensitiveText } from '../utils/redact'
import { checkDangerousCommand } from '../utils/approval'
import { NexusConnectionManager } from '../../services/nexus-connection-manager'

// ==================== 常量 ====================

/** 当前会话 ID（用于危险命令审批隔离） */
let currentSessionId: string = 'default'

/**
 * 绑定会话 ID（在 AIAgent 构造时调用，确保审批状态按会话隔离）
 */
export function bindTerminalSession(sessionId: string): void {
  currentSessionId = sessionId
}

/** 默认超时时间（毫秒） */
const DEFAULT_TIMEOUT = 180000

/** 最大输出字符数，超过时截断（40% 头 + 60% 尾） */
const MAX_OUTPUT_CHARS = 50000

/** 最大重试次数 */
const MAX_RETRIES = 3

/** 智能体环境目录（读取主进程设置的环境变量） */
const AGENT_ENV_DIR = process.env.NEXUS_AGENT_ENV_DIR
  || path.join(process.env.HOME || os.homedir(), getNexusDirName(), 'env')

// ==================== Workdir 白名单验证 ====================

/**
 * Workdir 路径安全正则
 * 仅允许字母、数字、常见路径字符，拒绝 shell 元字符
 */
const WORKDIR_SAFE_RE = /^[A-Za-z0-9/_\-.~ +@=,]+$/

/**
 * 验证 workdir 路径安全性
 * 拒绝包含 shell 元字符（;|&$`<>(){}! 等）的路径
 */
function validateWorkdir(workdir: string): string | null {
  if (!WORKDIR_SAFE_RE.test(workdir)) {
    return `Blocked: workdir 包含不允许的字符（仅允许字母、数字、/_-.~ +@=,）`
  }
  return null
}

// ==================== 命令解析 ====================

/**
 * 将命令字符串解析为 [cmd, ...args] 数组
 *
 * 支持：
 * - 简单命令：ls -la → ['ls', '-la']
 * - 带引号的参数：echo "hello world" → ['echo', 'hello world']
 * - 管道/链式命令：保留原样（由 bash -c 执行）
 *
 * 对于包含 shell 元字符的复杂命令，回退到 bash -c 执行
 */
function parseCommand(command: string): { mode: 'spawn'; cmd: string; args: string[] } | { mode: 'shell'; cmd: string; args: string[] } {
  // 检测 shell 元字符（需要 bash -c 执行）
  const hasShellMeta = /[;|&$`<>(){}!\\*?~\[\]]/.test(command)

  if (hasShellMeta) {
    // 包含 shell 元字符 → 通过 bash -c 执行
    return { mode: 'shell', cmd: '/bin/bash', args: ['-c', command] }
  }

  // 简单命令 → 解析为 spawn 参数
  const tokens: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]

    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === '\\' && !inSingleQuote) {
      escaped = true
      continue
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (ch === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (current) tokens.push(current)

  if (tokens.length === 0) {
    return { mode: 'shell', cmd: '/bin/bash', args: ['-c', command] }
  }

  return { mode: 'spawn', cmd: tokens[0], args: tokens.slice(1) }
}

// ==================== sudo 处理 ====================

/**
 * 改写命令中的 sudo 调用，使其通过 stdin 读取密码
 *
 * 将 `sudo cmd` 改写为 `sudo -S -p '' cmd`，
 * 这样 sudo 从 stdin 读取密码而不是从 /dev/tty。
 *
 * @param command - 原始命令
 * @returns 改写后的命令（如果不含 sudo 则返回原命令）
 */
function transformSudoCommand(command: string): string {
  // 检测命令中是否有未引用的 sudo 关键字（作为命令词）
  // 简单处理：匹配行首或 ;/|/&&/|| 后的 sudo
  const sudoPattern = /(^|[;&|]\s*)sudo(\s)/gm
  if (!sudoPattern.test(command)) {
    return command
  }
  return command.replace(sudoPattern, '$1sudo -S -p \'\'$2')
}

// ==================== 退出码解释 ====================

/**
 * 非零退出码语义表
 *
 * 某些 Unix 命令的退出码 1 并非错误，而是"正常但有信息量"的状态。
 * 添加人类可读注释，防止 AI 智能体误判。
 */
const EXIT_CODE_SEMANTICS: Record<string, Record<number, string>> = {
  grep:  { 1: '无匹配结果（不是错误）' },
  egrep: { 1: '无匹配结果（不是错误）' },
  fgrep: { 1: '无匹配结果（不是错误）' },
  rg:    { 1: '无匹配结果（不是错误）' },
  ag:    { 1: '无匹配结果（不是错误）' },
  ack:   { 1: '无匹配结果（不是错误）' },
  diff:  { 1: '文件有差异（预期行为，不是错误）' },
  colordiff: { 1: '文件有差异（预期行为，不是错误）' },
  find:  { 1: '部分目录无权限访问（结果可能不完整）' },
  test:  { 1: '条件求值为假（预期行为，不是错误）' },
  '[':   { 1: '条件求值为假（预期行为，不是错误）' },
  curl:  {
    6: '无法解析主机名',
    7: '无法连接到主机',
    22: 'HTTP 响应码表示错误（如 404、500）',
    28: '操作超时',
  },
  git:   { 1: '非零退出（通常正常，如 git diff 有变化时返回 1）' },
}

/**
 * 解释非零退出码的含义
 *
 * 从管道/链中提取最后一段命令，查找语义表。
 *
 * @param command - 执行的命令
 * @param exitCode - 退出码
 * @returns 人类可读注释，或 null（退出码为 0 或无匹配时）
 */
function interpretExitCode(command: string, exitCode: number): string | null {
  if (exitCode === 0) return null

  // 提取管道/链中的最后一段命令
  const segments = command.split(/\s*(?:\|\||&&|[|;])\s*/)
  const lastSegment = (segments[segments.length - 1] || command).trim()

  // 获取基础命令名（第一个词，跳过 VAR=val 赋值）
  const words = lastSegment.split(/\s+/)
  let baseCmd = ''
  for (const w of words) {
    if (w.includes('=') && !w.startsWith('-')) continue
    baseCmd = w.split('/').pop() || ''
    break
  }

  if (!baseCmd) return null

  const semantics = EXIT_CODE_SEMANTICS[baseCmd]
  if (semantics && semantics[exitCode]) {
    return semantics[exitCode]
  }

  return null
}

// ==================== 截断 ====================

/**
 * 截断过长的输出
 * 头部保留 40%，尾部保留 60%
 */
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output

  const headLen = Math.floor(MAX_OUTPUT_CHARS * 0.4)
  const tailLen = MAX_OUTPUT_CHARS - headLen

  return output.slice(0, headLen)
    + '\n\n... [输出已截断，共 ' + output.length + ' 字符] ...\n\n'
    + output.slice(-tailLen)
}

// ==================== 工具定义 ====================

export const terminalTool: ToolDefinition = {
  name: 'terminal',
  description: `执行终端命令。

注意：
- 不要用 cat/head/tail 读取文件 — 使用 read_file。
- 不要用 grep/rg/find 搜索文件 — 使用 search_files。
- 不要用 ls 列目录 — 使用 search_files(target='files')。
- 终端仅用于：构建、安装、git、进程管理、网络操作、包管理器，以及需要 shell 的操作。

命令在本地 bash 中执行，支持标准 bash 语法。`,
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的命令，如 "ls -la" 或 "npm install"',
      },
      cwd: {
        type: 'string',
        description: `工作目录（可选），默认为智能体环境目录 (当前: ${AGENT_ENV_DIR})`,
      },
      timeout: {
        type: 'number',
        description: '超时时间（毫秒），默认 180000（180 秒）',
      },
    },
    required: ['command'],
  },
  handler: async (args, onUpdate, signal): Promise<ToolResult> => {
    const command = String(args.command ?? '').trim()
    const cwd = args.cwd ? String(args.cwd) : AGENT_ENV_DIR
    const timeout = typeof args.timeout === 'number' ? args.timeout : DEFAULT_TIMEOUT

    if (!command) {
      return { success: false, output: '命令不能为空' }
    }

    // 1. Workdir 路径安全验证
    const workdirError = validateWorkdir(cwd)
    if (workdirError) {
      logger.warn(`[Terminal] Workdir 被拒绝: ${cwd} — 原因: ${workdirError}`)
      return {
        success: false,
        output: `工作目录被拒绝：${workdirError}。仅允许字母、数字、/_-.~ +@=, 字符。`,
      }
    }

    // 2. 安全检查（危险命令检测 + 审批）
    const approval = await checkDangerousCommand(command, currentSessionId)
    if (approval.blocked) {
      logger.warn(`[Terminal] 危险命令被拒绝: ${command} — 原因: ${approval.description}`)
      return {
        success: false,
        output: `命令被拒绝：${approval.message}`,
      }
    }
    if (approval.description) {
      logger.warn(`[Terminal] 危险命令已批准: ${command} — 原因: ${approval.description}`)
    }

    // 3. sudo 改写
    const effectiveCommand = transformSudoCommand(command)

    // 4. 如果有 Nexus 终端连接，将命令路由到连接的 PTY 执行
    const nexusConnection = NexusConnectionManager.getInstance().getConnection()
    if (nexusConnection && NexusConnectionManager.getInstance().getConnectionType() === 'terminal') {
      // 检查是否已被中断
      if (signal?.aborted) {
        return { success: false, output: '命令执行已被中断' }
      }
      logger.info(`[Terminal] Nexus 路由: ${effectiveCommand} → 面板 ${nexusConnection.panelId}`)
      try {
        const result = await NexusConnectionManager.getInstance().executeCommand(
          effectiveCommand,
          cwd,
          onUpdate ? (chunk: string) => onUpdate(chunk) : undefined
        )
        return {
          success: result.success,
          output: result.output,
          data: result.data,
        }
      } catch (error) {
        return {
          success: false,
          output: `Nexus 执行错误: ${(error as Error).message}`,
          data: { exitCode: -1, command: effectiveCommand, cwd },
        }
      }
    }

    logger.info(`[Terminal] 执行: ${effectiveCommand} (cwd: ${cwd}, timeout: ${timeout}ms)`)

    // 检查是否已被中断（在开始执行 spawn 之前）
    if (signal?.aborted) {
      return { success: false, output: '命令执行已被中断' }
    }

    // 3. 执行命令（带重试）
    let lastError: Error | null = null
    let output = ''
    let exitCode = 0
    let success = true

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // 每次重试前检查中断
      if (signal?.aborted) {
        return { success: false, output: '命令执行已被中断' }
      }
      try {
        const result = await execCommand(effectiveCommand, cwd, timeout, signal)
        output = result.output
        exitCode = result.exitCode
        success = result.success
        lastError = null
        break // 成功，跳出重试循环
      } catch (error) {
        lastError = error as Error
        if (attempt < MAX_RETRIES) {
          const waitTime = Math.pow(2, attempt + 1) * 1000 // 2s, 4s, 8s
          logger.warn(`[Terminal] 执行失败，${waitTime / 1000}s 后重试 (${attempt + 1}/${MAX_RETRIES}): ${command} — ${lastError.message}`)
          await sleep(waitTime)
        }
      }
    }

    if (lastError) {
      success = false
      output = ''
      exitCode = -1
      logger.error(`[Terminal] 执行失败（重试 ${MAX_RETRIES} 次后）: ${command} — ${lastError.message}`)
    }

    // 4. 输出处理

    // 4a. 截断
    output = truncateOutput(output)

    // 4b. ANSI 清理
    output = stripAnsi(output)

    // 4c. 敏感信息脱敏
    output = redactSensitiveText(output.trim())

    // 4d. 退出码语义解释
    const exitNote = interpretExitCode(effectiveCommand, exitCode)

    if (exitNote) {
      output += `\n\n[退出码 ${exitCode} 含义: ${exitNote}]`
    }

    if (!success && exitCode !== 0) {
      output += `\n\n[退出码: ${exitCode}]`
    }

    return {
      success,
      output,
      data: {
        exitCode,
        command: effectiveCommand,
        cwd,
      },
    }
  },
}

// ==================== 内部辅助函数 ====================

interface ExecResult {
  output: string
  exitCode: number
  success: boolean
}

/**
 * 使用 spawn 执行命令
 *
 * 相比 exec 的优势：
 * - 命令和参数分离传递，避免 shell 注入
 * - 支持流式输出（stdout/stderr 分别处理）
 * - 不经过 shell 解析（简单命令）或显式通过 bash -c（复杂命令）
 */
function execCommand(command: string, cwd: string, timeout: number, signal?: AbortSignal): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const parsed = parseCommand(command)
    const isWindows = process.platform === 'win32'

    // 不使用 Node.js 内置的 signal 选项（它会先调用 child.kill()，导致
    // child.killed = true，使我们自定义的进程组 kill 被跳过）
    const child = spawn(parsed.cmd, parsed.args, {
      cwd,
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      // 移除 signal 参数，统一由自定义 abort 监听器处理
      // signal,
      // 使子进程成为独立进程组，便于中断时一次性终止整个进程树
      detached: !isWindows,
    })

    /**
     * 终止整个进程组（包括子进程派生的孙子进程）
     * 使用负号 PID 表示进程组，-child.pid 即为子进程所在的进程组 ID
     */
    const killProcessGroup = (sig: 'SIGTERM' | 'SIGKILL') => {
      if (child.pid) {
        try { process.kill(-child.pid!, sig) } catch { /* 进程组可能已退出 */ }
      }
      // 兜底：对子进程本身也发一次信号
      if (!child.killed) {
        child.kill(sig)
      }
    }

    // signal 被中止时立即 kill 子进程及其派生进程
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      if (!child.killed) {
        killProcessGroup('SIGTERM')
        setTimeout(() => {
          if (!child.killed) killProcessGroup('SIGKILL')
        }, 2000)
      }
    }, { once: true })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      killProcessGroup('SIGTERM')
      // 2 秒后如果还没退出，强杀
      setTimeout(() => {
        if (!child.killed) killProcessGroup('SIGKILL')
      }, 2000)
    }, timeout)

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf8')
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf8')
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code, signal) => {
      clearTimeout(timer)

      let output = ''
      if (stdout) output += stdout
      if (stderr) {
        if (output) output += '\n'
        output += stderr
      }

      if (timedOut) {
        reject(new Error(`命令超时 (${timeout}ms)`))
        return
      }

      // signal 被杀死也视为失败
      if (signal) {
        resolve({
          output,
          exitCode: -1,
          success: false,
        })
        return
      }

      const exitCode = code ?? 0
      resolve({
        output,
        exitCode,
        success: exitCode === 0,
      })
    })
  })
}

/**
 * 睡眠指定毫秒
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
