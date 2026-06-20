/**
 * Shell 命令执行辅助
 *
 * 统一 execAsync 的超时、缓冲区大小、错误处理模式。
 */

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/** 默认最大缓冲区：5MB */
const DEFAULT_MAX_BUFFER = 1024 * 1024 * 5

/** 默认超时：30 秒 */
const DEFAULT_TIMEOUT = 30000

/**
 * 运行 shell 命令并返回 stdout
 *
 * @param command - 要执行的命令
 * @param options - 可选配置
 * @param options.timeout - 超时时间（毫秒），默认 30000
 * @param options.maxBuffer - 最大缓冲区（字节），默认 5MB
 * @param options.throwOnExitCode1 - 退出码 1 时是否抛出异常，默认 true
 * @returns stdout 输出
 * @throws 命令执行失败时抛出异常
 */
export async function runShellCommand(
  command: string,
  options?: {
    timeout?: number
    maxBuffer?: number
    throwOnExitCode1?: boolean
  }
): Promise<string> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT
  const maxBuffer = options?.maxBuffer ?? DEFAULT_MAX_BUFFER
  const throwOnExitCode1 = options?.throwOnExitCode1 ?? true

  const { stdout } = await execAsync(command, {
    timeout,
    maxBuffer,
  })
  return stdout
}

/**
 * 检查命令是否存在于 PATH 中
 */
export async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${cmd}`, { timeout: 5000 })
    return true
  } catch {
    return false
  }
}
