/**
 * Skill 管理器
 *
 * 职责：Skill 发现、解析、缓存、CRUD 的统一编排器。
 * 扫描 ~/.Nexus/skills/ 目录，解析 SKILL.md frontmatter，
 * 提供 skills_list / skill_view / skill_manage 所需的底层能力。
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
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
  private _skillsDir: string
  private cache: SkillMeta[] | null = null
  private cacheTimestamp: number = 0
  /** SkillContent 缓存：key 为 "name|filePath"，value 为 {data, timestamp} */
  private contentCache: Map<string, { data: SkillContent; timestamp: number }> = new Map()
  /** 进程内写锁：正在被编辑的 skill 名称集合 */
  private writeLocks: Set<string> = new Set()
  private readonly CACHE_TTL_MS = 30_000

  constructor(skillsDir?: string) {
    this._skillsDir = skillsDir || SKILLS_DIR
    // 确保目录存在
    if (!fs.existsSync(this._skillsDir)) {
      fs.mkdirSync(this._skillsDir, { recursive: true })
    }
  }

  /** 获取 skills 根目录路径 */
  get skillsDir(): string {
    return this._skillsDir
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
   * 发现所有 SKILL.md 文件路径
   *
   * 递归扫描 skills 目录，返回所有 SKILL.md 的绝对路径和所属分类。
   * 可选通过 filterFn 过滤（如符号链接检查）。
   */
  discoverSkillFiles(
    filterFn?: (skillMdPath: string, cat: string) => boolean,
  ): Array<{ skillMdPath: string; category: string }> {
    if (!fs.existsSync(this._skillsDir)) {
      return []
    }

    const results: Array<{ skillMdPath: string; category: string }> = []
    const categories = this.getSkillCategories()

    for (const cat of categories) {
      const catDir = path.join(this._skillsDir, cat)
      if (!fs.existsSync(catDir) || !fs.statSync(catDir).isDirectory()) {
        continue
      }

      // 模式 1：检查分类根目录是否有 SKILL.md（扁平结构，如 docx/SKILL.md）
      const rootSkillMd = path.join(catDir, 'SKILL.md')
      if (fs.existsSync(rootSkillMd)) {
        if (!filterFn || filterFn(rootSkillMd, cat)) {
          results.push({ skillMdPath: rootSkillMd, category: cat })
        }
      }

      // 模式 2：扫描子目录中的 SKILL.md（嵌套结构，如 category/skill-name/SKILL.md）
      const entries = fs.readdirSync(catDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue

        const skillDir = path.join(catDir, entry.name)
        const skillMdPath = path.join(skillDir, 'SKILL.md')
        if (!fs.existsSync(skillMdPath)) continue

        if (filterFn && !filterFn(skillMdPath, cat)) continue

        results.push({ skillMdPath, category: cat })
      }
    }

    return results
  }

  /**
   * 扫描 skills 目录，解析所有 SKILL.md
   */
  private scanSkillsDirectory(category?: string): SkillMeta[] {
    if (!fs.existsSync(this._skillsDir)) {
      return []
    }

    // 如果指定了 category，只扫描该分类
    const targetCategories = category ? [category] : this.getSkillCategories()

    const results: SkillMeta[] = []
    for (const cat of targetCategories) {
      const catDir = path.join(this._skillsDir, cat)
      if (!fs.existsSync(catDir) || !fs.statSync(catDir).isDirectory()) {
        continue
      }

      // 模式 1：检查分类根目录是否有 SKILL.md（扁平结构，如 docx/SKILL.md）
      const rootSkillMd = path.join(catDir, 'SKILL.md')
      if (fs.existsSync(rootSkillMd)) {
        try {
          const content = fs.readFileSync(rootSkillMd, 'utf-8')
          const parsed = this.parseSkillMd(content)
          const meta = this.buildSkillMeta(parsed, cat)
          results.push(meta)
        } catch (error) {
          logger.warn(`[SkillManager] 解析 SKILL.md 失败 ${rootSkillMd}: ${error}`)
        }
      }

      // 模式 2：扫描子目录中的 SKILL.md（嵌套结构，如 category/skill-name/SKILL.md）
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
          const meta = this.buildSkillMeta(parsed, cat)
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
    if (!fs.existsSync(this._skillsDir)) return []
    return fs.readdirSync(this._skillsDir, { withFileTypes: true })
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
      // 模式 1：嵌套结构 category/name/
      const nestedDir = path.join(this._skillsDir, cat, name)
      if (fs.existsSync(nestedDir) && fs.statSync(nestedDir).isDirectory()) {
        return { category: cat, dirPath: nestedDir }
      }
      // 模式 2：扁平结构 category/（分类名即 skill 名）
      if (cat === name) {
        const flatDir = path.join(this._skillsDir, cat)
        if (fs.existsSync(flatDir) && fs.statSync(flatDir).isDirectory()) {
          const skillMdPath = path.join(flatDir, 'SKILL.md')
          if (fs.existsSync(skillMdPath)) {
            return { category: cat, dirPath: flatDir }
          }
        }
      }
    }
    return null
  }

  // ── 解析 ──

  /**
   * 解析 SKILL.md 内容：提取 frontmatter + body
   */
  parseSkillMd(content: string): ParsedSkill {
    // 统一换行符（兼容 \r\n、\r、\r\n\r\n 等）
    const normalized = content.replace(/\r\n?/g, '\n').replace(/^\n+/, '')
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/
    const match = normalized.match(frontmatterRegex)

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

    // 检查命令（跨平台：Windows 用 where，Unix 用 which）
    const missingCommands: string[] = []
    for (const cmd of frontmatter.prerequisites?.commands ?? []) {
      const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`
      try {
        execSync(checkCmd, { stdio: 'ignore' })
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
    // 检查缓存
    const cacheKey = `${name}|${filePath || ''}`
    const now = Date.now()
    const cached = this.contentCache.get(cacheKey)
    if (cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data
    }

    const skillInfo = this.findSkillDir(name)
    if (!skillInfo) {
      throw new Error(`Skill 不存在: ${name}`)
    }

    const { dirPath } = skillInfo

    // 安全检查
    if (filePath) {
      const err = this.validateSkillFilePath(filePath, dirPath)
      if (err) {
        throw new Error(err)
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
    const tags = parsed.frontmatter.tags ?? parsed.frontmatter.metadata?.nexus?.tags ?? []
    const relatedSkills = parsed.frontmatter.metadata?.nexus?.related_skills ?? []

    // 如果指定了 file_path，读取特定文件
    if (filePath) {
      const targetPath = path.join(dirPath, filePath)
      if (!fs.existsSync(targetPath)) {
        throw new Error(`文件不存在: ${filePath}`)
      }
      const fileContent = fs.readFileSync(targetPath, 'utf-8')
      const result: SkillContent = {
        name,
        description: parsed.frontmatter.description,
        content: fileContent,
        linkedFiles,
        tags,
        relatedSkills,
        warnings: scanResult.findings,
      }
      this.contentCache.set(cacheKey, { data: result, timestamp: now })
      return result
    }

    const result: SkillContent = {
      name,
      description: parsed.frontmatter.description,
      content: content,
      linkedFiles,
      tags,
      relatedSkills,
      warnings: scanResult.findings,
    }
    this.contentCache.set(cacheKey, { data: result, timestamp: now })
    return result
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

  // ── 安全辅助 ──

  /**
   * 验证文件路径是否在 skill 目录内（防路径遍历）
   *
   * @returns 安全检查通过返回 null，失败返回错误信息
   */
  private validateSkillFilePath(filePath: string, dirPath: string): string | null {
    if (hasPathTraversal(filePath)) {
      return `路径遍历检测: 非法路径 ${filePath}`
    }
    const resolvedPath = path.join(dirPath, filePath)
    if (!isWithinDirectory(resolvedPath, dirPath)) {
      return `文件路径超出 skill 目录`
    }
    return null
  }

  /**
   * 尝试获取 skill 写锁
   * @returns true 表示获取成功，false 表示已被其他会话编辑
   */
  private tryAcquireWriteLock(name: string): boolean {
    if (this.writeLocks.has(name)) return false
    this.writeLocks.add(name)
    return true
  }

  /**
   * 释放 skill 写锁
   */
  private releaseWriteLock(name: string): void {
    this.writeLocks.delete(name)
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

    if (!this.tryAcquireWriteLock(name)) {
      return { success: false, message: `Skill 正在被其他会话编辑: ${name}` }
    }

    try {
      const skillDirPath = path.join(this._skillsDir, category, name)
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
    } finally {
      this.releaseWriteLock(name)
    }
  }

  /**
   * 替换整个 SKILL.md 内容
   */
  editSkill(name: string, newContent: string): SkillManageResult {
    if (!this.tryAcquireWriteLock(name)) {
      return { success: false, message: `Skill 正在被其他会话编辑: ${name}` }
    }

    try {
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
    } finally {
      this.releaseWriteLock(name)
    }
  }

  /**
   * 更新 frontmatter 字段或追加 body 文本
   */
  patchSkill(
    name: string,
    updates: { frontmatter?: Record<string, unknown>; bodyAppend?: string },
  ): SkillManageResult {
    if (!this.tryAcquireWriteLock(name)) {
      return { success: false, message: `Skill 正在被其他会话编辑: ${name}` }
    }

    try {
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

      // 安全扫描
      const scanResult = scanSkillContent(newContent, skillMdPath)
      if (scanResult.blocked) {
        return { success: false, message: `安全扫描阻止编辑 skill: ${scanResult.findings.join(', ')}` }
      }

      // 大小检查
      if (newContent.length > MAX_SKILL_MD_SIZE) {
        return { success: false, message: `SKILL.md 超过最大字符数 ${MAX_SKILL_MD_SIZE}` }
      }

      this.atomicWrite(skillMdPath, newContent)
      this.invalidateCache()

      const files = fs.readdirSync(skillInfo.dirPath)
      return { success: true, message: `Skill 更新成功: ${name}`, skillName: name, files }
    } finally {
      this.releaseWriteLock(name)
    }
  }

  /**
   * 删除整个 skill 目录
   */
  deleteSkill(name: string): SkillManageResult {
    if (!this.tryAcquireWriteLock(name)) {
      return { success: false, message: `Skill 正在被其他会话编辑: ${name}` }
    }

    try {
      const skillInfo = this.findSkillDir(name)
      if (!skillInfo) {
        return { success: false, message: `Skill 不存在: ${name}` }
      }

      fs.rmSync(skillInfo.dirPath, { recursive: true, force: true })
      this.invalidateCache()

      return { success: true, message: `Skill 删除成功: ${name}`, skillName: name }
    } finally {
      this.releaseWriteLock(name)
    }
  }

  /**
   * 在 skill 目录内创建/覆盖文件
   */
  writeSkillFile(name: string, filePath: string, content: string): SkillManageResult {
    if (!this.tryAcquireWriteLock(name)) {
      return { success: false, message: `Skill 正在被其他会话编辑: ${name}` }
    }

    try {
      const skillInfo = this.findSkillDir(name)
      if (!skillInfo) {
        return { success: false, message: `Skill 不存在: ${name}` }
      }

      const pathErr = this.validateSkillFilePath(filePath, skillInfo.dirPath)
      if (pathErr) {
        return { success: false, message: pathErr }
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

      // targetPath 已通过 validateSkillFilePath 验证，无需重复检查
      const targetPath = path.join(skillInfo.dirPath, filePath)

      // 确保父目录存在
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      this.atomicWrite(targetPath, content)
      this.invalidateCache()

      const files = fs.readdirSync(skillInfo.dirPath)
      return { success: true, message: `文件写入成功: ${filePath}`, skillName: name, files }
    } finally {
      this.releaseWriteLock(name)
    }
  }

  /**
   * 删除 skill 目录内的文件
   */
  removeSkillFile(name: string, filePath: string): SkillManageResult {
    if (!this.tryAcquireWriteLock(name)) {
      return { success: false, message: `Skill 正在被其他会话编辑: ${name}` }
    }

    try {
      const skillInfo = this.findSkillDir(name)
      if (!skillInfo) {
        return { success: false, message: `Skill 不存在: ${name}` }
      }

      const pathErr = this.validateSkillFilePath(filePath, skillInfo.dirPath)
      if (pathErr) {
        return { success: false, message: pathErr }
      }

      const targetPath = path.join(skillInfo.dirPath, filePath)

      if (!fs.existsSync(targetPath)) {
        return { success: false, message: `文件不存在: ${filePath}` }
      }

      fs.unlinkSync(targetPath)
      this.invalidateCache()

      const files = fs.readdirSync(skillInfo.dirPath)
      return { success: true, message: `文件删除成功: ${filePath}`, skillName: name, files }
    } finally {
      this.releaseWriteLock(name)
    }
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
    // 剥离 body 中可能已有的 YAML frontmatter，避免双重 frontmatter
    let cleanBody = body
    if (cleanBody.startsWith('---')) {
      const secondDash = cleanBody.indexOf('---', 3)
      if (secondDash !== -1) {
        // 跳过第二个 --- 及其后的换行
        cleanBody = cleanBody.substring(secondDash + 3).replace(/^\n+/, '')
      }
    }

    const yamlStr = yaml.dump(frontmatter, { indent: 2, lineWidth: -1 })
    return `---\n${yamlStr}---\n\n${cleanBody}`
  }

  /**
   * 原子写入：先写临时文件，再 rename 覆盖（崩溃安全）
   */
  private atomicWrite(filePath: string, content: string): void {
    const tmpPath = `${filePath}.tmp.${crypto.randomUUID()}`
    fs.writeFileSync(tmpPath, content, 'utf-8')
    fs.renameSync(tmpPath, filePath)
  }

  // ── 缓存 ──

  /**
   * 清除内存缓存（含 listSkills 和 getSkillContent 缓存）
   */
  invalidateCache(): void {
    this.cache = null
    this.cacheTimestamp = 0
    this.contentCache.clear()
  }
}
