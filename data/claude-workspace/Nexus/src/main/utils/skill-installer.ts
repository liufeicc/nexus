/**
 * Skills 安装工具
 *
 * 在应用首次启动（引导窗口创建前）将打包的内置 Skills
 * 安装到用户数据目录的 skills/ 下。
 *
 * 规则：
 * 1. 如果 SKILL 已存在，删除后重新安装
 * 2. 不改变已有的其他 SKILL
 * 3. 支持 Linux / Windows / Mac 三平台
 */

import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { getNexusDirName } from '../../core/utils/path-utils'

/**
 * 递归复制目录
 */
function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }

  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * 获取打包的 skills 目录路径
 */
function getBundledSkillsDir(): string {
  if (process.env.NODE_ENV === 'development') {
    // 开发环境: 项目根目录/resources/skills/
    // __dirname 在开发模式下指向 src/main/utils/
    return path.join(__dirname, '../../../resources/skills')
  }
  // 生产环境: process.resourcesPath/skills/
  // process.resourcesPath 由 Electron 提供，指向安装包内的 resources 目录
  return path.join(process.resourcesPath, 'skills')
}

/**
 * 获取目标 skills 目录 (~/.Nexus/skills 或 ~/.Nexus_dev/skills)
 */
function getTargetSkillsDir(): string {
  return path.join(app.getPath('home'), getNexusDirName(), 'skills')
}

/**
 * 安装打包的内置 Skills
 * @returns 已安装的 SKILL 名称列表
 */
export async function installBundledSkills(): Promise<{ installed: string[] }> {
  const bundledDir = getBundledSkillsDir()
  const targetDir = getTargetSkillsDir()

  // 如果打包的 skills 目录不存在，跳过
  if (!fs.existsSync(bundledDir)) {
    return { installed: [] }
  }

  // 确保目标目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const installed: string[] = []

  // 读取所有 SKILL 子目录（只处理目录）
  const skillEntries = fs.readdirSync(bundledDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)

  for (const skillName of skillEntries) {
    const sourceSkill = path.join(bundledDir, skillName)
    const targetSkill = path.join(targetDir, skillName)

    // 如果目标 SKILL 已存在，先删除
    if (fs.existsSync(targetSkill)) {
      fs.rmSync(targetSkill, { recursive: true, force: true })
    }

    // 复制 SKILL 到目标目录
    copyDirRecursive(sourceSkill, targetSkill)
    installed.push(skillName)
  }

  return { installed }
}
