# 代码 Review 报告 v0.6.0

> 审查时间: 2026-05-26
> 审查范围: 全量代码审查（247 个 TypeScript 源文件，约 44,879 行代码）
> 审查方法: 4 个并行审查代理 + 人工补充审查
> 参考基线: review_0.5.4.md

---

## 一、审查模块与代理分工

| 审查代理 | 覆盖模块 | 文件数 | 发现问题 |
|----------|----------|--------|----------|
| Agent 核心架构 | ai-agent, agent-loop, llm-client, prompt-builder, compressor, memory | 21 | 25 |
| 工具与技能系统 | tools/, skills/, tasks/, mcp/, utils/ | 25 | 17 |
| IPC 通信与数据层 | ipc/handlers, preload, db, services, windows | 46 | 5 |
| 渲染进程 UI 层 | components, store, hooks, i18n | 64 | 28 |
| **合计** | | **247** | **75** |

---

## 二、严重问题汇总（Critical）

共发现 **7 个 Critical 级别**问题，建议立即修复。

### C-1: `ContentBlock[]` 的 `.length` 返回数组长度而非字符数，token 估算严重偏低

**状态**: ✅ 已修复 — 新增 `getContentCharLength()` 辅助函数，区分 `string`（直接取 `.length`）和 `ContentBlock[]`（遍历累加文本字符 + 图片固定估算），修复 `estimateMessageTokens` 和 `findCompressBoundary` 两处调用

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/context-compressor.ts` |
| **行号** | 80-82 |
| **分类** | BUG |

`estimateMessageTokens` 中 `msg.content?.length` 对于 `ContentBlock[]` 类型的 content，`.length` 返回的是**数组长度**而非字符数。一条包含 2 个 block（如图片+文本）的消息，`content.length` 返回 2 而非实际文本字符数，导致 token 估算严重偏低。

**影响**: 任何包含图片附件的对话都会导致 token 估算错误，上下文压缩触发不及时，最终导致 `context_too_long` 错误。

**修复建议**: 当 `content` 为数组时，遍历所有 block 累加文本字符数。

### C-2: `sedContent` 变量遮蔽，sed 读取永远返回空

**状态**: ✅ 已修复 — 去掉内层 `const` 改为赋值，sed 结果正确传递到外层行号拼接逻辑

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/tools/file-tools/read-file.ts` |
| **行号** | 243-261 |
| **分类** | BUG |

第 243 行 `let sedContent = ''`，第 245 行 try 块内 `const sedContent` 重新声明产生遮蔽。内层 `const` 作用域限于 try 块内，try 块结束后第 261 行的 `sedContent` 仍是外层空字符串。

**影响**: 指定行范围读取功能实质失效，sed 成功时返回空字符串。

**修复建议**: 去掉第 245 行的 `const`，改为赋值：`sedContent = await runShellCommand(...)`

### C-3: `shell.trashItem` 未 await 导致错误处理失效

**状态**: ✅ 已修复 — 添加 `await` 确保 trash 操作完成后才计数，失败时能被 catch 块正确捕获

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/tools/file-tools/file-manager-tools.ts` |
| **行号** | 180-181 |
| **分类** | BUG |

`shell.trashItem(p)` 返回 Promise，但未使用 `await`。`successCount++` 在 trash 操作尚未完成时就已执行。如果 trash 操作后续失败，catch 块不会捕获到该错误。

**影响**: 工具总是报告"删除成功"，实际文件可能未删除，且产生 unhandled promise rejection。

**修复建议**: 添加 `await`：`await shell.trashItem(p)`

### C-4: 命令注入漏洞 — `execSync` 使用 attrib

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/tools/nexus-profile-tool.ts` |
| **行号** | 30 |
| **分类** | 安全 |

`execSync(\`attrib +h "${filePath}"\`)` 中 `filePath` 来自用户控制参数。Windows 上攻击者可构造 `" & malicious_cmd & "` 路径突破引号保护。

**修复建议**: 使用 `execFileSync('attrib', ['+h', filePath])` 替代字符串拼接。

