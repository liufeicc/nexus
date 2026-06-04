/**
 * 模型目录类型定义
 *
 * 定义模型目录条目的结构，包含模型基本信息和能力标识。
 */

/** API 接口协议类型 -- 决定调用时使用 OpenAI SDK 还是 Anthropic SDK */
export type ModelInterfaceType = 'openai' | 'anthropic'

/** 模型目录条目 */
export interface ModelCatalogEntry {
  /** 唯一标识（数字ID） */
  id: number
  /** 显示名称（用于 UI 展示） */
  displayName: string
  /** 模型名称（API 请求中的 model 参数值） */
  modelName: string
  /** 运营方/提供商 */
  provider: string
  /** 接口协议类型 -- 决定调用时使用哪个 SDK */
  interfaceType: ModelInterfaceType
  /** 默认 API 地址 */
  defaultApiUrl: string
  /** 上下文窗口大小（token） */
  contextLength: number
  /** 简要描述 */
  description?: string
  /** 排序权重（越小越靠前） */
  sortWeight: number
}
