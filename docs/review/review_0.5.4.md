# 代码 Review 报告 v0.5.4

> 审查时间: 2026-05-15
> 审查范围: 未暂存变更（13 个文件），涵盖 Agent 架构重构、i18n 集成、视觉支持、会话管理改进

---

## 审查文件清单

### 修改文件

| 文件 | 修改内容 |
|------|------|
| `src/main/agent/agent-llm-bridge.ts` | 删除死函数 `buildApiMessages()`；添加 `onToolCallStart` 回调；硬编码 `thinking: { enabled: true, effort: 'high' }` |
| `src/main/agent/ai-agent.ts` | `AgentRunResult` 迁移到 `agent-loop.ts`；`maxIterations` 90→200；`MutableAgentState` 替代独立 getter/setter；`clearHistory` 改用会话隔离删除；新增 `getNexusSessionId()` 等 getter；记忆压缩后广播上下文用量 |
| `src/main/agent/prompt-builder.ts` | 全部系统提示从英文翻译为中文 |
| `src/main/agent/skills/skill-manager.ts` | 新增 "Mode 1" 扁平目录结构支持（`category/SKILL.md`） |
| `src/main/agent/skills/skill-prompt-injector.ts` | 提示文本翻译为中文 |
| `src/main/services/agent-service.ts` | 新增 `triggerMemoryExtraction()`；移除 `DEFAULT_SESSION_ID`；添加 `cachedAgentConfig`；`clearAgentHistory` 提取为独立函数；修改默认 stream 策略 |
| `src/core/constants/ipc-channels.ts` | 新增剪贴板、PDF、Skill、记忆、Nexus、输入历史等 IPC 频道 |
| `src/core/types/index.ts` | 移除已确认死代码 `PanelSize`、`PanelPosition` |
| `src/main/ipc/handlers/config.ts` | 新增 `DynamicIslandManager` 语言变更通知；改进视觉测试（红 100x100 图片） |
| `src/main/preload.ts` | 新增 Skill/记忆/引导/onboarding API；`clearHistory/compressHistory` 需 `sessionId` |
| `src/renderer/components/common/DynamicIsland.tsx` | Hook 拆分为独立文件；i18n 集成；新增 TaskPanel/SkillPanel/MemoryPanel；输入历史面板；`enableVision` 条件渲染；上下文用量百分比条 |
| `src/renderer/components/common/SettingsModal.tsx` | 全面 i18n；新增语言设置页；`enableVision` 开关；`maxIterations` 90→200；应用按钮不再自动关闭弹窗 |
| `src/renderer/electron-api.d.ts` | 新增 Skill/记忆/onboarding 类型声明；修改 `clearHistory` 签名 |

---

## 1. 无效/死代码

### 1.1 `DynamicIsland.tsx` 中 `_bgActivity` 未使用

`DynamicIsland.tsx:98`：
```typescript
const { activity: _bgActivity, isActive: bgActivityActive } = useBackgroundAgentActivity()
```
`_bgActivity` 显式标记未使用。如果只需要 `isActive`，hook 可以更精简。

**建议**: 短期内保留（可能后续需要），但建议在代码注释中说明保留原因。

**状态**: ✅ 已修复 — 移除 `_bgActivity` 解构，只保留 `isActive: bgActivityActive`

### 1.2 `ai-agent.ts` 中 `(this as any).nexusSessionId`

`ai-agent.ts` 的 `getNexusSessionId()` 方法使用 `this as any` 访问私有字段 `nexusSessionId`。该字段已在类中正确声明为 `private nexusSessionId: string`，`as any` 强制类型转换完全没有必要，且绕过了 TypeScript 的类型检查。

**建议**: 改为 `return this.nexusSessionId`。

**状态**: ✅ 已修复 — 改为 `return this.nexusSessionId || undefined`

---

## 2. 重复代码与文件臃肿

### 2.1 `agent-llm-bridge.ts` 中调试日志重复