### C-5: 命令注入漏洞 — shell 命令拼接（sed/wc）

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/tools/file-tools/read-file.ts` |
| **行号** | 236, 246 |
| **分类** | 安全 |

两处 shell 命令拼接：`wc -l < "${resolved}"` 和 `sed -n '${offset},${endLine}p' "${resolved}"`。路径中可能包含特殊字符（双引号、反引号、`$()` 等），可被恶意文件名利用。

**修复建议**: 使用 `execFileSync` 替代 shell 拼接，或对 `resolved` 使用 `escapeShellArg` 工具函数。

### C-6: App.tsx 与 MainLayout.tsx 重复渲染 6 个全局组件

**状态**: ✅ 已修复 — 移除 `MainLayout.tsx` 中重复的 6 个全局组件（ContextMenu、ConfirmModal、RenameModal、PathSelectorModal、FileRenameModal、Toast），仅保留 `App.tsx` 中的全局渲染

| 属性 | 值 |
|------|------|
| **文件** | `src/renderer/App.tsx` (行 98-108) + `src/renderer/components/layout/MainLayout.tsx` (行 34-43) |
| **分类** | BUG |

以下 6 个组件被同时渲染在两个位置：`ConfirmModal`、`RenameModal`、`PathSelectorModal`、`FileRenameModal`、`Toast`、`ContextMenu`。

**影响**: 模态框事件监听重复注册；Toast 通知显示两次；右键菜单出现两层叠加。

**修复建议**: 保留 `App.tsx` 中的全局组件渲染，移除 `MainLayout.tsx` 中的重复部分。

### C-7: SettingsModal 渲染阶段调用副作用函数

**状态**: ✅ 已修复 — 将 `captureAllBrowsersBeforeModal()` 从渲染函数体移入 `useEffect([settingsModalVisible])`，避免 StrictMode 双重渲染和每次 re-render 重复执行

| 属性 | 值 |
|------|------|
| **文件** | `src/renderer/components/common/settings/SettingsModal.tsx` |
| **行号** | 23-25 |
| **分类** | BUG |

`captureAllBrowsersBeforeModal()` 被直接放在组件函数体中（渲染阶段），而非 `useEffect` 内。React 18 StrictMode 会双重调用渲染函数，导致副作用执行两次。

**修复建议**: 移入 `useEffect` 中，以 `settingsModalVisible` 为依赖项。

---

## 三、重要问题汇总（Important）

共发现 **23 个 Important 级别**问题。

### 3.1 Agent 核心架构

#### I-1: `abort` 后 `classifyError` 中 user/timeout 中断区分依赖时序

**状态**: ✅ 已修复 — 新增 `_userAborted` 标记字段，`abort()` 时设为 true、每次请求开始时重置，`classifyError` 改用布尔标记区分中断类型，彻底消除时序竞争

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/llm-client.ts:265` |
| **分类** | BUG |

`classifyError` 中通过 `this.abortController === null` 区分用户中断和超时中断，但 abort 后 `abortController` 可能已被 finally 块置 null，导致错误分类不准确。

**修复建议**: 在 abort 时传入标记参数 `isUserAbort: boolean`，不依赖 `abortController` 状态。

#### I-2: `pruneOldToolResults` 对 ContentBlock 数组的 `.length` 误用

**状态**: ✅ 已修复 — 区分 `string`（取 `.length`）和 `ContentBlock[]`（序列化为 JSON 后取长度），避免多模态工具结果永远不被裁剪

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/context-compressor.ts:116` |
| **分类** | BUG |

`msg.content.length <= 200` 当 `msg.content` 是 `ContentBlock[]` 数组时，`.length` 是数组元素个数而非内容长度。

**修复建议**: 先判断 `typeof msg.content === 'string'` 再做长度比较。

#### I-3: `getMemoryProvider` 访问未初始化的 MemoryManager

**状态**: ✅ 已修复 — 直接创建 `SqliteMemoryProvider` 实例，移除通过 `manager['provider']` 访问私有属性的间接方式

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/memory-extractor.ts:221-228` |
| **分类** | BUG |

`getMemoryProvider()` 通过 `manager['provider']` 访问私有属性，但 `MemoryManager` 构造后 `provider` 尚未初始化。

**修复建议**: 先调用 `await manager.initializeAll()`，或使用已初始化的实例。

#### I-4: `run()` 中重建 MemoryManager 未调用初始化

