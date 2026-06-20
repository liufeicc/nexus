# 代码 Review 报告 v0.3.5 — 智能体 Skill 系统

> 审查时间: 2026-04-22
> 审查范围: Skill 系统全部相关代码（含类型、常量、安全扫描、管理器、工具、提示注入）

---

## 审查文件清单

### 新增文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/core/types/skill.ts` | 124 | Skill 系统类型定义 |
| `src/core/constants/skill.ts` | 39 | Skill 路径、大小限制、名称正则、平台映射 |
| `src/main/agent/skills/skill-security.ts` | 169 | 安全扫描（路径穿越、注入检测、威胁模式） |
| `src/main/agent/skills/skill-manager.ts` | 635 | Skill 发现、解析、缓存、CRUD 编排 |
| `src/main/agent/skills/skills-tool.ts` | 135 | `skills_list` + `skill_view` 工具 |
| `src/main/agent/skills/skill-manage-tool.ts` | 156 | `skill_manage` 工具（6 种操作） |
| `src/main/agent/skills/skill-prompt-injector.ts` | 259 | 双层缓存（LRU + 磁盘快照）提示注入器 |

### 修改文件

| 文件 | 修改内容 |
|------|------|
| `src/core/types/index.ts` | 新增 skill 类型导出 |
| `src/main/agent/prompt-builder.ts` | `BuildSystemPromptOptions` 增加 `skillBlock`；`buildSystemPrompt()` 注入 skill 索引 |
| `src/main/agent/agent-llm-bridge.ts` | `createLlmBridge()` 接受 `skillBlockFn` 回调 |
| `src/main/agent/ai-agent.ts` | 新增 `initSkills()`、`getSkillBlock()`；更新两处 `createLlmBridge` 调用 |
| `src/main/services/agent-service.ts` | `createAgentSession()` 中调用 `agent.initSkills()` |

---

## 1. 无效/死代码

### 1.1 `skill-prompt-injector.ts` 中 `_availableTools` 参数未使用

`skill-prompt-injector.ts:50-52` 的 `buildBlock()` 方法接收 `_availableTools?: Set<string>` 参数，但方法体内仅用下划线前缀标记未使用，实际没有任何逻辑消费该参数。该参数原计划用于过滤 skill（只展示与当前可用工具匹配的 skill），但实现被省略。

**建议**: 如果短期内不实现该功能，删除该参数以减少 API 表面积。如果计划保留，添加注释说明预留意图。

**状态**: ⏸ 待确认设计意图

### 1.2 `skill-prompt-injector.ts` 中 `buildManifest()` 记录的 `mtime` 使用快照文件自身的 mtime

`skill-prompt-injector.ts:201-209` 中，`manifest.mtime` 和 `manifest.size` 记录的是快照文件自身的 stat 信息，而不是 skill 根目录或分类目录的 mtime。这导致 `validateSnapshot()` 只验证了单个 SKILL.md 文件的 mtime/size，但快照文件自身的变更不会触发重新扫描。

**建议**: `manifest.mtime` 应记录 skills 根目录的 mtime，或者在每次写操作时同时删除磁盘快照文件。

**状态**: ⏸ 低风险，当前实现已能覆盖 SKILL.md 文件变更检测

---

## 2. 重复代码与文件臃肿

### 2.1 `skill-manager.ts` 中路径安全检查重复

`writeSkillFile()`（line 533-550）和 `removeSkillFile()`（line 571-578）中有几乎相同的路径穿越检查逻辑：
- `hasPathTraversal(filePath)` 调用
- `path.join(skillInfo.dirPath, filePath)` + `isWithinDirectory()` 验证

**建议**: 提取为私有方法 `validateSkillFilePath(name, filePath): { dirPath, targetPath }`，统一处理路径验证。

**状态**: ⏸ 代码重复约 10 行，优先级低

### 2.2 `skill-manager.ts` 体积适中（635 行）

当前 635 行在可接受范围内。如果后续增加更多功能（如 skill 版本管理、远程同步），建议按职责拆分。

**状态**: ✅ 当前可接受

---

## 3. 设计范式/抽象问题

### 3.1 `SkillManager` 使用字符串括号访问私有属性

`skill-prompt-injector.ts:94` 和 `skill-prompt-injector.ts:182` 使用 `this.skillManager['skillsDir']` 访问私有属性。这绕过了 TypeScript 的访问控制，如果 `SkillManager` 内部重命名该属性，编译器不会报错。