`callLLMNonStream` 和 `callLLMStream` 中几乎相同的"发送消息到 LLM"调试日志代码。

**建议**: 提取为私有方法 `logApiMessages()`，两处调用。

**状态**: ✅ 已修复 — 提取 `logApiMessages()` 函数，消除约 24 行重复代码

### 2.2 `DynamicIsland.tsx` 体积

主组件 641 行，虽然已将逻辑拆分为 hook 文件，但 JSX 渲染部分（约 470 行）仍然很大，包含嵌套的条件渲染、模态框、底部栏等。

**建议**: 可拆分为 `IslandScrollableArea`、`IslandBottomBar`、`IslandHistoryModal` 三个子组件。

**状态**: ⏸ 暂不处理 — 当前可接受

---

## 3. 设计范式/抽象问题

### 3.1 `agent-llm-bridge.ts` 中 `thinking` 硬编码

`agent-llm-bridge.ts` 中 `thinking: { enabled: true, effort: 'high' }` 无条件传递给所有模型的 stream 调用。经核实，`llm-client.ts` 已根据 provider 正确分发：
- **Anthropic**：由 `buildAnthropicParams` 转换为 Anthropic 格式的 thinking 参数
- **OpenAI 兼容**：转换为 `extra_body.reasoning` 发送给 API（line 366-374）

两种提供商都能正确处理该参数，不会导致 API 错误。

**状态**: ✅ 无需修改 — `llm-client.ts` 已做 provider 路由分发

### 3.2 `prompt-builder.ts` 中系统提示语言锁定

系统提示已完全翻译为中文，但没有语言切换机制。即使用户将应用语言切换为英文，发送给 LLM 的系统提示仍是中文。这会导致 LLM 行为偏向中文响应。

**建议**: 将系统提示文本纳入 i18n 管理，或至少确认系统提示语言始终与应用语言一致。

**状态**: ✅ 已修复 — `prompt-builder.ts` 所有常量增加 zh/en 双语版本，`BuildSystemPromptOptions` 新增 `language` 参数，`agent-service.ts` 从数据库读取语言配置并传入

### 3.3 `agent-service.ts` 中 `triggerMemoryExtraction` 日志过多

`triggerMemoryExtraction()` 函数在单个调用流程中有 7+ 条 `logger.info` 日志。

**建议**: 中间步骤降级为 `logger.debug`，只保留最终的 `logger.info("已触发记忆提取")`。

**状态**: ✅ 已修复 — 中间步骤日志降级为 `logger.debug`，成功时输出单条 `logger.info`，失败时 `logger.error`

### 3.4 `agent-service.ts` 中 `parentConfig` 使用 `as any` 构造部分无效配置

`agent-service.ts` `clearAgentHistory()` 中，当 agent 不存在时构造的 `parentConfig` 为 `{ model: '', provider: '' } as any`。这个部分无效的配置传递给 `MemoryExtractorAgent`，如果提取器尝试使用空模型/provider，将静默失败或产生错误结果。

**建议**: 配置不可用时跳过记忆提取，或构建一个有效的默认配置。

**状态**: ✅ 已修复 — 配置不可用时跳过记忆提取，不再构造部分无效的 `AgentConfig`

### 3.5 `skill-manager.ts` 中 Mode 1 扁平结构不一致

`skill-manager.ts` 新增了对扁平结构（`category/SKILL.md`）的支持，`listSkills()` 能正确列出扁平 skill。但 `discoverSkillFiles()`（提示注入快照使用的方法）只遍历嵌套结构（`category/skill-name/SKILL.md`），不包含扁平结构的文件。这导致 `listSkills()` 列出的 skill 与提示注入中注入的 skill 不一致。

**建议**: 在 `discoverSkillFiles()` 中也支持 Mode 1 扁平结构的发现。

**状态**: ✅ 已修复 — `discoverSkillFiles()` 新增 Mode 1 扁平结构支持，与 `listSkills()` 保持一致