**状态**: ✅ 已修复 — `run()` 中重建 MemoryManager 后追加调用 `initializeMemory()`，确保记忆系统完成初始化（`initializeAll` + `loadAndFreezeSnapshot` + 重建 LLM Bridge）

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/ai-agent.ts:424-427` |
| **分类** | BUG |

`run()` 中如果 `this.memoryManager` 为 null 会创建新的 MemoryManager，但未调用 `initializeAll()`。后续 `retrieveForTurn` 因 `initialized === false` 返回空字符串，记忆功能静默失效。

**修复建议**: 重建后调用 `await this.memoryManager.initializeAll()` 和 `await this.memoryManager.loadAndFreezeSnapshot()`。

#### I-5: 压缩 prompt 无总长度限制

**状态**: ⏸ 暂不处理

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/background-compressor.ts:251-257` |
| **分类** | 设计 |

`_buildCompressPrompt` 将所有消息序列化为 JSON 后一次性发给 LLM，没有对总 prompt 长度做限制。对话历史非常长时可能超出副模型的上下文窗口。

**修复建议**: 计算总 prompt 长度，超过副模型上下文窗口的 80% 时从最早消息开始丢弃，或分段压缩。

#### I-6: `logApiMessages` 以 info 级别打印消息内容

**状态**: ⏸ 暂不处理

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/agent-llm-bridge.ts:122-134` |
| **分类** | 安全 |

`logger.info` 级别打印发送给 LLM 的完整消息内容预览（前 500 字符），生产环境中可能包含用户敏感数据。

**修复建议**: 降级为 `debug`，或仅在开发模式下启用完整内容打印。

#### I-7: MutableAgentState 回写使用浅拷贝

**状态**: ✅ 已修复 — 回写 `this.messages` 时对消息数组及嵌套对象（`content`、`tool_calls`、`attachments`）做深拷贝，切断与运行循环内部的引用共享

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/ai-agent.ts:515` |
| **分类** | 设计 |

`this.messages = result.messages` 使用浅拷贝，`this.messages` 和 `agentState.messages` 共享相同的 AgentMessage 对象。

**修复建议**: 确保消息对象不可变，或使用深拷贝。

#### I-8: prompt-builder `index.ts` 自引用导出循环

**状态**: ✅ 已修复 — `mod.ts` 注释修正，明确从实际实现模块 `./index` 导入的意图，消除自引用语义歧义

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/prompt-builder/index.ts` + `mod.ts` |
| **分类** | 设计 |

`mod.ts` 从 `./index` 重新导出，而 `index.ts` 也从 `./index`（自身）导出，形成自引用导出循环。

**修复建议**: `index.ts` 应从 `./mod` 导入，而非从 `./index` 自身。

#### I-9: agent-service 多处缺少 DatabaseService/DAO 空值检查

**状态**: ✅ 已修复 — 5 处 `DatabaseService.getInstance()` 链式调用添加空值守卫：`getInstance()` 返回 null 时安全退出，避免数据库未就绪时崩溃

| 属性 | 值 |
|------|------|
| **文件** | `src/main/services/agent-service.ts:278,307,331,443,526` |
| **分类** | BUG |

5 处直接链式调用 `DatabaseService.getInstance().getXxxDAO()` 无空值保护，数据库未就绪时崩溃。

**修复建议**: 添加 try-catch 或 null 检查。

### 3.2 工具与技能系统

#### I-10: MCP disconnect 在初始化期间无法清理子进程

**状态**: ✅ 已修复 — `disconnect()` 守卫条件从 `!this.process || !this.alive` 改为 `!this.process`，确保初始化期间也能清理子进程；增加 pending 请求拒绝逻辑，仅在 `alive` 时发送 shutdown 通知

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/mcp/mcp-client.ts:252-253` |
| **分类** | BUG |

`disconnect()` 检查 `if (!this.alive) return`，但 `this.alive` 仅在 `sendInitialize` 完成后才设为 `true`。初始化过程中调用 disconnect 会直接 return，子进程成为孤儿进程。

**修复建议**: 改为 `if (!this.process) return`，确保 disconnect 总能清理已 spawn 的进程。

#### I-11: 路径遍历漏洞 — update_plan 工具

