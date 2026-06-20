/**
 * Skill 快照缓存模块
 *
 * 职责：磁盘快照的序列化、反序列化、验证和构建。
 * 为 SkillPromptInjector 提供快照级别的缓存能力。
 */

import fs from 'node:fs'
import path from 'node:path'

/** 磁盘快照数据 */
export interface SnapshotData {
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
 * Skill 快照缓存
 */
export class SkillSnapshotCache {
  private snapshotPath: string
  private skillsDir: string

  constructor(
    skillsDir: string,
    snapshotPath?: string,
  ) {
    this.skillsDir = skillsDir
    this.snapshotPath = snapshotPath || path.join(skillsDir, '.skills_prompt_snapshot.json')
  }

  /**
   * 加载磁盘快照
   */
  load(): SnapshotData | null {
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
  save(data: SnapshotData): void {
    try {
      const dir = path.dirname(this.snapshotPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.snapshotPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      console.warn(`[SkillSnapshotCache] 保存快照失败: ${error}`)
    }
  }

  /**
   * 验证快照是否有效（检查 mtime 和文件大小）
   *
   * mtime 使用 100ms 容差比较，避免不同文件系统精度差异导致误判。
   */
  validate(snapshot: SnapshotData): boolean {
    for (const [filePath, info] of Object.entries(snapshot.manifest.files)) {
      if (!fs.existsSync(filePath)) return false
      const stat = fs.statSync(filePath)
      if (Math.abs(stat.mtimeMs - info.mtime) > 100) return false
      if (stat.size !== info.size) return false
    }
    return true
  }

  /**
   * 构建文件 manifest（用于快照验证）
   *
   * 可选传入 skill 文件路径列表，避免重复扫描目录。
   */
  buildManifest(skillMdPaths?: string[]): SnapshotData['manifest'] {
    const files: Record<string, { mtime: number; size: number }> = {}

    const skillFiles = skillMdPaths ?? this.scanSkillFiles()

    for (const skillMdPath of skillFiles) {
      if (!fs.existsSync(skillMdPath)) continue

      // 验证路径在 skills 目录下（防符号链接逃逸）
      const realPath = fs.realpathSync(skillMdPath)
      const realSkillsDir = fs.realpathSync(this.skillsDir)
      if (!realPath.startsWith(realSkillsDir + path.sep) && realPath !== realSkillsDir) continue

      const stat = fs.statSync(skillMdPath)
      files[skillMdPath] = { mtime: Math.round(stat.mtimeMs), size: stat.size }
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
   * 扫描 skills 目录获取所有 SKILL.md 路径
   */
  private scanSkillFiles(): string[] {
    const results: string[] = []

    if (!fs.existsSync(this.skillsDir)) return results

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const catDir = path.join(this.skillsDir, entry.name)

      // 跳过符号链接目录
      try {
        const catLstat = fs.lstatSync(catDir)
        if (catLstat.isSymbolicLink()) continue
      } catch { continue }

      const catEntries = fs.readdirSync(catDir, { withFileTypes: true })
      for (const catEntry of catEntries) {
        if (!catEntry.isDirectory() || catEntry.name.startsWith('.')) continue
        const skillDir = path.join(catDir, catEntry.name)

        // 跳过符号链接目录
        try {
          const skillLstat = fs.lstatSync(skillDir)
          if (skillLstat.isSymbolicLink()) continue
        } catch { continue }

        const skillMdPath = path.join(skillDir, 'SKILL.md')
        if (fs.existsSync(skillMdPath)) {
          results.push(skillMdPath)
        }
      }
    }

    return results
  }
}
