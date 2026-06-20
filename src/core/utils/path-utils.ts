/**
 * 渲染进程安全的路径工具函数（不依赖 electron 和 Node.js 模块）
 */

/**
 * 获取路径中的文件名部分
 * @param input 文件路径
 * @returns 文件名，如 "/home/user/doc.txt" -> "doc.txt"
 */
export function getBasename(input: string): string {
  const normalized = input.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts.pop() || input
}

/**
 * 获取路径中的目录部分
 * @param input 文件路径
 * @returns 目录路径，如 "/home/user/doc.txt" -> "/home/user"
 */
export function getDirname(input: string): string {
  const normalized = input.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash < 0 ? '.' : normalized.slice(0, lastSlash) || '/'
}

/**
 * 拼接路径片段
 * @param segments 路径片段
 * @returns 拼接后的路径，如 joinPath("/home", "user", "file.txt") -> "/home/user/file.txt"
 */
export function joinPath(...segments: string[]): string {
  return segments
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/'
}

/**
 * 将路径按分隔符拆分为数组
 * @param input 路径
 * @returns 路径片段数组，如 "/home/user/" -> ["home", "user"]
 */
export function splitPath(input: string): string[] {
  return input.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
}

/**
 * 获取路径的父目录
 * @param input 路径
 * @returns 父目录路径，如 "/home/user" -> "/home"，根目录 "/" 返回 ""
 */
export function getParentDir(input: string): string {
  const parent = getDirname(input)
  return parent === '/' ? '' : parent
}

/**
 * Nexus 配置目录名称
 * 开发环境：.Nexus_dev
 * 生产环境：.Nexus
 */
export function getNexusDirName(): string {
  // eslint-disable-next-line no-undef
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'
    ? '.Nexus_dev'
    : '.Nexus'
}
