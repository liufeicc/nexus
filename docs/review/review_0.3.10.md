# 代码 Review 报告 v0.3.10 — Skill 系统

> 审查时间: 2026-04-22
> 审查范围: Skill 系统全部相关代码（含管理器、工具、安全扫描、prompt 注入）
> 审查版本: v0.3.10（基于提交 360a581 ~ 06dfcb5，共 11 次提交）
> 修复状态: 全部 16 个问题已修复或确认跳过

---

## 审查文件清单

### 核心文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/core/types/skill.ts` | 123 | Skill 类型定义（frontmatter、元数据、内容、CRUD、安全扫描） |
| `src/core/constants/skill.ts` | 40 | Skill 系统常量（含 dev/prod 目录分离） |
| `src/main/agent/skills/skill-manager.ts` | ~650 | Skill 管理器（发现、解析、缓存、CRUD、写锁） |
| `src/main/agent/skills/skill-snapshot-cache.ts` | ~100 | 磁盘快照缓存（load/save/validate/符号链接检查） |
| `src/main/agent/skills/skill-security.ts` | ~160 | 安全扫描模块（路径遍历、威胁模式检测） |
| `src/main/agent/skills/skill-prompt-injector.ts` | ~160 | 提示注入器（LRU 缓存 + skill 索引构建） |

### 工具文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/main/agent/skills/skills-tool.ts` | ~140 | Skill 查询工具（含路径安全预检） |
| `src/main/agent/skills/skill-manage-tool.ts` | 155 | Skill 管理工具 |

### 测试文件

| 文件 | 测试数 | 覆盖范围 |
|------|--------|----------|
| `tests/unit/skill-manager.spec.ts` | 16 | parseSkillMd、frontmatter 验证、CRUD、写锁、缓存 |
| `tests/unit/skill-security.spec.ts` | 15 | 路径遍历、目录隔离、内容安全扫描 |

---

## 1. 无效/死代码

### 1.1 `skill-prompt-injector.ts` 中 `_availableTools` 参数未使用 ~~[需修复]~~

~~`buildBlock()` 方法接收 `_availableTools?: Set<string>` 参数，下划线前缀表明有意标记为未使用。~~

**状态: ✅ 已修复** — 已从 `buildBlock()` 和 `makeCacheKey()` 中删除 `_availableTools` 参数。

### 1.2 `skill-manager.ts` 中 `buildSkillMeta()` 的 `_skill_dir` 参数未使用 ~~[需修复]~~

~~`buildSkillMeta()` 方法接收 `_skill_dir` 参数但从未使用。~~

**状态: ✅ 已修复** — 已删除 `_skill_dir` 参数。

---

## 2. 重复代码与文件臃肿

### 2.1 `skill-manager.ts` 中路径安全检查重复 ~~[需修复]~~

~~`getSkillContent()`、`writeSkillFile()`、`removeSkillFile()` 三处都执行了相同的路径安全检查模式。~~

**状态: ✅ 已修复** — 已提取 `validateSkillFilePath(filePath, dirPath)` 私有辅助方法，统一处理路径校验。

### 2.2 `skill-security.ts` 中 `detectPromptInjection()` 与 `THREAT_PATTERNS` 重复 ~~[需修复]~~

~~`detectPromptInjection()` 使用 `INJECTION_PATTERNS` 字符串数组检测，而 `THREAT_PATTERNS` 也有正则形式的 injection 检测。~~

**状态: ✅ 已修复** — 已删除 `INJECTION_PATTERNS` 数组和 `detectPromptInjection()` 函数，将独特模式（`disregard_your`、`forget_instructions`、`new_instructions`、`cdata_end`）合并到 `THREAT_PATTERNS` 中。

---

## 3. 设计范式/抽象问题

### 3.1 `SkillPromptInjector` 的快照 mtime 比较使用 `===` 浮点数精确匹配 ~~[需修复]~~

~~`validateSnapshot()` 使用 `stat.mtimeMs !== info.mtime` 进行浮点数精确比较。~~

**状态: ✅ 已修复** — 快照管理已提取到 `SkillSnapshotCache` 独立类（`src/main/agent/skills/skill-snapshot-cache.ts`），验证逻辑使用容差比较。

### 3.2 `SkillManager` 的 `listSkills()` 缓存与 `getSkillContent()` 无缓存不一致 ~~[需修复]~~

~~`listSkills()` 使用 30s TTL 缓存，但 `getSkillContent()` 每次都重新读取文件和执行安全扫描。~~

**状态: ✅ 已修复** — 已为 `getSkillContent()` 添加 `contentCache`（`Map<string, { content: string; expiry: number }>`），使用 30s TTL。

### 3.3 `SkillPromptInjector` 职责过重 ~~[需修复]~~

~~该类同时负责：LRU 缓存管理、磁盘快照序列化/反序列化、快照验证、文件扫描、skill 格式化。~~

**状态: ✅ 已修复** — 快照管理（load/save/validate/buildManifest + 符号链接检查）已提取为 `SkillSnapshotCache` 独立类，`SkillPromptInjector` 仅负责 LRU 缓存和 skill 索引构建。

---

## 4. BUG

### 4.1 `skill-manager.ts` 中 `checkPrerequisites()` 使用 `execSync('which')` 在 Windows 上不工作 ~~[需修复]~~

~~`which` 是 Unix 命令，在 Windows 上不存在。~~

**状态: ✅ 已修复** — 已改为根据 `process.platform` 选择检测命令：Windows 使用 `where`，Unix 使用 `which`。

### 4.2 `skill-security.ts` 中 `scanSkillContent()` 未检查路径遍历 ~~[需修复]~~

~~`scanSkillContent()` 只检查内容安全性，不包含路径验证。~~

