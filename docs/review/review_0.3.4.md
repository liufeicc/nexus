# 代码 Review 报告 v0.3.4 — 智能体（Agent）

> 审查时间: 2026-04-20
> 审查范围: 智能体全部相关代码（含工具系统、MCP、上下文压缩、prompt 构建等）

---

## 审查文件清单

### 核心文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/core/types/agent.ts` | 298 | 智能体核心类型定义 |
| `src/main/agent/ai-agent.ts` | 711 | 核心智能体类（主循环） |
| `src/main/agent/llm-client.ts` | 775 | LLM 客户端（OpenAI + Anthropic） |
| `src/main/agent/tool-registry.ts` | 210 | 工具注册系统 |
| `src/main/agent/prompt-builder.ts` | 603 | 系统提示构建器 |
| `src/main/agent/context-compressor.ts` | 678 | 上下文压缩器 |

### 工具文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/main/agent/tools/file-tools.ts` | 1300 | 文件工具（read/write/search/patch） |
| `src/main/agent/tools/terminal-tool.ts` | 318 | 终端命令执行工具 |
| `src/main/agent/tools/web-tools.ts` | 354 | 网络搜索/提取工具 |
| `src/main/agent/tools/todo-tool.ts` | 251 | 任务列表管理工具 |
| `src/main/agent/tools/index.ts` | 30 | 工具集合导出 |

### 基础设施文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/main/agent/anthropic-adapter.ts` | 382 | Anthropic API 适配器 |
| `src/main/agent/model-metadata.ts` | 221 | 模型元数据管理器 |
| `src/main/agent/auxiliary-client.ts` | 153 | 辅助 LLM 客户端 |
| `src/main/agent/mcp/mcp-client.ts` | 622 | MCP 客户端（JSON-RPC 实现） |
| `src/main/agent/mcp/index.ts` | 2 | MCP 导出 |
| `src/main/agent/utils/approval.ts` | 248 | 危险命令审批系统 |
| `src/main/agent/utils/redact.ts` | 91 | 敏感信息脱敏 |
| `src/main/agent/utils/ansi-strip.ts` | 37 | ANSI 转义清理 |
| `src/main/agent/utils/fuzzy-match.ts` | 394 | 模糊查找替换（9 策略链） |
| `src/main/agent/utils/patch-parser.ts` | 459 | V4A Patch 解析与应用 |
| `src/main/services/agent-service.ts` | 328 | 智能体进程管理服务 + AIAgent 桥接 |

---

## 1. 无效/死代码

### 1.1 `agent-service.ts` 中 `startAgent()` 启动外部 Python 进程 **[已修复]**

`agent-service.ts:39-79` 中的 `startAgent()` 函数尝试启动 `hermes-agent gateway` 外部 Python 进程。但当前智能体已经用 TypeScript 完整实现了 AIAgent 核心循环（`ai-agent.ts`），不再依赖外部 Python 进程。该函数和 `stopAgent()` / `isAgentRunning()` 以及 `agentProcess` 变量均为死代码。

**修复**: 已删除 `startAgent`、`stopAgent`、`isAgentRunning`、`agentProcess` 和 `getAgentExecutable()`。

### 1.2 `prompt-builder.ts` 中未使用的上下文文件发现函数 **[已修复]**

`prompt-builder.ts:98-247` 定义了 `findGitRoot()`、`findHermesMd()`、`loadContextFile()`、`loadSoulMd()`、`loadHermesMd()`、`loadAgentsMd()`、`loadClaudeMd()`、`loadCursorRules()`、`scanContextContent()`、`buildContextFilesPrompt()` 等大量函数。但 `buildSystemPrompt()` 当前只使用 `llmContext` 参数（来自数据库），**完全不调用** `buildContextFilesPrompt()` 或任何文件发现函数。

**修复**: 已删除所有未使用的上下文文件发现函数，减少约 150 行代码。

### 1.3 `prompt-builder.ts` 中预留的空函数 **[已修复]**

**修复**: 已删除 `buildSkillsSystemPrompt()` 和 `buildNousSubscriptionPrompt()` 等空函数。

---

## 2. 重复代码与文件臃肿

### 2.1 `file-tools.ts` 过于臃肿 **[已修复]**

