/**
 * Plan 系统常量配置
 *
 * 定义 Plan 目录路径，用于存储智能体生成的执行计划文件。
 */
import os from 'node:os'
import path from 'node:path'
import { getNexusDirName } from '../utils/path-utils'

/** Plan 根目录：开发模式用 ~/.Nexus_dev/plans/，生产模式用 ~/.Nexus/plans/ */
export const PLANS_DIR = path.join(os.homedir(), getNexusDirName(), 'plans')
