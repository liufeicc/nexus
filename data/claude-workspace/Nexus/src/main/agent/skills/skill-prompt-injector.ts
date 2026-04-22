/**
 * Skill 系统提示注入器
 *
 * 职责：构建可用 skill 列表注入系统提示，含双层缓存（内存 LRU + 磁盘快照）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { SkillManager } from './skill-manager'
import {
  SKILLS_DIR,
  SKILLS_SNAPSHOT_FILE,
} from '../../../core/constants/skill'
import { SkillMeta } from '../../../core/types/skill'

/** 磁盘快照数据 */
interface SnapshotData {
  version: number
  skills: Array<{
    skill_name: string
    category: string | null
    frontmatter_name: string
    description: string
    platforms: string[]
  }>
  manifest: {
    mtime: number
    size: number
    files: Record<string, { mtime: number; size: number }>
  }
}

/**
 * Skill 提示注入器
 */
export class SkillPromptInjector {
  private skillManager: SkillManager
  private lruCache: Map<string, string> = new Map()
  private readonly MAX_LRU_ENTRIES = 8
  private snapshotPath: string

  constructor(skillManager: SkillManager, snapshotPath?: string) {
    this.skillManager = skillManager
    this.snapshotPath = snapshotPath || path.join(SKILLS_DIR, SKILLS_SNAPSHOT_FILE)
  }

  /**
   * 构建 skill 索引 block
   */
  buildBlock(
    disabledNames: Set<string> = new Set(),
    _availableTools?: Set<string>,
  ): string {
    const cacheKey = this.makeCacheKey(disabledNames, _availableTools)
    const cached = this.lruCache.get(cacheKey)
    if (cached) {
      this.lruCache.delete(cacheKey)
      this.lruCache.set(cacheKey, cached)
      return cached
    }

    // 检查磁盘快照
    const snapshot = this.loadSnapshot()
    if (snapshot && this.validateSnapshot(snapshot)) {
      const result = this.buildFromSnapshot(snapshot, disabledNames)
      this.lruCache.set(cacheKey, result)
      return result
    }

    // 冷启动：完整扫描
    const result = this.scanAndBuild(disabledNames)
    this.saveSnapshot(result.snapshotData)
    this.lruCache.set(cacheKey, result.block)

    // LRU 淘汰
    if (this.lruCache.size > this.MAX_LRU_ENTRIES) {
      const firstKey = this.lruCache.keys().next().value
      if (firstKey) {
        this.lruCache.delete(firstKey)
      }
    }

    return result.block
  }

  /**
   * 生成缓存键
   */
  private makeCacheKey(
    disabledNames: Set<string>,
    availableTools?: Set<string>,
  ): string {
    const parts = [
      this.skillManager['skillsDir'],
      process.platform,
      [...disabledNames].sort().join(','),
      availableTools ? [...availableTools].sort().join(',') : '*',
    ]
    return parts.join('|')
  }

  /**
   * 从快照构建
   */
  private buildFromSnapshot(
    snapshot: SnapshotData,
    disabledNames: Set<string>,
  ): string {
    const skills = snapshot.skills.filter(s => !disabledNames.has(s.skill_name))
    return this.formatSkillsIndex(skills)
  }

  /**
   * 扫描文件系统并构建
   */
  private scanAndBuild(
    disabledNames: Set<string>,
  ): { block: string; snapshotData: SnapshotData } {
    const skills = this.skillManager.listSkills()
    const filtered = skills.filter(s => !disabledNames.has(s.name))

    const block = this.formatSkillsIndex(filtered)

    // 构建快照数据
    const snapshotData: SnapshotData = {
      version: 1,
      skills: filtered.map(s => ({
        skill_name: s.name,
        category: s.category,
        frontmatter_name: s.name,
        description: s.description,
        platforms: [],
      })),
      manifest: this.buildManifest(),
    }

    return { block, snapshotData }
  }

  /**
   * 格式化 skill 索引
   */
  private formatSkillsIndex(skills: Array<{ name?: string; description?: string; category?: string | null; skill_name?: string }>): string {
    if (skills.length === 0) return ''

    // 按分类分组
    const grouped = new Map<string | null, typeof skills>()
    for (const skill of skills) {
      const cat = skill.category ?? null
      if (!grouped.has(cat)) grouped.set(cat, [])
      grouped.get(cat)!.push(skill)
    }

    let result = '## Skills (mandatory)\n'
    result += 'Before replying, scan the skills below. If a skill matches or is even partially relevant\n'
    result += 'to your task, you MUST load it with skill_view(name) and follow its instructions.\n'
    result += 'Skills contain specialized knowledge — API endpoints, tool-specific commands,\n'
    result += 'and proven workflows that outperform general-purpose approaches.\n\n'
    result += '<available_skills>\n'

    for (const [category, catSkills] of grouped) {
      const catLabel = category || 'general'
      result += `  ${catLabel}:\n`
      for (const skill of catSkills) {
        const name = skill.name ?? skill.skill_name ?? ''
        const desc = skill.description ?? ''
        result += `    - ${name}: ${desc}\n`
      }
    }

    result += '</available_skills>\n\n'
    result += 'Only proceed without loading a skill if genuinely none are relevant to the task.'

    return result
  }

  /**
   * 构建文件 manifest（用于快照验证）
   */
  private buildManifest(): SnapshotData['manifest'] {
    const files: Record<string, { mtime: number; size: number }> = {}
    const skillsDir = this.skillManager['skillsDir']

    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const catDir = path.join(skillsDir, entry.name)
        const catEntries = fs.readdirSync(catDir, { withFileTypes: true })
        for (const catEntry of catEntries) {
          if (!catEntry.isDirectory() || catEntry.name.startsWith('.')) continue
          const skillMdPath = path.join(catDir, catEntry.name, 'SKILL.md')
          if (fs.existsSync(skillMdPath)) {
            const stat = fs.statSync(skillMdPath)
            files[skillMdPath] = { mtime: stat.mtimeMs, size: stat.size }
          }
        }
      }
    }

    const snapshotStat = fs.existsSync(this.snapshotPath)
      ? fs.statSync(this.snapshotPath)
      : null

    return {
      mtime: snapshotStat?.mtimeMs ?? Date.now(),
      size: snapshotStat?.size ?? 0,
      files,
    }
  }

  /**
   * 验证快照是否有效（检查 mtime 和文件大小）
   */
  private validateSnapshot(snapshot: SnapshotData): boolean {
    for (const [filePath, info] of Object.entries(snapshot.manifest.files)) {
      if (!fs.existsSync(filePath)) return false
      const stat = fs.statSync(filePath)
      if (stat.mtimeMs !== info.mtime || stat.size !== info.size) return false
    }
    return true
  }

  /**
   * 加载磁盘快照
   */
  private loadSnapshot(): SnapshotData | null {
    try {
      if (!fs.existsSync(this.snapshotPath)) return null
      const content = fs.readFileSync(this.snapshotPath, 'utf-8')
      return JSON.parse(content) as SnapshotData
    } catch {
      return null
    }
  }

  /**
   * 保存磁盘快照
   */
  private saveSnapshot(data: SnapshotData): void {
    try {
      const dir = path.dirname(this.snapshotPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.snapshotPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      // 快照保存失败不影响主流程
      console.warn(`[SkillPromptInjector] 保存快照失败: ${error}`)
    }
  }

  /**
   * 清除缓存
   */
  invalidateCache(): void {
    this.lruCache.clear()
    this.skillManager.invalidateCache()
  }
}
