/**
 * Task 系统常量配置
 *
 * 定义 Task 目录路径、文件大小限制、名称验证正则等。
 */
import os from 'node:os'
import path from 'node:path'
import { getNexusDirName } from '../utils/path-utils'

/** Task 根目录：开发模式用 ~/.Nexus_dev/tasks/，生产模式用 ~/.Nexus/tasks/ */
export const TASKS_DIR = path.join(os.homedir(), getNexusDirName(), 'tasks')

/** Task 名称验证正则 */
export const TASK_NAME_REGEX = /^[a-z0-9][a-z0-9._-]*$/

/** Task 名称最大长度 */
export const MAX_TASK_NAME_LENGTH = 64

/** Task 描述最大长度（预览截断） */
export const MAX_TASK_DESCRIPTION_LENGTH = 2048

/** Task .md 文件最大字符数 */
export const MAX_TASK_MD_SIZE = 50_000