**状态: ✅ 已修复** — 已更新 JSDoc 文档，明确说明该函数仅检查内容安全，路径验证由调用方负责。

### 4.3 `skill-prompt-injector.ts` 中 `buildManifest()` 递归扫描时未检查符号链接 ~~[需修复]~~

~~如果目录中存在符号链接指向外部路径，`statSync` 会跟随符号链接。~~

**状态: ✅ 已修复** — 在 `buildManifest()` 中添加 `fs.lstatSync()` 检查符号链接并跳过，同时使用 `fs.realpathSync()` 进行路径边界验证。

### 4.4 `skills-tool.ts` 中 `createSkillViewTool` 的 `filePath` 未做路径安全校验 ~~[需修复]~~

~~工具层没有前置验证，错误消息不够友好。~~

**状态: ✅ 已修复** — 在 `skill_view` 工具 handler 中添加前置验证：`filePath` 不能包含 `..` 组件，不能是绝对路径。

---

## 5. 架构与安全问题

### 5.1 `skill-security.ts` 威胁模式检测存在误报风险 ~~[需关注]~~

`THREAT_PATTERNS` 中的某些规则（`sudo`、`eval_exec`、`hardcoded_ip`）可能产生误报。当前设计是"记录警告但不阻断"（critical 才阻断）。

**状态: ⚠️ 用户确认暂不修改** — 误报风险可接受，后续可考虑白名单机制。

### 5.2 `SkillManager` 的 `atomicWrite` 使用 `.tmp.${process.pid}` 在高并发下可能冲突 ~~[需修复]~~

~~同 PID 在多会话并发时会产生竞态。~~

**状态: ✅ 已修复** — 已改为 `crypto.randomUUID()` 生成临时文件名。

### 5.3 Skill 系统缺少会话级隔离 ~~[需修复]~~

~~如果两个会话同时编辑同一个 skill，后写入的会覆盖先写入的。~~

**状态: ✅ 已修复** — 已添加进程内写锁（`Set<string>` + `tryAcquireWriteLock`/`releaseWriteLock`），所有 6 个 CRUD 操作使用 `try/finally` 模式确保锁释放。

### 5.4 `skill-security.ts` 中 prompt injection 检测仅支持英文模式 ~~[需修复]~~

~~所有 injection 模式都是英文的，中文 content 不会被检测到。~~

**状态: ⏭️ 用户确认跳过** — 不可能穷举所有语言的 injection 模式，当前作为防御性深度措施已足够。

---

## 6. 代码质量

### 6.1 `skill-manager.ts` 中 `parseSkillMd()` 的 regex 对 Windows 换行符处理可能不稳定 ~~[需修复]~~

~~正则对 `\r\n` 或纯 `\r` 换行符可能匹配失败。~~

**状态: ✅ 已修复** — 在解析前先规范化换行符：`content.replace(/\r\n?/g, '\n').replace(/^\n+/, '')`，使用简化正则 `/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/`。

### 6.2 `skill-prompt-injector.ts` 中 `formatSkillsIndex()` 混合了两种字段名 ~~[需修复]~~

~~从快照构建时使用 `skill_name`，从实时扫描时使用 `name`。~~

**状态: ✅ 已修复** — 定义统一 `SkillIndexEntry` 接口（`name`/`description`/`category`），`buildFromSnapshot()` 中将 `skill_name` 映射为 `name`。

### 6.3 缺少 Skill 系统单元测试 ~~[需修复]~~

~~当前没有针对 skill 系统的单元测试。~~

**状态: ✅ 已修复** — 已创建两个测试文件：
- `tests/unit/skill-manager.spec.ts`（16 个测试）：parseSkillMd、frontmatter 验证、CRUD、写锁、缓存
- `tests/unit/skill-security.spec.ts`（15 个测试）：路径遍历、目录隔离、内容安全扫描
- 全部 31 个测试通过

---

## 7. 修复状态汇总

| 优先级 | 问题 | 状态 |
|--------|------|------|
| P0 | 4.1 `which` 命令在 Windows 上不工作 | ✅ 已修复 |
| P0 | 5.2 `atomicWrite` 使用 PID 可能冲突 | ✅ 已修复 |
| P1 | 3.1 快照 mtime 浮点数精确比较 | ✅ 已修复 |
| P1 | 5.1 威胁模式误报风险 | ⚠️ 暂不修改 |
| P1 | 5.4 prompt injection 检测仅支持英文 | ⏭️ 确认跳过 |
| P2 | 2.1 路径安全检查代码重复 | ✅ 已修复 |
| P2 | 2.2 prompt injection 检测重复 | ✅ 已修复 |
| P2 | 4.3 `buildManifest()` 未检查符号链接 | ✅ 已修复 |
| P2 | 6.3 缺少 Skill 系统单元测试 | ✅ 已修复 |
| P3 | 1.1 `_availableTools` 参数未使用 | ✅ 已修复 |
| P3 | 1.2 `_skill_dir` 参数未使用 | ✅ 已修复 |
| P3 | 3.2 `getSkillContent()` 无缓存 | ✅ 已修复 |
| P3 | 3.3 `SkillPromptInjector` 职责过重 | ✅ 已修复 |
| P3 | 4.4 `skill_view` 工具层无路径预检 | ✅ 已修复 |
| P3 | 5.3 Skill 系统缺少会话级隔离 | ✅ 已修复 |
| P3 | 6.1 `parseSkillMd()` regex 边缘情况 | ✅ 已修复 |
| P3 | 6.2 `formatSkillsIndex()` 字段名混用 | ✅ 已修复 |

**总计: 16 个问题，14 个已修复，2 个确认跳过**