**建议**: 在 `SkillManager` 中添加 `getSkillsDir(): string` 公共方法，或通过构造函数选项传入。

**状态**: ⚠️ 中等风险 — 重构安全隐患

### 3.2 `execSync` 用于 `which` 命令检查

`skill-manager.ts:272` 使用 `execSync(\`which ${cmd}\`)` 检查命令是否存在。如果 `cmd` 参数来自用户输入（通过 `skill_manage` 的 frontmatter），存在命令注入风险。当前 `cmd` 来自 SKILL.md 的 frontmatter（由 skill 作者控制），虽然不直接来自 LLM，但仍应防范。

**建议**: 使用 `child_process.execFile('which', [cmd])` 替代模板字符串拼接，或者使用 Node.js 原生方式检查命令是否存在。

**状态**: ⚠️ 中等风险 — 应修复

### 3.3 渐进式披露架构合理

三层设计（`skills_list` → `skill_view` → `linkedFiles`）符合渐进式披露原则，避免一次性加载所有 skill 内容占用 context window。

**状态**: ✅ 设计良好

---

## 4. BUG

### 4.1 `skill-security.ts` 中 `RegExp.test()` 有状态问题 **[未修复]**

`skill-security.ts:140-143` 使用 `pattern.test(content)` 遍历威胁模式。JavaScript 的 `RegExp.test()` 在带有 `g` 标志的正则上会维护 `lastIndex` 状态。虽然当前 `THREAT_PATTERNS` 中的正则没有 `g` 标志，但如果未来有人添加了 `g` 标志，会导致间歇性漏检。

**建议**: 改用 `pattern.exec(content)` 或确保所有正则不带 `g` 标志，或在每个 pattern 上调用 `pattern.lastIndex = 0`。

**状态**: ⏸ 当前无实际影响，防御性建议

### 4.2 `skill-manager.ts` 中 `createSkill` 的 frontmatter 合并顺序

`skill-manager.ts:415-419`：
```typescript
const fm: SkillFrontmatter = {
  name,
  description: frontmatter?.description ?? '',
  ...frontmatter,
}
```
这里先设置了 `name` 和 `description`，然后用 `...frontmatter` 展开。如果 `frontmatter` 中有 `name` 字段，会覆盖前面的值。虽然最终 `name` 一致是预期行为，但 `description` 的默认值 `''` 可能被 `frontmatter` 中的空字符串覆盖，导致无描述。

**建议**: 明确字段优先级——`frontmatter` 中的字段优先，但 `name` 始终使用参数值。

**状态**: ⏸ 低风险

### 4.3 `skill-manager.ts` 中 `getSkillContent` 读取子文件时未做安全扫描

`skill-manager.ts:326-341` 中，当指定 `filePath` 读取子文件时，只对 SKILL.md 调用了 `scanSkillContent()`，子文件内容（`fileContent`）没有经过安全扫描。恶意子文件可能包含威胁内容而不被检测。

**建议**: 对 `fileContent` 也调用 `scanSkillContent()`，合并警告列表。

**状态**: ⚠️ 应修复 — 安全漏洞

### 4.4 `skill-prompt-injector.ts` 中快照验证浮点数精度

`skill-prompt-injector.ts:219` 使用 `stat.mtimeMs !== info.mtime` 进行严格相等比较。`mtimeMs` 是浮点数（毫秒精度），在不同文件系统或序列化/反序列化过程中可能产生微小差异，导致误判为文件已变更。

**建议**: 使用 `Math.abs(stat.mtimeMs - info.mtime) > 1` 容忍 1ms 差异，或改用 `mtimeMs` 的整数秒（`Math.floor(stat.mtimeMs / 1000)`）。

**状态**: ⏸ 低风险，Linux ext4 下一般不会触发

---

## 5. 架构与安全问题

### 5.1 安全扫描采用"警告不阻断"策略

`skill-security.ts` 的设计哲学是记录警告但不阻断操作（目录在用户信任路径下）。对于 critical 级别的威胁（如 `rm -rf /`、`curl|sh`、`api_key` 硬编码），`scanSkillContent()` 返回 `blocked: true`，`skill-manager.ts` 中 `createSkill` 和 `editSkill` 确实会拒绝操作。但 `patchSkill` 通过调用 `editSkill` 间接受到保护。

