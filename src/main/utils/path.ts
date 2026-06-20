/**
 * 路径工具函数（仅主进程使用，依赖 electron 模块）
 */

import { app } from 'electron'
import * as path from 'path'

/**
 * 展开路径中的 ~ 为用户主目录
 * @param input 原始路径
 * @returns 展开后的路径
 */
export function expandTilde(input: string): string {
  if (input.startsWith('~')) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || app.getPath('home')
    return path.join(homeDir, input.slice(1))
  }
  return input
}

/**
 * 展开路径并分离目录部分和前缀（用于路径补全）
 * @param input 原始路径
 * @returns { basePath, prefix } basePath 是要搜索的目录，prefix 是要匹配的前缀
 */
export function splitPathForAutocomplete(input: string): { basePath: string; prefix: string } {
  // 空输入默认到 home 目录
  if (!input || input.trim() === '') {
    input = '~/'
  }

  if (input.startsWith('~')) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || app.getPath('home')

    if (input === '~' || input === '~/') {
      return { basePath: homeDir, prefix: '' }
    }

    // ~/xxx/yyy 形式：分离目录部分和前缀
    const relativePath = input.slice(2)
    const lastSlashIndex = relativePath.lastIndexOf('/')
    if (lastSlashIndex === -1) {
      return { basePath: homeDir, prefix: relativePath }
    }
    const dirPart = relativePath.slice(0, lastSlashIndex)
    const prefix = relativePath.slice(lastSlashIndex + 1)
    return { basePath: path.join(homeDir, dirPart), prefix }
  }

  if (input.startsWith('/')) {
    const lastSlashIndex = input.lastIndexOf('/')
    if (lastSlashIndex === 0) {
      return { basePath: '/', prefix: input.slice(1) }
    }
    const dirPart = input.slice(0, lastSlashIndex)
    const prefix = input.slice(lastSlashIndex + 1)
    return { basePath: dirPart, prefix }
  }

  // 相对路径，相对于当前工作目录
  const lastSlashIndex = input.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    return { basePath: process.cwd(), prefix: input }
  }
  const dirPart = input.slice(0, lastSlashIndex)
  const prefix = input.slice(lastSlashIndex + 1)
  return { basePath: path.resolve(dirPart), prefix }
}
