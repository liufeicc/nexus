/**
 * Skill 系统提示注入器
 *
 * 职责：构建可用 skill 列表注入系统提示，含双层缓存（内存 LRU + 磁盘快照）。
 */

import { SkillManager } from './skill-manager'
import { SkillSnapshotCache, SnapshotData } from './skill-snapshot-cache'

/** 统一的 skill 索引条目 */
interface SkillIndexEntry {
  name: string
  description: string
  category: string | null
}

/**
 * Skill 提示注入器
 */
export class SkillPromptInjector {
  private skillManager: SkillManager
  private snapshotCache: SkillSnapshotCache
  private lruCache: Map<string, string> = new Map()
  private readonly MAX_LRU_ENTRIES = 8

  constructor(skillManager: SkillManager, snapshotPath?: string) {
    this.skillManager = skillManager
    this.snapshotCache = new SkillSnapshotCache(skillManager.skillsDir, snapshotPath)
  }

  /**
   * 构建 skill 索引 block
   */
  buildBlock(disabledNames: Set<string> = new Set()): string {
    const cacheKey = this.makeCacheKey(disabledNames)
    const cached = this.lruCache.get(cacheKey)
    if (cached) {
      this.lruCache.delete(cacheKey)
      this.lruCache.set(cacheKey, cached)
      return cached
    }

    // 检查磁盘快照
    const snapshot = this.snapshotCache.load()
    if (snapshot && this.snapshotCache.validate(snapshot)) {
      const result = this.buildFromSnapshot(snapshot, disabledNames)
      this.lruCache.set(cacheKey, result)
      return result
    }

    // 冷启动：完整扫描
    const result = this.scanAndBuild(disabledNames)
    this.snapshotCache.save(result.snapshotData)
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
  private makeCacheKey(disabledNames: Set<string>): string {
    const parts = [
      this.skillManager.skillsDir,
      process.platform,
      [...disabledNames].sort().join(','),
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
    const skills: SkillIndexEntry[] = snapshot.skills
      .filter(s => !disabledNames.has(s.skill_name))
      .map(s => ({
        name: s.skill_name,
        description: s.description,
        category: s.category,
      }))
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
    const skillMdPaths = this.skillManager.discoverSkillFiles().map(f => f.skillMdPath)
    const snapshotData: SnapshotData = {
      version: 1,
      skills: filtered.map(s => ({
        skill_name: s.name,
        category: s.category,
        frontmatter_name: s.name,
        description: s.description,
        platforms: [],
      })),
      manifest: this.snapshotCache.buildManifest(skillMdPaths),
    }

    return { block, snapshotData }
  }

  /**
   * 格式化 skill 索引
   */
  private formatSkillsIndex(skills: SkillIndexEntry[]): string {
    if (skills.length === 0) return ''

    // 按分类分组
    const grouped = new Map<string | null, SkillIndexEntry[]>()
    for (const skill of skills) {
      const cat = skill.category ?? null
      if (!grouped.has(cat)) grouped.set(cat, [])
      grouped.get(cat)!.push(skill)
    }

    let result = '## 技能（必须使用）\n'
    result += '在回复之前，先扫描以下技能。如果某个技能与你的任务相关或即使只是部分相关，\n'
    result += '你必须使用 skill_view(name) 加载它并遵循其指令。\n'
    result += '技能包含专业知识 — API 端点、特定工具命令、\n'
    result += '以及优于通用方法的已验证工作流。\n\n'
    result += '<可用技能>\n'

    for (const [category, catSkills] of grouped) {
      const catLabel = category || 'general'
      result += `  ${catLabel}:\n`
      for (const skill of catSkills) {
        result += `    - ${skill.name}: ${skill.description}\n`
      }
    }

    result += '</可用技能>\n\n'
    result += '仅在确实没有任何技能与任务相关时，才不加载技能继续。'

    return result
  }

  /**
   * 清除缓存
   */
  invalidateCache(): void {
    this.lruCache.clear()
    this.skillManager.invalidateCache()
  }
}
