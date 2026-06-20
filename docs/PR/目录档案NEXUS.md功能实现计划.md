# 目录档案（NEXUS.md）功能实现计划

## Context

用户每次新建智能体会话时，AI 对本地环境完全失忆（不知道项目目录结构、技术栈、重要文件位置等），需要用户手动描述背景。

**方案**：在每个目录下创建 `NEXUS.md` 文件，对该目录进行描述。智能体工作时自动读取并注入提示词。用户提供管理界面支持手动编辑和 LLM 自动生成。

## 功能概述

1. **NEXUS.md 文件**：放在目标目录下，Markdown 格式，描述该目录的结构、技术栈、重要文件等
2. **管理入口**：Toolbar「操作」栏，在「关闭面板」按钮右侧新增按钮
3. **管理面板**：弹出模态框，支持选择目录、手动编辑、LLM 自动生成
4. **智能体注入**：智能体在某个目录下执行操作时按需读取该目录的 NEXUS.md，注入 system prompt
5. **多层级策略**：只读当前工作目录的 NEXUS.md；作为增强，扫描直接子目录中是否存在 NEXUS.md，返回清单（仅文件名，不读内容），让 AI 知道"下面还有哪些目录有文档"，按需自行下钻读取

## 修改文件清单

### 1. 主进程 — IPC 通道和处理器

#### `src/core/constants/ipc-channels.ts`
新增 4 个频道：
- `nexus-profile:read` — 读取指定目录的 NEXUS.md
- `nexus-profile:write` — 写入指定目录的 NEXUS.md
- `nexus-profile:generate` — 调用 LLM 自动生成
- `nexus-profile:exists` — 检查是否存在

#### `src/main/ipc/handlers/nexus-profile.ts`（新文件）
- `read(dir)`: 读取文件，不存在时返回 `{ exists: false, content: '' }`
- `write(dir, content)`: 写入文件
- `exists(dir)`: 检查是否存在
- `generate(dir)`: 扫描目录结构 → 调用副模型（复用已有的 AuxiliaryClient + subAgentConfig）生成描述
  - 扫描：`find dir -maxdepth 2 -not -path '*/node_modules/*' -not -path '*/.git/*'` + 检测 package.json/requirements.txt/go.mod 等项目特征文件
  - 构建 prompt：给出目录结构和技术栈信息，要求生成简洁的 NEXUS.md（中文、Markdown、≤1500 字）
  - 调用链路：`loadAgentConfig()` → 获取 `agentConfig`（主模型）和 `summaryModelConfig`（副模型，即 `subAgentConfig`）→ 创建 `AuxiliaryClient({ parentConfig: agentConfig, standaloneConfig: summaryModelConfig })` → 调用 `auxClient.generateSummary(prompt, maxTokens=2000)` 生成 Markdown
  - 与 MemoryExtractorAgent 和 BackgroundCompressor 共用同一套副模型配置，无需额外配置

#### `src/main/ipc/ipc-handlers.ts`
注册新处理器。

### 2. 渲染进程 — 类型声明

#### `src/renderer/electron-api.d.ts`
```typescript
nexusProfile: {
  read(dir: string): Promise<{ exists: boolean; content: string }>;
  write(dir: string, content: string): Promise<void>;
  generate(dir: string): Promise<string>;
  exists(dir: string): Promise<boolean>;
}
```

### 3. 渲染进程 — UI 组件

#### `src/renderer/components/common/NexusProfileModal.tsx`（新文件）

HUD 风格模态框：
- 目录选择（使用 Electron 的 dialog.showOpenDialog，限制 directory）
- textarea 手动编辑（复用 ClarifyModal 的 textarea 样式）
- 字符计数：正常灰色，>2000 红色警告，>3000 禁止保存
- 「LLM 自动生成」按钮：调用 `nexusProfile.generate(dir)`，显示加载状态
- 「保存」按钮：调用 `nexusProfile.write(dir, content)`
- 「关闭」按钮

#### `src/renderer/components/layout/Toolbar.tsx`
在「关闭面板」按钮右侧新增按钮，使用文档图标。

### 4. Store 状态

新增 `nexusProfileModalVisible` 状态和对应 action。

### 5. i18n 翻译

`zh.json`、`en.json`、`fr.json`、`es.json` 新增 toolbar.nexusProfile 等翻译键。

### 6. 智能体 — Prompt 注入

#### `src/main/agent/prompt-builder.ts`
`buildSystemPrompt()` 新增可选参数 `nexusProfileBlock`，在 environment hints 和 Skill 索引之间注入：

```
<Project Context>
[NEXUS.md 内容]
</Project Context>
```

#### `src/main/services/agent-service.ts`（或 agent-loop.ts）
在智能体需要操作某个目录时：
1. 获取当前工作目录（从会话上下文或面板路径）
2. 读取该目录下 NEXUS.md
3. 顺带扫描直接子目录中是否存在 NEXUS.md，返回清单供 AI 按需下钻
4. 将内容传入 prompt builder 的 `nexusProfileBlock` 参数

## 实现步骤

### Phase 1: IPC 基础设施
1. `ipc-channels.ts` 新增频道
2. 创建 `nexus-profile.ts` 处理器（读写 + exists）
3. `electron-api.d.ts` 声明 API
4. `ipc-handlers.ts` 注册

### Phase 2: UI 管理面板
5. Store 新增状态
6. 创建 `NexusProfileModal.tsx`
7. 在 `App.tsx` 中渲染
8. `Toolbar.tsx` 新增按钮
9. i18n 翻译

### Phase 3: LLM 自动生成
10. `nexus-profile.ts` 实现 `generate`（扫描 + 调用 AuxiliaryClient.generateSummary()，复用 subAgentConfig 副模型配置）

### Phase 4: 智能体 Prompt 注入
11. `prompt-builder.ts` 新增 `nexusProfileBlock` 参数
12. `agent-service.ts`（或 agent-loop.ts）按需读取 NEXUS.md 并传递

## 限制

- 文件最大 3000 字符，超过禁止保存
- 警告阈值 2000 字符
- 目录扫描最大深度 2 层，排除 node_modules/.git 等
- 自动生成内容 ≤1500 字