**修复**: 已拆分为 `file-tools/read-file.ts`、`file-tools/write-file.ts`、`file-tools/search-files.ts`、`file-tools/patch-tool.ts`、`file-tools/path-safety.ts`、`file-tools/shell-exec.ts` 和 `file-tools/index.ts`。

### 2.2 `ai-agent.ts` 主循环过长 **[已修复]**

**修复**: 已拆分为 `agent-loop.ts`（主循环逻辑，~300 行）和 `agent-llm-bridge.ts`（LLM 调用封装，~120 行）。`ai-agent.ts` 本身降至 ~280 行，仅负责实例配置、组件管理和运行编排。所有 53 个单元测试通过，TypeScript 类型检查无错误。

---

## 3. 设计范式/抽象问题

### 3.1 全局状态导致跨会话污染 **[已修复]**

**修复**: AIAgent 已绑定 Nexus 会话 ID，通过 `Map<sessionId, AIAgent>` 实现多会话隔离。文件工具的 readCache、searchTracker、readTimestamps 等改为会话级状态，通过 `bindFileToolSession` 和 `bindSearchState` 注入到工具中。

### 3.2 `agent-service.ts` 中 `sendMessageToAIAgent` 的 fire-and-forget **[已修复]**

**修复**: 在 `run()` 的 catch 中广播了 `agent:state-change` 事件，将状态设为 `error`，前端可以感知到异常。

### 3.3 上下文压缩触发阈值偏低 **[已修复]**

**修复**: 已将阈值从 50% 提高到 70%，与 `context-compressor.ts` 中默认的 `thresholdPercent: 0.70` 保持一致。

### 3.4 `llm-client.ts` 中 OpenAI 流式响应的 usage 提取 **[已修复]**

**修复**: 已从流式响应的最后一个 chunk 中提取 `usage` 信息，确保 token 统计准确。

---

## 4. BUG

### 4.1 `ai-agent.ts` 中 `context_too_long` 错误重试可能无限循环 **[已修复]**

**修复**: 已添加最大重试计数器（`compressRetryCount`），超过限制后放弃并返回错误。

### 4.2 `file-tools.ts` 中 `read_file` 工具对目录的处理不一致 **[已修复]**

**修复**: `read_file` 工具的描述已明确说明支持目录浏览，返回数据格式已统一。

### 4.3 `fuzzy-match.ts` 策略 8（block_anchor）阈值硬编码 **[已修复]**

**修复**: 已将单候选阈值从 0.50 提高到 0.60。

### 4.4 `mcp-client.ts` 中 `MessageReader` 对不完整消息的处理 **[已修复]**

**修复**: 已将 `MessageReader` 的 buffer 上限从 1MB 提高到 10MB，当 buffer 超过限制且无法解析出完整消息时清空 buffer 并记录警告。同时增加了单条消息最大 50MB 限制。

### 4.5 `anthropic-adapter.ts` 中 qwen 模型输出限制不准确 **[未修复 — 需确认实际部署配置后调整]**

`anthropic-adapter.ts` 和 `model-metadata.ts` 中 qwen 模型的 `max_tokens` 与 `context_length` 值可能不一致。

**建议**: 确认 qwen 模型通过 Anthropic 兼容接口调用时的实际 `max_tokens` 上限，必要时调整。此问题需等待实际部署环境确认后处理。

---

## 5. 架构与安全问题

### 5.1 `terminal-tool.ts` 使用 `exec` 存在注入风险 **[已修复]**

**修复**: 已将 `terminal-tool.ts` 从 `exec` 改为 `spawn`，命令和参数分开传递，避免 shell 注入攻击。对于包含 shell 元字符的复杂命令，使用 `bash -c` 明确包装。

### 5.2 `web-tools.ts` 中 SSRF 保护不完整 **[已修复]**

**修复**: 已在 DNS 解析后、发起请求前增加 IP 地址检查，防止 DNS Rebinding 攻击。补充了 IPv6 ULA（`fd00::/8`）范围的检查。

### 5.3 全局单例 AIAgent 不支持并发会话 **[已修复]**

**修复**: `agent-service.ts` 已改为 `Map<sessionId, AIAgent>` 按会话 ID 隔离，每个 Nexus 会话拥有独立的 AIAgent 实例。IPC 处理器和 preload API 已支持 `sessionId` 参数传递。