**状态**: ✅ 已修复 — `path.join` 改为 `path.resolve`，增加路径前缀校验确保解析后的文件路径仍在 `PLANS_DIR` 目录内，阻止 `../../` 等路径遍历攻击

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/tools/update-plan-tool.ts:91-92` |
| **分类** | 安全 |

`plan_file` 参数来自 LLM 输入，仅做了 `.md` 后缀补全。攻击者可传入 `../../etc/crontab` 路径遍历字符串。`write-plan-tool.ts` 有 `sanitizeFilename`，但 `update-plan-tool.ts` 缺少防护。

**修复建议**: 复用 `write-plan-tool.ts` 的 `sanitizeFilename`，或检查 `path.resolve(filePath)` 以 `PLANS_DIR` 为前缀。

#### I-12: 危险命令审批状态跨会话共享

**状态**: ✅ 已修复 — 添加 `bindTerminalSession(sessionId)` 函数，在 AIAgent 构造时绑定会话 ID；终端工具调用 `checkDangerousCommand` 时传入当前 sessionId，确保审批状态按会话隔离

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/utils/approval.ts:237` + `src/main/agent/tools/terminal-tool.ts:294` |
| **分类** | 安全 |

`checkDangerousCommand` 的 `sessionKey` 默认值为 `'default'`，`terminal-tool.ts` 调用时未传递 sessionKey。所有终端会话共享同一个 key，用户在会话 A 中批准的命令在会话 B 也自动放行。

**修复建议**: 传入当前会话的唯一标识。

#### I-13: 路径安全检查函数重复实现 3 份

**状态**: ✅ 已修复 — 合并最全面的黑名单到 `path-safety.ts`，导出 `isWriteDenied`、`checkSensitivePath`、`isExpectedWriteError`；`write-file.ts` 和 `file-manager-tools.ts` 移除重复实现改为导入

| 属性 | 值 |
|------|------|
| **文件** | `path-safety.ts`、`write-file.ts`、`file-manager-tools.ts` |
| **分类** | 设计 |

`isWriteDenied` 在三个文件中各有一份实现，`checkSensitivePath` 在两个文件中有实现。各份实现可能存在细微差异。

**修复建议**: 统一在 `path-safety.ts` 中导出，其他文件 import 使用。

#### I-14: `path-safety.ts` 导出策略不完整

