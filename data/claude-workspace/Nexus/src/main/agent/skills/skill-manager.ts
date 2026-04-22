/**
 * Skill 管理器
 *
 * 职责：Skill 发现、解析、缓存、CRUD 的统一编排器。
 * 扫描 ~/.Nexus/skills/ 目录，解析 SKILL.md frontmatter，
 * 提供 skills_list / skill_view / skill_manage 所需的底层能力。
 */

import fs from 'node:fs'
import path from 'node:path'
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
    _skillDir: string,
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
        const files = this.listFilesRecursively(subDir)
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
  private listFilesRecursively(dirPath: string): string[] {
    const results: string[] = []
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        results.push(...this.listFilesRecursively(fullPath))
      } else {
        const relativePath = path.relative(path.dirname(dirPath), fullPath)
        results.push(relativePath)
      }
    }

    return results
  }

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

  // ── 缓存 ──

  /**
   * 清除内存缓存
   */
  invalidateCache(): void {
    this.cache = null
    this.cacheTimestamp = 0
  }
}
