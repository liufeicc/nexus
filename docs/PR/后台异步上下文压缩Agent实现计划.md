# 后台异步上下文压缩 Agent 实现计划

## Context

当前 AIAgent 的对话历史全部存在内存中（`this.messages`），现有的 `compressMessages()` 在主循环中同步执行，会阻塞用户交互。需要一个独立的后台异步 Agent 模块，使用副模型自动压缩过长的对话历史，压缩结果写回 DB，下次 `run()` 时自动读取压缩后的数据。

## 核心流程

```
用户发消息 → run() → runAgentLoop()
                    |
                    | checkAndCompress() 同步压缩（现有逻辑，不改）
                    |
                    | 如果压缩后仍 >= 70% 窗口
                    ▼
         _signalBackgroundCompressionIfNeeded()
                    |
                    | compressor.requestCompression(topicId)
                    ▼
        BackgroundCompressor._monitorTick() (5s 轮询)
                    |
                    | 1. 从 DB 读取完整 topic 历史
                    | 2. 调用 compressMessages()（副模型）
                    | 3. replaceTopicMessages() 写回 DB（替换）
                    | 4. agent.setNeedsReload(true)
                    ▼
      下次用户提问 → run() 检测到 needsReload
                    |
                    | 清空内存 messages[], 从 DB 重新加载
                    ▼
                    正常流程继续（此时上下文已大幅缩小）
```

## 文件修改清单

### 1. 新建: `src/main/agent/background-compressor.ts`

核心类 `BackgroundCompressor`：

| 属性 | 说明 |
|------|------|
| `pollIntervalMs` | 轮询间隔，默认 5000ms |
| `compressing` | 防重入标志 |
| `pendingTopicId` | 待压缩的 topic |

| 方法 | 说明 |
|------|------|
| `requestCompression(topicId)` | 主 Agent 调用，标记需要压缩 |
| `setReloadCallback(cb)` | 注册回调，压缩完成后调用 `agent.setNeedsReload(true)` |
| `start()` / `stop()` | 启动/停止轮询 |
| `_monitorTick()` | 私有轮询方法，检查 `pendingTopicId` 并执行压缩 |
| `_runCompression(topicId)` | 核心压缩逻辑：读 DB → 压缩 → 写 DB → 通知主 Agent |

关键设计：
- `_runCompression` 中从 DB 完整读取 topic 历史
- 复用 `compressMessages()` 和 `estimateMessageTokens()`（不重复造轮子）
- 复用 `AuxiliaryClient`（副模型，已有实现，`summaryModel` 配置）
- 压缩无效果时（`tokensAfter >= tokensBefore`）跳过 DB 写

### 2. 修改: `src/main/db/agent-message.dao.ts`

新增 3 个方法：

```typescript
replaceTopicMessages(topicId, nexusSessionId, messages): void
```
- 事务操作：DELETE 全部旧消息 → INSERT 压缩后的新消息
- `turn_index` 按顺序重新分配

```typescript
getTopicSessionId(topicId): string | null
```
- 查询 topic 对应的 `nexus_session_id`

### 3. 修改: `src/main/agent/ai-agent.ts`

新增成员：
- `needsReload: boolean = false`
- `_backgroundCompressor: BackgroundCompressor | null = null`

新增方法：
- `setNeedsReload(value: boolean)` — 后台压缩完成后调用
- `setBackgroundCompressor(compressor)` — 注册后台压缩器

新增私有方法：
- `_signalBackgroundCompressionIfNeeded()` — 在 `run()` 末尾调用，检查 `lastPromptTokens >= 70%` 时请求后台压缩

修改 `run()` 方法：
- 开头检查 `needsReload`：如果为 true，清空 `messages`、`previousSummary`，重新从 DB 加载

### 4. 修改: `src/main/services/agent-service.ts`

在 `createAgentSession()` 中：
1. 创建 `BackgroundCompressor` 实例
2. 注册回调 `compressor.setReloadCallback(() => agent.setNeedsReload(true))`
3. 注册到 agent `agent.setBackgroundCompressor(compressor)`
4. 启动 `compressor.start()`

在 `resetAIAgent()` 中：
- 停止并清理 `BackgroundCompressor`

## 不修改的文件

- `src/main/agent/agent-loop.ts` — 现有 `checkAndCompress()` 保持不变
- `src/main/agent/context-compressor.ts` — 复用 `compressMessages()`
- `src/main/agent/auxiliary-client.ts` — 复用 `AuxiliaryClient`
- `src/core/types/agent.ts` — `summaryModel` 和 `contextLength` 字段已够用

## 70% 阈值检测

检测位置：`agent-loop.ts` 中的 `checkAndCompress()`（第 354 行）已经实现了 `tokenCount >= contextLength * 0.70` 的检测。

新增的 `_signalBackgroundCompressionIfNeeded()` 使用同样的 70% 判断，但作用是**标记后台压缩**，不是做同步压缩。两者互补：
- 同步压缩：立即释放上下文，保证本次调用不 OOM
- 后台压缩：彻底压缩 DB 中的原始数据，下次 `run()` 时加载压缩版

## 验证方案

1. 启动开发模式 `npm run dev`
2. 进行多轮对话，使上下文逐渐增长
3. 观察日志：
   - `checkAndCompress` 触发同步压缩
   - `_signalBackgroundCompressionIfNeeded` 请求后台压缩
   - `BackgroundCompressor` 执行 `_runCompression`
   - DB 写入压缩数据
   - `needsReload` 被设置
4. 下一次发送消息，观察主 Agent 从 DB 重新加载压缩后的历史
5. 验证对话上下文正常，没有丢失关键信息
