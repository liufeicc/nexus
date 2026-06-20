# 代码 Review 报告 v0.3.11 — 智能体（Agent）

> 审查时间: 2026-04-23
> 审查范围: 智能体全部相关代码

---

## 审查文件清单

### 核心文件

| 文件 | 行数 | 说明 |
|------|------|------|
| `ai-agent.ts` | ~460 | AIAgent 类（配置/组件管理/运行编排） |
| `agent-loop.ts` | ~375 | 主运行循环（while 循环、压缩检测、LLM调用、工具执行、错误处理） |
| `agent-llm-bridge.ts` | ~120 | LLM 调用桥接（系统提示构建、流式/非流式调用） |
| `agent-tool-execution.ts` | ~125 | 工具执行（并行执行、结果追加） |
| `agent-events.ts` | ~75 | 事件管理系统 |
| `llm-client.ts` | ~830 | LLM 客户端（OpenAI + Anthropic） |
| `context-compressor.ts` | ~690 | 上下文压缩器 |
| `prompt-builder.ts` | ~355 | 系统提示构建器 |
| `tool-registry.ts` | ~210 | 工具注册系统 |
| `session-state.ts` | ~105 | 会话级状态（TodoStore、读取缓存、搜索跟踪） |

### Skill 系统

| 文件 | 行数 | 说明 |
|------|------|------|
| `skills/skill-manager.ts` | ~730 | Skill 发现/解析/缓存/CRUD |
| `skills/skill-prompt-injector.ts` | ~165 | Skill 索引构建（双层缓存） |
| `skills/skills-tool.ts` | ~145 | skills_list / skill_view 工具 |
| `skills/skill-manage-tool.ts` | ~155 | skill_manage 工具 |
| `skills/skill-security.ts` | ~150 | 安全扫描（路径遍历、prompt注入、威胁模式） |
| `skills/skill-snapshot-cache.ts` | ~135 | 磁盘快照缓存 |

### Memory 系统

| 文件 | 行数 | 说明 |
|------|------|------|
| `memory/memory-manager.ts` | ~480 | 记忆系统编排器 + SQLite Provider |

---

## 1. BUG

### 1.1 `skill-manager.ts` 中 `patchSkill` 双重写锁导致永远失败 **[P0]**

`skill-manager.ts:553` 中 `patchSkill()` 先调用 `tryAcquireWriteLock(name)` 获取写锁，然后在 line 578 内部调用 `this.editSkill(name, newContent)`。而 `editSkill` 在 line 507 也会调用 `tryAcquireWriteLock(name)`。

由于 `writeLocks` 是一个 `Set<string>`，`tryAcquireWriteLock` 检查 `has(name)` 时，name 已经在集合中（被 `patchSkill` 自己加的），所以返回 `false`，导致 `editSkill` 返回错误：

```
"Skill 正在被其他会话编辑: {name}"
```

**影响**: `patchSkill` 功能完全不可用，任何 patch 操作都会失败。

**修复建议**: `patchSkill` 应该内联写入逻辑而不是调用 `editSkill`，或者使用可重入锁（如记录持有者身份 + 引用计数的锁）。

### 1.2 `agent-loop.ts` 中 `handleError` 的 `cooldownUntil` 未同步更新 **[P1]**

`agent-loop.ts:316-321` 中，`handleError` 处理 `context_too_long` 时调用了 `compressMessages`，但 `compressMessages` 返回的 `summaryFailureCooldownUntil` 没有被回写到 `deps.summaryFailureCooldownUntil`。

同时，`checkAndCompress`（line 272-294）也存在同样的问题：`compressMessages` 返回的新冷却时间没有被更新到依赖中。

**影响**: 冷却机制形同虚设。如果辅助 LLM 生成摘要失败，冷却时间不会被记录，下次压缩会再次触发失败的 LLM 调用，浪费资源。

**修复建议**: 在 `deps` 中添加 `setSummaryFailureCooldownUntil` 回调，在 `checkAndCompress` 和 `handleError` 中同步更新。

### 1.3 `skill-prompt-injector.ts` 使用私有属性访问 `skillManager['skillsDir']` **[P1]**

