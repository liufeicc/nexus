/**
 * Skill 系统常量配置
 *
 * 定义 Skill 目录路径、文件大小限制、名称验证正则等。
 */
import os from 'node:os'
import path from 'node:path'

/** Skill 根目录：~/.Nexus/skills/ */
export const SKILLS_DIR = path.join(os.homedir(), '.Nexus', 'skills')

/** Skill 名称验证正则 */
export const SKILL_NAME_REGEX = /^[a-z0-9][a-z0-9._-]*$/

/** Skill 名称最大长度 */
export const MAX_SKILL_NAME_LENGTH = 64

/** Skill 描述最大长度 */
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024

/** SKILL.md 文件最大字符数 */
export const MAX_SKILL_MD_SIZE = 100_000

/** 支持文件最大字节数 (1MB) */
export const MAX_SUPPORT_FILE_SIZE = 1_048_576

/** 允许的子目录 */
export const ALLOWED_SKILL_SUBDIRS = ['references', 'templates', 'assets', 'scripts']

/** 磁盘快照文件名 */
export const SKILLS_SNAPSHOT_FILE = '.skills_prompt_snapshot.json'

/** 平台映射 */
export const PLATFORM_MAP: Record<string, string> = {
  macos: 'darwin',
  linux: 'linux',
  windows: 'win32',
}