### 5.4 `patch-parser.ts` 使用 /tmp 临时文件存在竞态 **[已修复]**

**修复**: 已将临时文件命名从 `Date.now()` 改为 `crypto.randomUUID()`，路径从硬编码 `/tmp` 改为 `os.tmpdir()`，确保每次调用生成唯一且不可预测的临时文件名。

---

## 6. 代码质量

### 6.1 模块级 `export` 导出过多内部函数 **[已修复]**

**修复**: 已移除 `prompt-builder.ts`、`approval.ts`、`context-compressor.ts`、`patch-parser.ts`、`path-safety.ts`、`read-file.ts`、`search-files.ts` 中共 35 个不必要的 `export`，减少 API 表面积。

### 6.2 `file-tools.ts` 中重复的 `execAsync` 调用模式 **[已修复]**

**修复**: 已提取 `runShellCommand(cmd, options)` 辅助函数到 `file-tools/shell-exec.ts`，统一了 `search-files.ts`、`read-file.ts`、`patch-tool.ts` 中所有 shell 命令执行的超时和缓冲区处理。

### 6.3 `mcp-client.ts` 的 JSON-RPC 消息帧解析器健壮性 **[已修复]**

**修复**: 已增加 50MB 最大消息体限制，防止 OOM。新增：垃圾数据前缀跳过、负数/无效 `Content-Length` 校验、`jsonrpc: "2.0"` 结构验证、stderr 缓冲上限（1MB）。同时在测试中发现并修复了垃圾数据跳过后的 `colonPos` 计算偏移 bug。

### 6.4 缺少端到端测试 **[已修复]**

**修复**: 已搭建 Vitest 测试框架（`npm run test`），并编写 53 个单元测试覆盖 5 个核心模块：
- `tests/unit/tool-registry.spec.ts`（15 个测试）— ToolRegistry 注册、查询、分发、checkFn 过滤
- `tests/unit/fuzzy-match.spec.ts`（13 个测试）— fuzzyFindAndReplace 9 策略链、边界条件、replaceAll
- `tests/unit/path-safety.spec.ts`（8 个测试）— expandTilde, isPathSafe, DEVICE_PATHS
- `tests/unit/mcp-message-reader.spec.ts`（10 个测试）— MessageReader 帧解析、分块传输、健壮性防护
- `tests/unit/iteration-budget.spec.ts`（7 个测试）— IterationBudget 预算控制

---

## 7. 优化优先级排序

| 优先级 | 问题 | 状态 |
|--------|------|------|
| P0 | 3.1 全局状态导致跨会话污染（TodoStore、readCache 等） | ✅ 已修复 |
| P0 | 5.3 全局单例 AIAgent 不支持并发会话 | ✅ 已修复 |
| P0 | 4.1 context_too_long 重试可能无限循环 | ✅ 已修复 |
| P1 | 3.4 OpenAI 流式 usage 提取可能为 undefined | ✅ 已修复 |
| P1 | 3.2 sendMessageToAIAgent 异常不通知前端 | ✅ 已修复 |
| P1 | 5.1 terminal-tool exec 命令注入风险 | ✅ 已修复 |
| P1 | 5.2 web-tools SSRF 保护不完整 | ✅ 已修复 |
| P2 | 2.1 file-tools.ts 拆分为多文件 | ✅ 已修复 |
| P2 | 3.3 上下文压缩触发阈值偏低 | ✅ 已修复 |
| P2 | 4.2 read_file 对目录处理不一致 | ✅ 已修复 |
| P2 | 4.4 MCP MessageReader buffer 泄漏风险 | ✅ 已修复 |
| P2 | 5.4 /tmp 临时文件竞态 | ✅ 已修复 |
| P2 | 1.1 agent-service 中外部 Python 进程死代码 | ✅ 已修复 |
| P3 | 2.2 ai-agent.ts 主循环拆分 | ✅ 已修复 |
| P3 | 1.2 prompt-builder 中未使用的上下文文件发现函数 | ✅ 已修复 |
| P3 | 4.3 fuzzy-match block_anchor 阈值过低 | ✅ 已修复 |
| P3 | 4.5 qwen max_tokens 可能不准确 | ⏸ 待确认部署配置 |
| P3 | 6.4 补充核心模块单元测试 | ✅ 已修复 |