`skill-prompt-injector.ts:28` 和 `skill-prompt-injector.ts:72` 通过 `skillManager['skillsDir']` 直接访问 `SkillManager` 的私有属性 `skillsDir`。

**影响**: 破坏了封装性，如果 `SkillManager` 重构属性名，这里会静默失败。

**修复建议**: 在 `SkillManager` 中添加 `get skillsDir(): string` getter。

### 1.4 `memory-manager.ts` 中 `handleReplace` 未同步更新 `memory_facts` **[P2]**

`memory-manager.ts:278-302` 的 `handleReplace` 只更新了 `memory_entries` 表，但没有同步更新 `memory_facts` 表。

**影响**: 如果用户替换了一条记忆，FTS5 全文搜索仍然会返回旧内容，导致记忆搜索结果不一致。

**修复建议**: 在 `handleReplace` 中先删除旧的 fact 记录，再插入新的。

### 1.5 `ai-agent.ts` 中 `reset()` 后记忆系统无法重建 **[P2]**

`ai-agent.ts:452` 中 `reset()` 调用了 `shutdownAll()` 并将 `this.memoryManager = null`。但后续调用 `run()` 时，记忆系统不会被重新初始化——只有显式调用 `initializeMemory()` 才能重建。

**影响**: 如果外部在 `reset()` 后直接调用 `run()`，记忆功能将完全丢失，且无日志提示。

**修复建议**: 在 `run()` 开始时检查 `memoryManager` 是否为 null，如果是且 `nexusSessionId` 存在，则自动重建。

---

## 2. 无效/潜在死代码

### 2.1 `summaryFailureCooldownUntil` 冷却时间从未被写入 **[P2]**

`agent-loop.ts:117` 定义了 `summaryFailureCooldownUntil`，但 `RunLoopDeps` 接口中没有对应的 setter。`checkAndCompress` 和 `handleError` 中 `compressMessages` 返回的新冷却时间被忽略。

**影响**: 冷却机制完全失效。

### 2.2 `agent-loop.ts` 中 `buildUserMessageContent` 不支持非图片附件 **[P3]**

当前只处理 `file.type === 'image'`，如果未来支持 PDF 或其他文件类型，需要扩展 `ContentBlock` 类型。

---

## 3. 安全问题

### 3.1 `skill-security.ts` 威胁模式检测存在误报和漏报 **[P3]**

- **误报**: `eval_exec` 正则 `/\b(eval|exec)\s*\(/i` 会匹配大量正常代码。`sudo` 正则 `/\bsudo\b/` 会匹配几乎所有包含 sudo 说明的文档。
- **漏报**: 没有检测 `wget -O file && chmod +x file && ./file` 这类常见模式。

当前设计是"记录警告但不阻断"（除 critical 级别），所以误报不会导致功能问题，但会产生噪音。

### 3.2 `skill-manager.ts` 中 `execSync` 用于命令检查 **[P3]**

`skill-manager.ts:279` 使用 `execSync(checkCmd, { stdio: 'ignore' })` 检查命令是否存在。如果 frontmatter 中的 `commands` 列表被恶意 skill 注入（如 `"; rm -rf /`），`execSync` 会执行它。

**修复建议**: 使用 `child_process.spawn` 并验证命令名不包含 shell 元字符。

### 3.3 `skill-manager.ts` 中 `writeSkillFile` 不扫描内容安全 **[P3]**

`writeSkillFile`（line 610-650）只检查路径合法性和文件大小，不对文件内容进行 `scanSkillContent` 扫描。如果用户通过该接口写入恶意脚本到 `scripts/` 子目录，不会被检测。

**修复建议**: 在 `writeSkillFile` 中添加 `scanSkillContent` 调用。

---

## 4. 架构优化建议

### 4.1 `SkillSnapshotCache.buildManifest` 与 `SkillManager.scanSkillsDirectory` 重复 **[P3]**

两处都递归扫描 skills 目录找 SKILL.md。可以考虑抽取共享的文件发现函数。

### 4.2 `MemoryManager.prefetch` 错误处理过于静默 **[P3]**

`memory-manager.ts:440-445` 中 prefetch 失败被 `.catch(() => {})` 静默吞掉。虽然是预热，但如果一直失败应该有日志输出。

---

## 5. 优先级排序