### 3.6 `MutableAgentState` 模式改进

用单个 `MutableAgentState` 对象替代 `RunLoopDeps` 中的独立 getter/setter 对，是简洁的设计改进。减少了回调嵌套，提高了可读性。

**状态**: ✅ 良好的重构

### 3.7 会话隔离修复

`clearHistory()` 从 `deleteAll()` 改为 `deleteAllBySessionId()`，配合移除 `DEFAULT_SESSION_ID`，确保多会话数据隔离。这是关键的正确性修复。

**状态**: ✅ 良好的修复

---

## 4. BUG

### 4.1 `config.ts` 中 API Key 明文记录 **[未修复]**

`src/main/ipc/handlers/config.ts` 的 CONFIG_SAVE 处理器：
```typescript
logger.info(`[ConfigHandler] 保存配置: key=${key}, value=${JSON.stringify(value)}`)
```
当保存 `agentConfig` 时，`value` 包含完整的 `apiKey` 字段，会以明文形式写入日志。如果日志被传输、存储或查看，存在凭据泄露风险。

**建议**: 对包含 `apiKey`、`secretKey` 等敏感字段的值进行脱敏后再记录，例如 `value=***`。

**状态**: ⏸ 不处理

### 4.2 `SettingsModal.tsx` 中 SubModel 区域标题引用了错误的 i18n key

`SettingsModal.tsx:653` 左右，Sub Model 标签页中的 section title 使用了 `t('settings.mainModel')` 而非 `t('settings.subModel')`。这很可能是复制粘贴遗留，导致子模型配置区域显示"主模型"标题。

**建议**: 改为 `t('settings.subModel')`。

**状态**: ✅ 已修复 — 改为 `t('settings.subModel')`

### 4.3 `preload.ts` 中 `onLanguageChanged` 可能无法工作

`preload.ts` 使用 `ipcRenderer.on('language-changed', ...)` 注册监听，但 `config.ts` 处理器通过 `islandWin.webContents.send('language-changed', ...)` 发送到指定窗口。`ipcRenderer.on` 监听的是主进程广播到所有渲染进程的消息，而 `webContents.send` 是发送到特定窗口的。如果 preload 在错误的上下文中注册，可能收不到事件。

**建议**: 验证语言变更事件的实际传递路径，确保 preload 的监听机制与主进程的发送方式匹配。

**状态**: ✅ 无需修改 — 灵动岛窗口使用同一个 `preload.js`（line 46），`webContents.send` 发送到特定窗口，该窗口的 `ipcRenderer.on` 能正确接收

### 4.4 `agent-service.ts` 中 `cachedAgentConfig` 缓存一致性

`cachedAgentConfig` 是模块级变量，通过 `invalidateConfigCache()` 在配置保存时失效。但如果数据库被其他方式修改（直接操作数据库、数据迁移等），缓存将提供过时数据。

**建议**: 增加 TTL 过期机制或在 `getAgentConfig` 中添加可选的强制刷新参数。

**状态**: ⏸ 不处理

---

## 5. 架构与安全问题

### 5.1 系统提示翻译质量

`prompt-builder.ts` 将所有系统提示从英文翻译为中文。这是正确的方向（与用户语言一致），但需注意：
- 部分专业术语的翻译是否准确（如 "tool use enforcement" → "工具使用强制"）
- LLM 对中文系统提示的理解是否与英文等效
- 多语言支持（见 3.2，已修复）

**状态**: ✅ 已修复 — `PLATFORM_HINTS_ZH` 原为英文内容，已翻译为中文；其余翻译质量良好

### 5.2 `enableVision` 默认值不一致

`SettingsModal.tsx` 中，主模型的 `enableVision` 默认为 `true`（line 112），但子模型配置中没有设置 `enableVision`（line 134-136），值为 `undefined`。子模型不需要视觉开关，所以实际影响不大，但数据结构不一致。

**建议**: 子模型也显式设置 `enableVision: false` 或在类型中明确区分。

