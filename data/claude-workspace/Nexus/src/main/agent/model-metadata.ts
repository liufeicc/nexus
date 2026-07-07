/**
 * 模型元数据管理器
 *
 * 作用：
 * 1. 解析模型的上下文窗口大小（已知模型 → 缓存 → 默认值）
 * 2. 持久化缓存用户手动配置的模型元数据
 *
 * V1 不实现主动探测
 * （探测成本高：需要发超长 prompt 触发错误来推算窗口）。
 *
 * 解析优先级：
 *   1. AgentConfig 手动指定（最高优先级）
 *   2. 已知模型硬编码映射
 *   3. 持久化缓存（~/.tview/model_cache.json）
 *   4. 默认值 128K（并记录警告日志）
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { logger } from '../utils/logger'

// =========================================================================
// 已知模型映射
// =========================================================================

/**
 * 已知模型的最大上下文窗口
 *
 * 来源：各模型官方文档
 * 使用子串匹配（最长前缀优先），支持带日期后缀的模型 ID
 */
const KNOWN_MODELS: Record<string, number> = {
  // Claude 系列
  'claude-opus-4-6':     200_000,
  'claude-sonnet-4-6':   200_000,
  'claude-opus-4-5':     200_000,
  'claude-sonnet-4-5':   200_000,
  'claude-haiku-4-5':    200_000,
  'claude-3-7-sonnet':   200_000,
  'claude-3-5-sonnet':   200_000,
  'claude-3-5-haiku':    200_000,

  // 通义千问系列
  'qwen3.6-plus':        131_072,
  'qwen3-6-plus':        131_072,
  'qwen3.6':             131_072,
  'qwen3-6':             131_072,
  'qwen3':               131_072,
  'qwen-plus':           131_072,
  'qwen-max':            131_072,

  // OpenAI 系列
  'gpt-4o':              128_000,
  'gpt-4-turbo':         128_000,
  'gpt-4':               128_000,
  'gpt-3.5-turbo':       16_385,
  'o1':                  200_000,
  'o1-mini':             128_000,
  'o3':                  200_000,

  // Google 系列
  'gemini-2.5':          1_000_000,
  'gemini-1.5':          1_000_000,
  'gemini-pro':          32_768,
}

const DEFAULT_CONTEXT_LENGTH = 128_000

/** 导出默认上下文窗口长度，供 context-compressor 使用 */
export { DEFAULT_CONTEXT_LENGTH }

// =========================================================================
// 视觉能力检测
// =========================================================================

/**
 * 支持图片识别的模型前缀列表
 *
 * 使用子串匹配：如果模型名称包含以下前缀之一，则认为支持视觉能力。
 */
const VISION_MODEL_PREFIXES = [
  'claude-',       // 所有 Claude 模型均支持视觉
  'gpt-4',         // GPT-4 系列（含 gpt-4o, gpt-4-turbo），不含 gpt-3.5
  'qwen',          // 通义千问支持视觉
  'gemini',        // Gemini 支持视觉
]

/**
 * 判断模型是否支持图片识别（视觉能力）
 *
 * @param model 模型名称
 * @returns true 表示支持图片识别
 */
export function supportsVision(model: string): boolean {
  const norm = model.toLowerCase()
  return VISION_MODEL_PREFIXES.some(prefix => norm.includes(prefix))
}

// =========================================================================
// 持久化缓存
// =========================================================================

/** 缓存条目 */
interface ModelCacheEntry {
  contextLength: number
  source: 'known' | 'manual' | 'default'
  configuredAt: number  // 毫秒时间戳
}

/** 缓存文件结构 */
interface ModelCacheFile {
  models: Record<string, ModelCacheEntry>
}

/**
 * 获取缓存文件路径
 */
function getCachePath(): string {
  const home = process.env.HOME || os.homedir()
  return path.join(home, '.tview', 'model_cache.json')
}

/**
 * 加载持久化缓存
 */
function loadCache(): Map<string, ModelCacheEntry> {
  const cachePath = getCachePath()
  const cache = new Map<string, ModelCacheEntry>()

  try {
    if (!fs.existsSync(cachePath)) return cache

    const raw = fs.readFileSync(cachePath, 'utf-8')
    const data: ModelCacheFile = JSON.parse(raw)

    for (const [model, entry] of Object.entries(data.models || {})) {
      cache.set(model, entry)
    }
  } catch (e) {
    logger.debug(`[ModelMetadata] 加载缓存失败: ${e}`)
  }

  return cache
}

/**
 * 保存缓存到磁盘
 */
function saveCache(cache: Map<string, ModelCacheEntry>): void {
  const cachePath = getCachePath()
  const dir = path.dirname(cachePath)

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const data: ModelCacheFile = {
      models: Object.fromEntries(cache),
    }

    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    logger.warn(`[ModelMetadata] 保存缓存失败: ${e}`)
  }
}

// =========================================================================
// 上下文窗口解析
// =========================================================================

/**
 * 解析模型的上下文窗口大小
 *
 * 解析优先级：
 * 1. configOverride — 用户手动指定（最高优先级）
 * 2. 已知模型映射（子串匹配，最长前缀优先）
 * 3. 持久化缓存
 * 4. 默认值 128K
 *
 * @param model 模型名称
 * @param configOverride 用户手动配置的值（可选）
 * @returns 上下文窗口大小（token 数）
 */
export function resolveContextLength(
  model: string,
  configOverride?: number,
): number {
  // 1. 用户手动指定
  if (configOverride && configOverride > 0) {
    logger.debug(`[ModelMetadata] 使用手动配置的上下文窗口: ${configOverride}`)
    return configOverride
  }

  const modelNorm = model.toLowerCase().replace(/\./g, '-')

  // 2. 已知模型映射（子串匹配）
  let bestKey = ''
  let bestVal = 0
  for (const [key, val] of Object.entries(KNOWN_MODELS)) {
    if (modelNorm.includes(key) && key.length > bestKey.length) {
      bestKey = key
      bestVal = val
    }
  }
  if (bestVal > 0) {
    logger.debug(`[ModelMetadata] 已知模型 ${model} → ${bestVal} (${bestKey})`)
    return bestVal
  }

  // 3. 持久化缓存
  const cache = loadCache()
  // 也尝试子串匹配缓存
  for (const [cachedModel, entry] of cache) {
    if (modelNorm.includes(cachedModel.toLowerCase().replace(/\./g, '-'))) {
      logger.debug(`[ModelMetadata] 缓存命中 ${model} → ${entry.contextLength} (from ${cachedModel})`)
      return entry.contextLength
    }
  }

  // 4. 默认值
  logger.warn(
    `[ModelMetadata] 未知模型 ${model}，使用默认上下文窗口 ${DEFAULT_CONTEXT_LENGTH}。`
    + `如需精确值，请在 AgentConfig 中设置 contextLength 字段。`
  )
  return DEFAULT_CONTEXT_LENGTH
}