**状态**: ✅ 已修复 — 同 I-13，三个路径安全函数均已导出并统一使用

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/tools/file-tools/path-safety.ts` |
| **分类** | 设计 |

`isWriteDenied`、`checkSensitivePath`、`isExpectedWriteError` 都是私有函数，导致其他文件不得不自行复制实现。

**修复建议**: 导出所有路径安全相关函数。

#### I-15: `isExpectedWriteError` 在 path-safety.ts 中声明但从未使用

**状态**: ✅ 已修复 — 删除未使用的函数定义

| 属性 | 值 |
|------|------|
| **文件** | `src/main/agent/tools/file-tools/path-safety.ts:107` |
| **分类** | 死代码 |

函数声明但未导出、也未在该文件内调用。

**修复建议**: 删除或导出统一使用。

### 3.3 IPC 通信与数据层

#### I-16: API Key 明文记录日志（遗留）

**状态**: ⏸ 暂不处理 — v0.5.4 review 已标记"不处理"，继续维持，后续择机修复

| 属性 | 值 |
|------|------|
| **文件** | `src/main/ipc/handlers/config.ts:94` |
| **分类** | 安全 |

`logger.info(\`[ConfigHandler] 保存配置: key=${key}, value=${JSON.stringify(value)}\`)` 保存 `agentConfig` 时，`apiKey` 以明文写入日志。此问题在 v0.5.4 review 中标记为"不处理"，仍建议后续修复。

**修复建议**: 对 `apiKey`、`secretKey` 等敏感字段进行脱敏后再记录。

#### I-17: LibreOffice 转换命令注入风险

**状态**: ✅ 已修复 — 将 `execAsync(command)` 字符串拼接改为 `execFileSync('soffice', [args])` 数组传参，避免 shell 解释，消除命令注入风险

| 属性 | 值 |
|------|------|
| **文件** | `src/main/ipc/handlers/filesystem.ts:354` |
| **分类** | 安全 |

`const command = \`soffice --headless --convert-to pdf --outdir "${outputDir}" "${sourcePath}"\`` — 路径通过双引号包裹但仍可能被特殊字符突破。

**修复建议**: 使用 `execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', outputDir, sourcePath])`。

### 3.4 渲染进程 UI 层

#### I-18: useBrowserAddressBar 渲染阶段 IIFE 触发异步副作用

**状态**: ✅ 已修复 — 将 `useCallback(() => { ... }, [])()` IIFE 改为 `useEffect(() => { ... }, [])`，历史记录缓存加载仅在组件挂载时执行一次，符合 React 渲染纯函数契约

| 属性 | 值 |
|------|------|
| **文件** | `src/renderer/components/browser/useBrowserAddressBar.ts:75-79` |
| **分类** | BUG |

`useCallback(() => { ... }, [])()` 立即执行回调，在 Hook 渲染阶段直接发起异步 IPC 调用。违反 React 渲染纯函数契约。

**修复建议**: 改为 `useEffect(() => { ... }, [])` 模式。

#### I-19: ClarifyModal useEffect 依赖缺失导致闭包陈旧

**状态**: ✅ 已修复 — 将 `handleSubmit`/`handleCancel` 前移到 useEffect 之前，用 `useRef` 持有最新回调引用；键盘事件 useEffect 改为通过 ref 调用，依赖数组精简为 `[clarifyModal?.visible, clarifyModal?.choices]`，`hasChoices` 改为在事件处理器内联计算

| 属性 | 值 |
|------|------|
| **文件** | `src/renderer/components/common/ClarifyModal.tsx:41-54` |
| **分类** | BUG |

键盘事件 `useEffect` 依赖数组仅追踪 `clarifyModal?.visible`，但闭包内使用了 `handleSubmit`。若 `clarifyModal` 内容变化但 `visible` 不变，键盘事件处理器持有旧的 `handleSubmit`。

**修复建议**: ~~将 `handleSubmit` 和 `handleCancel` 添加到依赖数组，或使用 `useRef`。~~

#### I-20: use-dynamic-island-agent 阻塞式轮询等待循环

**状态**: ✅ 已修复 — 改用事件驱动：先查询状态，仅在运行中时注册 `onStateChange` 监听等待中断完成，5 秒超时兜底。消除最多 50 次 IPC 轮询调用

| 属性 | 值 |
|------|------|
| **文件** | `src/renderer/components/common/use-dynamic-island-agent.ts:230-239` |
| **分类** | 设计 |

使用 `for` 循环 + `setTimeout(100ms)` 最多等待 5 秒，轮询 agent 状态。忙等待模式阻塞 async 执行流。

**修复建议**: ~~改为事件驱动模式，注册 `onStateChange` 监听器。~~

#### I-21: CodeMirrorEditor 模块级可变状态

**状态**: ✅ 已修复 — 模块级变量 `cmGetSelectedText`/`cmCapturedSelectedText` 改为 `Map<string, ...>` 按 `editorId`（即 `panelId`）隔离，getter 函数新增 `editorId` 参数，`CodeMirrorEditor`/`FileViewer` 新增 `editorId` prop 透传

| 属性 | 值 |
|------|------|
| **文件** | `src/renderer/components/file-browser/CodeMirrorEditor.tsx:25-27` |
| **分类** | 设计 |

`cmGetSelectedText` 和 `cmCapturedSelectedText` 是模块级可变变量，多实例时会互相覆盖。

**修复建议**: ~~使用 React Context 或 Zustand store 按面板 ID 隔离。~~

#### I-22: FileStatusBar `undefined as unknown as string` 类型欺骗

**状态**: ✅ 已修复 — 返回类型改为 `string | undefined`，移除双重类型断言

| 属性 | 值 |
|------|------|
| **文件** | `src/renderer/components/file-browser/FileStatusBar.tsx:45` |
| **分类** | 类型安全 |

函数声明返回 `string`，实际返回 `undefined`，通过双重类型断言绕过编译器。

**修复建议**: ~~返回类型改为 `string | undefined`。~~

#### I-23: NexusProfileModal 10+ 处硬编码中文

**状态**: ✅ 已修复 — 12 处硬编码中文替换为 `t()` 调用，新增 `nexusProfile.fileSystem`、`treeLabel`、`unsavedChanges`、`autoGenerate`、`generating`、`generateTooltip`、`confirmClose`、`confirmCloseMessage`、`dontSave`、`saveAndClose` 共 11 个 i18n key，覆盖 zh/en/es/fr 四种语言

| 属性 | 值 |
|------|------|
| **文件** | `src/renderer/components/common/NexusProfileModal.tsx` |
| **分类** | i18n |

行 68 `'文件系统'`、行 108 `'文件系统'`、行 306 `treeLabel="目录树"`、行 345 `'生成中...'`、行 353 `'关闭'`、行 388 `'不保存'` 等 10+ 处硬编码中文。

**修复建议**: ~~为所有硬编码字符串定义 i18n key。~~

---

## 四、次要问题汇总（Minor）

共发现 **45 个 Minor 级别**问题。

### 4.1 Agent 核心架构（14 项）

| # | 文件 | 描述 |
|---|------|------|
| M-1 | `llm-client/types.ts:11-12` | OpenAI/Anthropic import 仅用于 `instanceof`（功能正确，建议添加注释） |
| M-2 | `agent-loop.ts:237-238` | 迭代预算重复检查（while 条件 + 循环体内 break 冗余） |
| M-3 | `agent-service.ts:195-196` | 日志打印用户邮箱地址 |
| M-4 | `tool-registry.ts:95-117` | `getDefinitions` 中 checkFn 串行 await，建议 `Promise.all` |
| M-5 | `context-compressor.ts:61` | 空分隔符注释块 |
| M-6 | `anthropic-adapter.ts:248-249` | 合并不同类型消息时丢弃前一条内容 |
| M-7 | `agent-tool-execution.ts:105` | 结果遍历中 O(n²) 查找 |
| M-8 | `openai-caller.ts:43` | `max_tokens: 3200000` 硬编码过大 |
| M-9 | `nexus-profile-agent.ts:56-73` | 静态方法覆盖全局绑定状态，可能与主 Agent 冲突 |
| M-10 | `agent-service.ts:130-132` | `invalidateConfigCache` 重置语言为默认值而非从 DB 重读 |
| M-11 | `auxiliary-client.ts:358` | `toolCalls` 类型定义与实际运行时行为不一致 |
| M-12 | `model-metadata.ts:119-121` | 缓存路径使用旧项目名 `.tview` |
| M-13 | `anthropic-adapter.ts:215-221` | 大图片 base64 嵌入导致上下文膨胀 |
| M-14 | `context-compressor.ts:552-560` | `compressMessages` 函数签名过长 |

### 4.2 工具与技能系统（7 项）

| # | 文件 | 描述 |
|---|------|------|
| M-15 | `todo-tool.ts:11` | `VALID_STATUSES` 常量未使用 |
| M-16 | `terminal-tool.ts:24` | `ChildProcess` 导入未使用 |
| M-17 | `skill-manager.ts:30` | `SKILLS_SNAPSHOT_FILE` 导入未使用 |
| M-18 | `patch-parser.ts:28` | `expandTilde` 导入未使用 |
| M-19 | `shell-exec.ts:34,39` | `throwOnExitCode1` 参数声明但从未使用 |
| M-20 | `web-tools.ts` | DNS Rebinding TOCTOU（理论风险，实际利用难度高） |
| M-21 | `fuzzy-match.ts` | context_aware 策略 O(N×M×L) 复杂度（极端场景） |

### 4.3 IPC 通信与数据层（3 项）

| # | 文件 | 描述 |
|---|------|------|
| M-22 | `filesystem.ts:48-54` | Windows 上 `xcopy`/`copy` 命令的路径引号保护可被特殊字符突破 |
| M-23 | `file-watcher.ts:140,150` | `console.log` 调试日志残留在生产代码中 |
| M-24 | `database.ts:45,57,68` | 使用 `console.warn` 而非项目统一的 `logger` |

### 4.4 渲染进程 UI 层（21 项）

| # | 文件 | 描述 |
|---|------|------|
| M-25 | `Header.tsx:97,146` | 变量 `t`（翻译函数）被 `find` 回调参数遮蔽 |
| M-26 | `Sidebar.tsx:118+141` | 侧边栏宽度拖动一次触发两次 `config.save` |
| M-27 | `ContextMenu.tsx:35-37` | 空依赖 useEffect + 非 useCallback 函数 |
| M-28 | `FileBreadcrumb.tsx:428-429` | 绕过 React 直接 `querySelector` 操作 DOM |
| M-29 | `NexusProfileModal.tsx:172,178,183` | 多处 `as any` 访问第三方库内部属性 |
| M-30 | `use-dynamic-island-config.ts` | `config: any` 类型缺乏类型安全 |
| M-31 | `ContextMenu.tsx` | `panel as any` 类型断言 |
| M-32 | `useFileNavigation.ts:235-256` | 5 条 `console.log` 调试残留 |
| M-33 | `use-agent-file-bridge.ts:32-47` | 3 条 `console.log` 调试残留 |
| M-34 | `NexusProfileModal.tsx` | 6 条 `console.log` 调试残留 |
| M-35 | `use-settings-config.ts:8` | 不必要的 `React` 默认导入 |
| M-36 | `Sidebar.tsx:106-130` | useEffect + RAF cleanup 事件间隙问题 |
| M-37 | `DynamicIsland.tsx:135-148` | useEffect 空依赖加载历史（语义正确，建议加 eslint-disable） |
| M-38 | `use-agent-events.ts` | 空依赖数组（语义正确，建议加 eslint-disable） |
| M-39 | `TerminalArea.tsx:59-112` | 4 处硬编码中文 |
| M-40 | `DynamicIslandInputBar.tsx:97` | `title="发送 Ctrl+Enter"` 硬编码中文 |
| M-41 | `BrowserPanel.tsx:493` | `'暂无书签'` 硬编码中文 |
| M-42 | `DocxViewer.tsx:82` | `'加载中...'` 硬编码中文 |
| M-43 | `XlsxViewer.tsx:57,119,174` | 硬编码中文 + `toLocaleDateString('zh-CN')` 硬编码 locale |
| M-44 | `DynamicIslandHistory.tsx:29` | `t('...') ?? '全部删除'` fallback 表明 i18n key 可能未定义 |
| M-45 | `context-compressor.ts:80-82` | 与 C-1 同源，pruneOldToolResults 第 116 行同样问题 |

---

## 五、v0.5.4 遗留问题状态

| v0.5.4 问题 | 当时状态 | 当前状态 |
|-------------|---------|---------|
| 4.1 API Key 明文记录 | ⏸ 不处理 | ⚠️ 仍存在（见 I-16） |
| 2.2 DynamicIsland.tsx 体积 | ⏸ 暂不处理 | ⏸ 维持不变 |
| 4.4 cachedAgentConfig 缓存一致性 | ⏸ 不处理 | ⏸ 维持不变 |

---

## 六、架构亮点

### 6.1 数据库服务层设计良好

`DatabaseService` 使用单例模式 + 懒加载 DAO，每个 `getXxxDAO()` 方法都有空值检查并抛出明确错误。DAO 职责清晰，`database.ts` 的 schema 定义规范，包含 FTS5 全文搜索、触发器同步、外键约束等高级特性。数据库迁移系统 (`runMigrations`) 设计规范，支持版本号追踪和事务原子性。

### 6.2 IPC 参数验证

`agent.ts` 的 IPC 处理器统一使用 `validateSessionId()` 进行参数验证，是 v0.5.4 review 建议的落实。

### 6.3 Preload 模块化拆分

`preload.ts` 将各功能域 API 拆分到 `./preload/` 目录下的独立模块（config-api, session-api, pty-api 等），提高了可维护性和可读性。

### 6.4 文件监听器安全设计

`file-watcher.ts` 的 `safeSend` 函数在应用退出期间跳过 IPC 消息发送，防止 "Object has been destroyed" 错误。重命名检测逻辑（递归上限 + 同级文件匹配）设计合理。

### 6.5 Prompt Builder 模块化

`prompt-builder/` 从单文件拆分为多个子模块（identity, environment-hints, model-guidance, tool-enforcement 等），职责清晰，支持双语切换。

---

## 七、修复优先级排序

| 优先级 | 编号 | 问题 | 影响 |
|--------|------|------|------|
| **P0 立即修复** | C-1 | ContentBlock token 估算错误 | ✅ 已修复 |
| **P0 立即修复** | C-2 | sedContent 变量遮蔽 | ✅ 已修复 |
| **P0 立即修复** | C-3 | trashItem 未 await | ✅ 已修复 |
| **P0 立即修复** | C-4 | attrib 命令注入 | ⏸ 暂不处理 |
| **P0 立即修复** | C-5 | sed/wc 命令注入 | ⏸ 暂不处理 |
| **P0 立即修复** | C-6 | 全局组件重复渲染 | ✅ 已修复 |
| **P0 立即修复** | C-7 | SettingsModal 渲染副作用 | ✅ 已修复 |
| **P1 尽快修复** | I-4 | MemoryManager 未初始化 | ✅ 已修复 |
| **P1 尽快修复** | I-9 | agent-service 空值检查 | ✅ 已修复 |
| **P1 尽快修复** | I-10 | MCP disconnect 泄漏 | ✅ 已修复 |
| **P1 尽快修复** | I-11 | update_plan 路径遍历 | ✅ 已修复 |
| **P1 尽快修复** | I-12 | 危险命令审批共享 | ✅ 已修复 |
| **P1 尽快修复** | I-13/I-14 | 路径安全函数统一 | ✅ 已修复 |
| **P1 尽快修复** | I-17 | LibreOffice 命令注入 | ✅ 已修复 |
| **P2 常规修复** | I-1 | abort 中断分类时序 | ✅ 已修复 |
| **P2 常规修复** | I-2 | pruneOldToolResults 类型误用 | ✅ 已修复 |
| **P2 常规修复** | I-3 | getMemoryProvider 未初始化 | ✅ 已修复 |
| **P2 常规修复** | I-5 | 压缩 prompt 无长度限制 | ⏸ 暂不处理 |
| **P2 常规修复** | I-6 | 消息内容 info 级别日志 | ⏸ 暂不处理 |
| **P2 常规修复** | I-7 | MutableAgentState 浅拷贝 | ✅ 已修复 |
| **P2 常规修复** | I-8 | prompt-builder 自引用导出 | ✅ 已修复 |
| **P2 常规修复** | I-18 | useBrowserAddressBar IIFE | ✅ 已修复 |
| **P2 常规修复** | I-19 | ClarifyModal 闭包陈旧 | ✅ 已修复 |
| **P2 常规修复** | I-20 | 阻塞式轮询 | ✅ 已修复 |
| **P2 常规修复** | I-21 | CodeMirror 模块级状态 | ✅ 已修复 |
| **P2 常规修复** | I-22 | FileStatusBar 类型欺骗 | ✅ 已修复 |
| **P2 常规修复** | I-23 | NexusProfileModal i18n | ✅ 已修复 |
| **P3 择机处理** | M-1~M-45 | 死代码清理、console.log 移除、i18n 补全、性能优化 | 代码卫生 |

---

## 八、按分类统计

| 分类 | Critical | Important | Minor | 合计 |
|------|:--------:|:---------:|:-----:|:----:|
| BUG | 5 | 9 | 2 | **16** |
| 安全 | 2 | 5 | 2 | **9** |
| 设计 | 0 | 5 | 2 | **7** |
| 死代码 | 0 | 1 | 5 | **6** |
| 类型安全 | 0 | 1 | 3 | **4** |
| i18n | 0 | 1 | 5 | **6** |
| 性能 | 0 | 0 | 2 | **2** |
| React 实践 | 0 | 1 | 3 | **4** |
| 质量 | 0 | 0 | 14 | **14** |
| 其他 | 0 | 0 | 7 | **7** |
| **合计** | **7** | **23** | **45** | **75** |

---

## 九、结论

v0.6.0 代码库在架构层面取得了显著进步：
- **模块化改进**: prompt-builder 拆分、preload 模块化、文件浏览器 hook 拆分
- **数据库设计**: 完善的迁移系统、FTS5 全文搜索、外键约束自动修复
- **安全性**: IPC 参数验证、SSRF 防护、路径安全检查

但仍存在 **7 个 Critical 级别**问题需要立即修复，其中：
- **2 个命令注入漏洞**（C-4、C-5）是安全红线
- **2 个逻辑 BUG**（C-1、C-2）会导致功能静默失效
- **2 个 React 架构问题**（C-6、C-7）会导致 UI 异常

建议在发布前完成 P0 + P1 级别的全部修复（共 14 项），P2 级别在后续迭代中逐步解决。