**状态**: ✅ 已修复 — 子模型的加载路径和默认路径都显式设置 `enableVision: false`

### 5.3 IPC `sessionId` 参数验证

`agent.ts` 的 IPC 处理器直接传递 `sessionId` 而不做验证。如果渲染进程发送空字符串或非字符串值，可能导致意外行为。

**建议**: 添加基本的 `typeof sessionId === 'string' && sessionId.length > 0` 验证。

**状态**: ✅ 已修复 — 添加 `validateSessionId()` 函数，所有使用 `sessionId` 的 IPC 处理器均做基本类型和非空验证

---

## 6. 代码质量

### 6.1 类型定义

`electron-api.d.ts` 中新增的 Skill/记忆/onboarding 类型声明完整，与 `preload.ts` 的实现一致。`onConnectionStateChanged` 回调类型包含 `track: 'browser' | 'data'` 字段（line 437），但 preload 的监听包装器未解构该字段，类型声明与实际使用不完全匹配。

**状态**: ✅ 已修复 — `preload.ts` 的 `onConnectionStateChanged` 回调现在包含 `track` 字段，与 `electron-api.d.ts` 类型声明一致

### 6.2 i18n 集成质量

`DynamicIsland.tsx` 和 `SettingsModal.tsx` 的 i18n 集成全面，所有硬编码中文都替换为 `t()` 调用。这是良好的工程实践。

**状态**: ✅ 良好

### 6.3 Hook 拆分

`DynamicIsland.tsx` 将逻辑拆分为 6 个 hook 文件（config/history/panels/agent/ui/utils），大幅提高了可测试性和可读性。

**状态**: ✅ 良好的重构

### 6.4 死代码清理

`types/index.ts` 移除了已确认的死代码 `PanelSize` 和 `PanelPosition`（参见之前的 review 文档）。`ai-agent.ts` 中 `AgentRunResult` 迁移到 `agent-loop.ts` 消除了重复定义。`agent-llm-bridge.ts` 中删除了 `buildApiMessages()` 死函数。

**状态**: ✅ 良好的清理

### 6.5 日志改进

`agent-service.ts` 添加了 `tool_start` 事件的日志记录，提高了调试可见性。

**状态**: ✅ 良好

---

## 7. 优化优先级排序

| 优先级 | 问题 | 状态 |
|--------|------|------|
| P1 | 4.1 API Key 明文记录 | ⏸ 不处理 |
| P1 | 4.2 SubModel 区域标题 i18n key 错误 | ✅ 已修复 |
| P2 | 3.5 `discoverSkillFiles` 不支持 Mode 1 扁平结构 | ✅ 已修复 |
| P2 | 3.4 `parentConfig` 部分无效配置 (`as any`) | ✅ 已修复 |
| P2 | 1.2 `(this as any).nexusSessionId` | ✅ 已修复 |
| P2 | 4.3 `onLanguageChanged` 事件传递路径 | ✅ 无需修改 |
| P3 | 3.1 `thinking` 硬编码所有模型 | ✅ 无需修改 |
| P3 | 3.2 系统提示语言锁定 | ✅ 已修复 |
| P3 | 3.3 `triggerMemoryExtraction` 日志过多 | ✅ 已修复 |
| P3 | 2.1 `agent-llm-bridge.ts` 调试日志重复 | ✅ 已修复 |
| P3 | 1.1 `DynamicIsland.tsx` `_bgActivity` 未使用 | ✅ 已修复 |
| P3 | 2.2 `DynamicIsland.tsx` 体积 | ⏸ 暂不处理 |
| P3 | 4.4 `cachedAgentConfig` 缓存一致性 | ⏸ 不处理 |
| P3 | 5.2 `enableVision` 默认值不一致 | ✅ 已修复 |
| P3 | 5.3 IPC `sessionId` 参数验证 | ✅ 已修复 |
| P3 | 6.1 `onConnectionStateChanged` 类型不匹配 | ✅ 已修复 |