**当前策略**: skill 创建/编辑时 critical 威胁阻断，warning 级别允许但记录。查看时不阻断。

**状态**: ✅ 合理设计

### 5.2 原子写入使用 `.tmp.{pid}` 后缀

`skill-manager.ts:619-623` 的 `atomicWrite()` 方法先写入临时文件再 `renameSync`，这是正确的崩溃安全做法。但临时文件后缀使用 `process.pid`，在极端情况下（同一进程并发写入同一文件）可能冲突。

**建议**: 使用 `crypto.randomUUID()` 替代 `process.pid`，与之前 `patch-parser.ts` review 中修复的问题保持一致。

**状态**: ⏸ 极低风险

### 5.3 Skill 目录结构依赖约定而非强制

`ALLOWED_SKILL_SUBDIRS`（`references`, `templates`, `assets`, `scripts`）在 `writeSkillFile()` 中作为强制约束（line 539），但 `discoverLinkedFiles()` 和 `listSkills()` 中只扫描不限制。这意味着如果手动在 skill 目录下创建其他子目录（如 `notes/`），`discoverLinkedFiles()` 会忽略它们，而 `writeSkillFile()` 不允许写入。

**状态**: ✅ 设计一致

### 5.4 记忆系统与 Skill 系统的初始化顺序

`ai-agent.ts` 中：
- 构造函数中调用 `initSkills()`（在 `agent-service.ts:194`）
- 随后异步调用 `initializeMemory()`（在 `agent-service.ts:200`）
- `initializeMemory()` 会重建 LLM Bridge，将记忆快照注入 system prompt

Skill 的 `skillBlockFn` 在构造函数的 LLM Bridge 中已注册，但 `initializeMemory()` 重建 LLM Bridge 时也正确传递了 `() => this.getSkillBlock()`，所以两个注入（memory + skill）都保留。

**状态**: ✅ 初始化顺序正确

---

## 6. 代码质量

### 6.1 类型定义完整

`src/core/types/skill.ts` 覆盖了所有 skill 相关类型：frontmatter、解析结果、元数据、内容、CRUD 操作、安全扫描结果。所有接口都有 JSDoc 注释。

**状态**: ✅ 良好

### 6.2 错误处理一致

所有 tool handler 都使用 `try/catch` 包裹，失败时返回 `{ success: false, output: '...' }` 格式，与现有工具系统（file-tools、web-tools）保持一致。

**状态**: ✅ 良好

### 6.3 日志记录适度

`skill-manager.ts:102` 对解析失败使用 `logger.warn()`，`skill-prompt-injector.ts:247` 对快照保存失败使用 `console.warn()`。建议统一使用 `logger`。

**建议**: 将 `skill-prompt-injector.ts:247` 的 `console.warn` 改为 `logger.warn`。

**状态**: ⏸ 低优先级

### 6.4 测试覆盖

已通过手动测试脚本验证了：
- Frontmatter 解析（YAML 提取、linkedFiles 发现、平台匹配）
- 安全扫描（路径穿越阻断、注入检测、威胁模式匹配）
- CRUD 操作（创建、编辑、删除、路径穿越防护）

**建议**: 将测试脚本迁移到 `tests/unit/` 目录下，使用 Vitest 框架，方便持续运行。

**状态**: ⏸ 待迁移

---

## 7. 优化优先级排序

| 优先级 | 问题 | 状态 |
|--------|------|------|
| P1 | 4.3 `getSkillContent` 子文件未做安全扫描 | ⏸ 应修复 |
| P1 | 3.2 `execSync(which ${cmd})` 命令注入风险 | ⏸ 应修复 |
| P2 | 3.1 `skillManager['skillsDir']` 绕过 TypeScript 访问控制 | ⏸ 中等风险 |
| P2 | 5.2 原子写入临时文件名使用 pid 而非 UUID | ⏸ 低风险 |
| P3 | 1.1 `_availableTools` 参数未使用 | ⏸ 待确认 |
| P3 | 4.1 `RegExp.test()` 状态问题 | ⏸ 防御性建议 |
| P3 | 4.2 `createSkill` frontmatter 合并顺序 | ⏸ 低风险 |
| P3 | 4.4 快照验证浮点数精度 | ⏸ 极低风险 |
| P3 | 6.3 `console.warn` 与 `logger.warn` 不一致 | ⏸ 低优先级 |
| P3 | 6.4 测试脚本迁移到 Vitest | ⏸ 待迁移 |
