/**
 * 配置管理 IPC 处理器
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../core/constants/ipc-channels'
import { DatabaseService } from '../../services/database.service'
import { LLMClient } from '../../agent/llm-client'
import { AgentConfig } from '../../../core/types/agent'
import { invalidateConfigCache } from '../../services/agent-service'
import { logger } from '../../utils/logger'
import { resolveContextLength } from '../../agent/model-metadata'

/** 100x100 像素红色 PNG，用于视觉能力测试（宽高需 > 10） */
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAABFUlEQVR4nO3OUQkAIABEsetfWiv4Nx4IC7Cd7XvkByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIX4Q4gchfhDiByF+EOIHIReeLesrH9s1agAAAABJRU5ErkJggg=='

/**
 * 通过 API 端点探测模型的最大上下文窗口
 *
 * 策略：
 * 1. 先尝试 GET /v1/models/{model} 获取元数据（OpenAI 兼容 API）
 * 2. 如果 API 返回失败或无 context_length，回退到本地已知模型映射
 *
 * @param provider API 提供商
 * @param apiUrl API 基础地址
 * @param apiKey API 密钥
 * @param model 模型名称
 * @returns 最大上下文窗口 token 数，未知时返回 0
 */
async function detectContextLength(
  provider: string,
  apiUrl: string,
  apiKey: string,
  model: string,
): Promise<number> {
  // 策略 1: 尝试通过 API 端点获取
  if (provider === 'openai') {
    try {
      const base = apiUrl.replace(/\/+$/, '') // 去除末尾斜杠
      const url = `${base}/models/${encodeURIComponent(model)}`
      const resp = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000), // 5 秒超时，不阻塞测试
      })

      if (resp.ok) {
        const data = await resp.json() as Record<string, any>

        // OpenRouter 格式: data.top_provider?.context_length
        const ctx = data?.top_provider?.context_length
          ?? data?.data?.top_provider?.context_length
          // 某些 API 直接在根对象上有 context_length
          ?? data?.context_length
          ?? data?.data?.context_length
          // OpenAI 兼容 API 可能返回 max_tokens
          ?? data?.max_tokens
          ?? data?.data?.max_tokens

        if (ctx && typeof ctx === 'number' && ctx > 0) {
          logger.info(`[ConfigHandler] API 探测到上下文窗口: ${ctx} (model=${model})`)
          return ctx
        }
      }
    } catch (e) {
      logger.debug(`[ConfigHandler] API 端点探测失败: ${e}`)
    }
  }

  // 策略 2: 回退到本地已知模型映射 + 缓存
  const fallback = resolveContextLength(model)
  logger.info(`[ConfigHandler] 使用本地映射的上下文窗口: ${fallback} (model=${model})`)
  return fallback
}

export function registerConfigHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, (_, key: string, value: any) => {
    DatabaseService.getInstance().getConfigDAO().save(key, value)
    // 配置修改后使缓存失效，下次 loadAgentConfig 从数据库重新读取
    invalidateConfigCache()
    logger.info(`[ConfigHandler] 配置 ${key} 已保存，缓存已失效`)
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, (_, key: string) => {
    return DatabaseService.getInstance().getConfigDAO().get(key)
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_GET_ALL, () => {
    return DatabaseService.getInstance().getConfigDAO().getAll()
  })

  ipcMain.handle(IPC_CHANNELS.CONFIG_DELETE, (_, key: string) => {
    DatabaseService.getInstance().getConfigDAO().delete(key)
    invalidateConfigCache()
    return { success: true }
  })

  // 测试模型连接：分别测试 invoke 和 stream 两种模式，并探测最大上下文窗口
  ipcMain.handle(IPC_CHANNELS.CONFIG_TEST_MODEL, async (_, config: {
    provider: string
    apiUrl: string
    apiKey: string
    model: string
  }) => {
    try {
      const agentConfig: AgentConfig = {
        provider: config.provider as 'openai' | 'anthropic',
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        model: config.model,
        maxIterations: 1,
        timeout: 30000,
        maxRetries: 1,
      }

      const llm = new LLMClient(agentConfig)

      // 测试 invoke
      let supportsInvoke = false
      try {
        const result = await llm.chat([
          { role: 'user', content: 'Hi', timestamp: Date.now() },
        ])
        supportsInvoke = !!result.content
      } catch (e) {
        logger.warn('[ConfigHandler] invoke 测试失败:', e)
      }

      // 测试 stream
      let supportsStream = false
      let streamContent = ''
      try {
        await llm.streamChat(
          [{ role: 'user', content: 'Hi', timestamp: Date.now() }],
          {
            onChunk: (text) => { streamContent += text },
            onDone: () => {},
            onError: () => {},
          },
        )
        supportsStream = streamContent.length > 0
      } catch (e) {
        logger.warn('[ConfigHandler] stream 测试失败:', e)
      }

      // 测试视觉能力（发送包含测试图片的多模态消息）
      // 使用 streamChat 而非 chat，因为某些 provider（如 Anthropic）对大 max_tokens
      // 请求要求必须使用 streaming，否则会报 "Streaming is required" 错误
      let supportsVision = false
      try {
        let visionContent = ''
        await llm.streamChat(
          [
            {
              role: 'user',
              content: [
                { type: 'text' as const, text: '请描述这张图片' },
                {
                  type: 'image' as const,
                  image: {
                    data: TEST_IMAGE_BASE64,
                    mimeType: 'image/png',
                  },
                },
              ],
              timestamp: Date.now(),
            },
          ],
          {
            onChunk: (text) => { visionContent += text },
            onDone: () => {},
            onError: () => {},
          },
        )
        supportsVision = visionContent.length > 0
      } catch (e) {
        logger.debug('[ConfigHandler] 视觉能力测试失败:', e)
      }

      if (!supportsInvoke && !supportsStream) {
        return {
          success: false,
          supportsInvoke: false,
          supportsStream: false,
          error: 'invoke 和 stream 均失败，请检查 API Key 和网络',
        }
      }

      // 探测最大上下文窗口（API 端点 → 本地映射 → 默认值）
      const contextLength = await detectContextLength(
        config.provider,
        config.apiUrl,
        config.apiKey,
        config.model,
      )

      return {
        success: true,
        supportsInvoke,
        supportsStream,
        supportsVision,
        contextLength,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('[ConfigHandler] 模型测试失败:', message)
      return {
        success: false,
        supportsInvoke: false,
        supportsStream: false,
        supportsVision: false,
        error: message,
      }
    }
  })
}