| 优先级 | 问题 | 状态 |
|--------|------|------|
| P0 | 1.1 `patchSkill` 双重写锁导致永远失败 | 待修复 |
| P1 | 1.2 `handleError` 中 `cooldownUntil` 未同步 | 待修复 |
| P1 | 1.3 `skillManager['skillsDir']` 私有属性访问 | 待修复 |
| P2 | 1.4 `handleReplace` 未同步更新 `memory_facts` | 待修复 |
| P2 | 1.5 `reset()` 后记忆系统无法重建 | 待修复 |
| P2 | 2.1 `summaryFailureCooldownUntil` 冷却时间从未写入 | 待修复（与 1.2 同源） |
| P3 | 3.1 `skill-security` 威胁模式误报/漏报 | 可优化 |
| P3 | 3.2 `execSync` 命令检查潜在注入 | 可优化 |
| P3 | 3.3 `writeSkillFile` 不扫描内容安全 | 可优化 |
| P3 | 4.1 目录扫描逻辑重复 | 可优化 |
| P3 | 4.2 `prefetch` 错误处理过于静默 | 可优化 |

---

## 7. 修复记录（2026-04-23）

### 已修复

| 问题 | 修复方案 | 修改文件 |
|------|----------|----------|
| 1.1 `patchSkill` 双重写锁（P0） | `patchSkill` 内联写入逻辑，不再调用 `editSkill` | `skill-manager.ts` |
| 1.2 `cooldownUntil` 未同步（P1） | `compressMessages` 返回值新增 `newSummaryFailureCooldownUntil`；`RunLoopDeps` 添加 `setSummaryFailureCooldownUntil` 回调 | `context-compressor.ts`, `agent-loop.ts`, `ai-agent.ts` |
| 2.1 冷却时间从未写入（P2） | 与 1.2 同源，随 1.2 一并修复 | 同上 |
| 1.3 私有属性访问（P1） | `skillsDir` 重命名为 `_skillsDir`，添加 `get skillsDir()` getter | `skill-manager.ts`, `skill-prompt-injector.ts` |
| 1.4 `handleReplace` 未同步 `memory_facts`（P2） | `handleReplace` 中先 `deleteFactByUuid` 再 `insertFact`；DAO 新增 `deleteFactByUuid` 方法 | `memory-manager.ts`, `memory.dao.ts` |
| 1.5 `reset()` 后记忆系统无法重建（P2） | `run()` 开始时检查 `memoryManager` 是否为 null，自动重建 | `ai-agent.ts` |
| 2.2 非图片附件不支持（P3） | `buildUserMessageContent` 新增 text/other 类型处理 | `agent-loop.ts` |
| 4.1 目录扫描逻辑重复（P3） | `SkillManager` 新增 `discoverSkillFiles()` 公共方法；`buildManifest` 接受可选文件列表 | `skill-manager.ts`, `skill-snapshot-cache.ts`, `skill-prompt-injector.ts` |
| 4.2 `prefetch` 静默吞异常（P3） | 移除调用处的 `.catch(() => {})`，保留方法内部 `logger.warn` | `ai-agent.ts` |

### 未修复（待后续优化）

| 问题 | 原因 |
|------|------|
| 3.1 `skill-security` 威胁模式误报/漏报 | 当前"记录警告但不阻断"的设计下不影响功能，可后续优化正则 |
| 3.2 `execSync` 命令检查潜在注入 | 需改为 `spawn` + 命令名验证，有一定改动量 |
| 3.3 `writeSkillFile` 不扫描内容安全 | 需添加 `scanSkillContent` 调用，改动小 |

---

## 6. 与 v0.3.4 Review 对比

| v0.3.4 问题 | v0.3.11 状态 |
|-------------|-------------|
| 4.5 qwen max_tokens 可能不准确 | ⏸ 仍待确认部署配置 |
| 其他所有已修复项 | ✅ 保持正常 |

v0.3.11 相比 v0.3.4 新增了 Skill 系统（6个文件）和 Memory 系统（1个文件），整体架构清晰。最严重的 BUG 是 `patchSkill` 的双重写锁问题（P0），**已修复**。其余 9 个问题也已修复，仅剩 3 个 P3 安全问题待后续优化。
