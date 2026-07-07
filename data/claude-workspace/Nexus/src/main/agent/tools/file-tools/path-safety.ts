/**
 * 文件工具：路径安全检查
 *
 * 包含写入黑名单、敏感路径检测、设备路径拦截、~ 展开等。
 */

import path from 'path'

// ==================== 写入路径保护 ====================

/** 禁止写入的精确路径（realpath 解析后匹配） */
const WRITE_DENIED_PATHS = new Set([
  '/etc/sudoers',
  '/etc/passwd',
  '/etc/shadow',
  '/etc/ssh/sshd_config',
  '/etc/ssh/ssh_config',
])

/** 禁止写入的路径前缀（realpath 解析后 startsWith 匹配） */
const WRITE_DENIED_PREFIXES = [
  '/proc/', '/sys/', '/dev/', '/run/', '/boot/',
  '/usr/lib/', '/usr/local/lib/', '/var/lib/dpkg/',
  '/var/lib/apt/', '/etc/systemd/', '/etc/sudoers.d/',
  '/usr/lib/systemd/',
]

/** 敏感系统路径前缀 — 写入时提示用 terminal + sudo */
const SENSITIVE_PATH_PREFIXES = [
  '/etc/',
  '/boot/',
  '/usr/lib/systemd/',
  '/private/etc/',
  '/private/var/',
]

const SENSITIVE_EXACT_PATHS = [
  '/var/run/docker.sock',
  '/run/docker.sock',
]

/** 禁止操作的设备路径 */
const DEVICE_BLOCK_LIST = [
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/null',
]

/**
 * 展开路径中的 ~ 为用户家目录
 */
export function expandTilde(p: string): string {
  if (p.startsWith('~')) {
    const home = process.env.HOME || '/tmp'
    return path.join(home, p.slice(1))
  }
  return p
}

/**
 * 检查写入路径是否被静态黑名单拒绝
 */
export function isWriteDenied(filePath: string): { denied: boolean; reason?: string } {
  const expanded = expandTilde(filePath)
  const resolved = path.resolve(expanded)

  // 精确路径匹配
  if (WRITE_DENIED_PATHS.has(resolved)) {
    return { denied: true, reason: `'${filePath}' 是受保护的系统/凭证文件` }
  }

  // 路径前缀匹配
  for (const prefix of WRITE_DENIED_PREFIXES) {
    if (resolved.startsWith(prefix)) {
      return { denied: true, reason: `'${filePath}' 位于受保护的目录 ${prefix} 下` }
    }
  }

  return { denied: false }
}

/**
 * 检查路径是否指向敏感系统位置
 */
export function checkSensitivePath(filePath: string): string | null {
  const expanded = expandTilde(filePath)
  const resolved = path.resolve(expanded)
  const normalized = path.normalize(expanded)

  for (const p of SENSITIVE_PATH_PREFIXES) {
    if (resolved.startsWith(p) || normalized.startsWith(p)) {
      return `拒绝写入敏感系统路径: ${filePath}\n如需修改系统文件，请使用 terminal 工具 + sudo`
    }
  }

  for (const p of SENSITIVE_EXACT_PATHS) {
    if (resolved === p || normalized === p) {
      return `拒绝写入敏感系统路径: ${filePath}\n如需修改系统文件，请使用 terminal 工具 + sudo`
    }
  }

  return null
}

/**
 * 判断写入错误是否为预期的拒绝（权限不足等）
 */
export function isExpectedWriteError(err: any): boolean {
  const code = err?.code
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || err instanceof Error && err.message.includes('permission')
}

/**
 * 检查路径是否安全（用于 read_file 等通用检查）
 */
export function isPathSafe(filePath: string): { safe: boolean; reason?: string } {
  const expanded = expandTilde(filePath)
  const resolved = path.resolve(expanded)

  // 设备路径检查
  for (const device of DEVICE_BLOCK_LIST) {
    if (resolved.startsWith(device)) {
      return { safe: false, reason: `禁止操作设备路径: ${device}` }
    }
  }

  return { safe: true }
}

/**
 * 设备路径黑名单（供其他模块使用）
 */
export const DEVICE_PATHS = DEVICE_BLOCK_LIST
