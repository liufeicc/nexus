/**
 * 模型目录数据
 *
 * 定义所有支持的模型条目，包含上下文窗口、能力、默认 API URL 等元数据。
 * 选择模型时自动填充 provider、interfaceType 和 defaultApiUrl。
 *
 * 排序规则（按 sortWeight）：
 *   1-4: DeepSeek 系列
 *  10+: Claude 系列
 *  20+: GPT/o 系列
 *  30+: Qwen 系列
 *  40+: Gemini 系列
 *  50+: GLM 系列
 *  60+: 其他
 */

import type { ModelCatalogEntry } from '../types/model-catalog'

/** 模型目录条目（id 为数字） */
interface ModelEntry extends Omit<ModelCatalogEntry, 'id'> {
  id: number
}

export const MODEL_CATALOG: ModelEntry[] = [
  // =========================================================================
  // DeepSeek 系列 (OpenAI 兼容接口)
  // =========================================================================
  {
    id: 42,
    displayName: 'DeepSeek V4 Pro',
    modelName: 'deepseek-v4-pro',
    provider: 'deepseek',
    interfaceType: 'openai',
    defaultApiUrl: 'https://api.deepseek.com/v1',
    contextLength: 1_000_000,
    sortWeight: 1,
  },
  {
    id: 43,
    displayName: 'DeepSeek V4 Flash',
    modelName: 'deepseek-v4-flash',
    provider: 'deepseek',
    interfaceType: 'openai',
    defaultApiUrl: 'https://api.deepseek.com/v1',
    contextLength: 1_000_000,
    sortWeight: 2,
  },
  {
    id: 40,
    displayName: 'DeepSeek Chat',
    modelName: 'deepseek-chat',
    provider: 'deepseek',
    interfaceType: 'openai',
    defaultApiUrl: 'https://api.deepseek.com/v1',
    contextLength: 128_000,
    sortWeight: 3,
  },
  {
    id: 41,
    displayName: 'DeepSeek Reasoner',
    modelName: 'deepseek-reasoner',
    provider: 'deepseek',
    interfaceType: 'openai',
    defaultApiUrl: 'https://api.deepseek.com/v1',
    contextLength: 128_000,
    sortWeight: 4,
  },

  // =========================================================================
  // Claude 系列 (Anthropic 接口)
  // =========================================================================
  {
    id: 1,
    displayName: 'Claude Opus 4.6',
    modelName: 'claude-opus-4-6',
    provider: 'anthropic',
    interfaceType: 'anthropic',
    defaultApiUrl: 'https://api.anthropic.com',
    contextLength: 200_000,
    sortWeight: 10,
  },
  {
    id: 2,
    displayName: 'Claude Sonnet 4.6',
    modelName: 'claude-sonnet-4-6',
    provider: 'anthropic',
    interfaceType: 'anthropic',
    defaultApiUrl: 'https://api.anthropic.com',
    contextLength: 200_000,
    sortWeight: 11,
  },
  {
    id: 3,
    displayName: 'Claude Opus 4.5',
    modelName: 'claude-opus-4-5',
    provider: 'anthropic',
    interfaceType: 'anthropic',
    defaultApiUrl: 'https://api.anthropic.com',
    contextLength: 200_000,
    sortWeight: 12,
  },
  {
    id: 4,
    displayName: 'Claude Sonnet 4.5',
    modelName: 'claude-sonnet-4-5',
    provider: 'anthropic',
    interfaceType: 'anthropic',
    defaultApiUrl: 'https://api.anthropic.com',
    contextLength: 200_000,
    sortWeight: 13,
  },
  {
    id: 5,
    displayName: 'Claude Haiku 4.5',
    modelName: 'claude-haiku-4-5',
    provider: 'anthropic',
    interfaceType: 'anthropic',
    defaultApiUrl: 'https://api.anthropic.com',
    contextLength: 200_000,
    sortWeight: 14,
  },
  {
    id: 6,
    displayName: 'Claude 3.7 Sonnet',
    modelName: 'claude-3-7-sonnet',
    provider: 'anthropic',
    interfaceType: 'anthropic',
    defaultApiUrl: 'https://api.anthropic.com',
    contextLength: 200_000,
    sortWeight: 15,
  },

  // =========================================================================
  // GPT/o 系列 (OpenAI 接口)
  // =========================================================================
  {
    id: 10,
    displayName: 'GPT-4o',
    modelName: 'gpt-4o',
    provider: 'openai',
    interfaceType: 'openai',
    defaultApiUrl: 'https://api.openai.com/v1',
    contextLength: 128_000,
    sortWeight: 20,
  },
  {
    id: 11,
    displayName: 'GPT-4o mini',
    modelName: 'gpt-4o-mini',
    provider: 'openai',
    interfaceType: 'openai',
    defaultApiUrl: 'https://api.openai.com/v1',
    contextLength: 128_000,
    sortWeight: 21,
  },
  {
    id: 12,
    displayName: 'o1',
    modelName: 'o1',
    provider: 'openai',
    interfaceType: 'openai',
    defaultApiUrl: 'https://api.openai.com/v1',
    contextLength: 200_000,
    sortWeight: 22,
  },
  {
    id: 13,
    displayName: 'o3',
    modelName: 'o3',
    provider: 'openai',
    interfaceType: 'openai',
    defaultApiUrl: 'https://api.openai.com/v1',
    contextLength: 200_000,
    sortWeight: 23,
  },

  // =========================================================================
  // Qwen 系列 (OpenAI 兼容接口)
  // =========================================================================
  {
    id: 20,
    displayName: 'Qwen 3.6 Plus',
    modelName: 'qwen3.6-plus',
    provider: 'alibaba',
    interfaceType: 'openai',
    defaultApiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    contextLength: 131_072,
    sortWeight: 30,
  },
  {
    id: 21,
    displayName: 'Qwen 3.6',
    modelName: 'qwen3.6',
    provider: 'alibaba',
    interfaceType: 'openai',
    defaultApiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    contextLength: 131_072,
    sortWeight: 31,
  },
  {
    id: 22,
    displayName: 'Qwen 3 Coder',
    modelName: 'qwen3-coder',
    provider: 'alibaba',
    interfaceType: 'openai',
    defaultApiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    contextLength: 131_072,
    sortWeight: 32,
  },
  {
    id: 23,
    displayName: 'Qwen Max',
    modelName: 'qwen-max',
    provider: 'alibaba',
    interfaceType: 'openai',
    defaultApiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    contextLength: 131_072,
    sortWeight: 33,
  },

  // =========================================================================
  // Gemini 系列 (OpenAI 兼容接口)
  // =========================================================================
  {
    id: 30,
    displayName: 'Gemini 2.5 Pro',
    modelName: 'gemini-2.5-pro',
    provider: 'google',
    interfaceType: 'openai',
    defaultApiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    contextLength: 1_000_000,
    sortWeight: 40,
  },
  {
    id: 31,
    displayName: 'Gemini 2.5 Flash',
    modelName: 'gemini-2.5-flash',
    provider: 'google',
    interfaceType: 'openai',
    defaultApiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    contextLength: 1_000_000,
    sortWeight: 41,
  },
  {
    id: 32,
    displayName: 'Gemini 2.5 Flash Lite',
    modelName: 'gemini-2.5-flash-lite',
    provider: 'google',
    interfaceType: 'openai',
    defaultApiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    contextLength: 1_000_000,
    sortWeight: 42,
  },

  // =========================================================================
  // 智谱 GLM 系列 (OpenAI 兼容接口)
  // =========================================================================
  {
    id: 50,
    displayName: 'GLM-4 Plus',
    modelName: 'glm-4-plus',
    provider: 'zhipu',
    interfaceType: 'openai',
    defaultApiUrl: 'https://open.bigmodel.cn/api/paas/v4',
    contextLength: 128_000,
    sortWeight: 50,
  },
  {
    id: 51,
    displayName: 'GLM-4',
    modelName: 'glm-4',
    provider: 'zhipu',
    interfaceType: 'openai',
    defaultApiUrl: 'https://open.bigmodel.cn/api/paas/v4',
    contextLength: 128_000,
    sortWeight: 51,
  },

  // =========================================================================
  // 其他模型 (OpenAI 兼容接口)
  // =========================================================================
  {
    id: 60,
    displayName: 'Mistral Large',
    modelName: 'mistral-large-latest',
    provider: 'mistral',
    interfaceType: 'openai',
    defaultApiUrl: 'https://api.mistral.ai/v1',
    contextLength: 128_000,
    sortWeight: 60,
  },
  {
    id: 70,
    displayName: 'MiniMax M2',
    modelName: 'minimax-m2',
    provider: 'minimax',
    interfaceType: 'openai',
    defaultApiUrl: 'https://api.minimax.chat/v1',
    contextLength: 245_000,
    sortWeight: 70,
  },
  {
    id: 80,
    displayName: 'Yi Large',
    modelName: 'yi-large',
    provider: 'yi',
    interfaceType: 'openai',
    defaultApiUrl: 'https://api.lingyiwanwu.com/v1',
    contextLength: 16_000,
    sortWeight: 80,
  },
  {
    id: 90,
    displayName: 'Kimi Moonshot v1 128K',
    modelName: 'moonshot-v1-128k',
    provider: 'moonshot',
    interfaceType: 'openai',
    defaultApiUrl: 'https://api.moonshot.cn/v1',
    contextLength: 128_000,
    sortWeight: 90,
  },
  {
    id: 100,
    displayName: 'Doubao 1.5 Pro 256K',
    modelName: 'doubao-1-5-pro-256k',
    provider: 'doubao',
    interfaceType: 'openai',
    defaultApiUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    contextLength: 256_000,
    sortWeight: 100,
  },
]

// =========================================================================
// 辅助函数
// =========================================================================

/** 根据模型 ID 查找条目 */
export function findModelById(id: number): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find(m => m.id === id)
}

/** 根据提供商过滤模型 */
export function getModelsByProvider(provider: string): ModelEntry[] {
  return MODEL_CATALOG.filter(m => m.provider === provider)
}

/** 解析模型的上下文窗口 */
export function resolveContextLengthFromCatalog(id: number): number | undefined {
  const entry = findModelById(id)
  return entry?.contextLength
}
