# 代码 Review 报告 v0.1.1

> 审查时间: 2026-04-03
> 审查范围: src/ 目录下全部 38 个源文件

---

## 1. 无效/死代码

### 1.1 未被引用的组件文件

| 文件 | 说明 |
|------|------|
| `src/renderer/components/session/SessionList.tsx` | 无任何文件 import 此组件，Sidebar.tsx 以内联方式实现了会话列表渲染 |
| `src/renderer/components/common/Button.tsx` | 无任何组件引用 |
| `src/renderer/components/common/Icon.tsx` | 无任何组件引用 |

**建议**: 删除以上 3 个文件。

### 1.2 未被使用的常量/函数

| 位置 | 说明 |
|------|------|
| `src/core/constants/shortcuts.ts` | `DEFAULT_SHORTCUTS` 导出但从未被 import。`useGlobalEvents.ts` 中的键盘快捷键是硬编码的，带有 TODO 占位符 |
| `src/core/constants/themes.ts` | `getThemeById()` 导出但从未被 import |
| `src/renderer/utils/helpers.ts` | `generateId`、`debounce`、`throttle` 导出但未被任何组件使用 |

**建议**: 删除死代码，或在实现快捷键时连接 `shortcuts.ts` 与 `useGlobalEvents.ts`。

---

## 2. 重复代码与文件臃肿

### 2.1 类型定义重复

**`PanelState`、`LayoutNode`、`PanelNode`、`LayoutChild` 在两个地方定义:**
- `src/core/types/pane.ts` 和 `src/core/types/layout.ts` — 原始定义
- `src/renderer/store/index.ts` — 重新定义了一遍相同的类型

**`ElectronAPI` 接口在两个地方定义:**
- `src/renderer/electron-api.d.ts`
- `src/vite-env.d.ts`

**`PanelState` 命名冲突:**
- `src/core/types/snapshot.ts` 中 `SnapshotData.panelStates` 使用 `{ panelId, ptyId, cwd, title }` 结构
- `src/core/types/pane.ts` 中 `PanelState` 是 `{ position, size, zIndex }` 结构
同名不同形，序列化/反序列化时容易混淆。

**建议**: store 统一从 `@core/types` 导入类型；合并两个 `ElectronAPI` 声明文件；重命名 snapshot 中的 `PanelState` 为 `SnapshotPanelState` 以消除歧义。

### 2.2 快照保存逻辑重复

以下 5 个文件各自独立实现了几乎相同的 `window.electronAPI.snapshot.save()` 调用：

| 文件 | 行范围 |
|------|--------|
| `src/renderer/components/terminal/TerminalPanel.tsx` | 316-336 |
| `src/renderer/components/layout/Toolbar.tsx` | 整文件 |
| `src/renderer/components/layout/LayoutRenderer.tsx` | Resizer 回调中 |
| `src/renderer/components/layout/ContextMenu.tsx` | 252-265, 307-319 |
| `src/renderer/components/layout/Sidebar.tsx` | 整文件 |

**建议**: 抽取为 store action `saveSnapshot()`，所有组件调用这一个方法。

### 2.3 Tilde 路径展开重复

- `src/main/services/pty.service.ts` 中有本地 `expandTilde()` 函数
- `src/renderer/utils/helpers.ts` 中有 `expandPath()` 做同样的事

**建议**: 抽取到 `src/core/utils/path.ts` 作为共享工具。

### 2.4 单文件结构臃肿

| 文件 | 行数 | 问题 |
|------|------|------|
| `src/renderer/components/layout/Sidebar.tsx` | 634 | 会话列表、resize、折叠、快照恢复、新建会话逻辑混在一起 |
| `src/renderer/components/terminal/TerminalPanel.tsx` | 588 | 拖拽处理、PTY 设置、右键菜单、resize、复制粘贴全在一个组件 |
| `src/renderer/store/index.ts` | 583 | Store 定义、布局树操作、flex 值清理全部在一个文件 |
| `src/renderer/components/common/Modal.tsx` | 544 | ConfirmModal、RenameModal、PathSelectorModal 三个模态框挤在一个文件 |

**建议**:
- `Sidebar.tsx` → 拆分为 `SessionList.tsx`(列表渲染) + `SessionActions.tsx`(新建/删除操作) + `useSessionResize.ts`(hooks)
- `TerminalPanel.tsx` → 拆出 `useDragHandle.ts`、`useTerminalContextMenu.ts`
- `store/index.ts` → 拆出 `store/layout-ops.ts`
- `Modal.tsx` → 拆为三个独立文件

---

## 3. 设计范式/抽象问题

### 3.1 ConfigMap 类型不安全 

`src/core/types/config.ts:35`:
```typescript
[key: string]: any
```
整个配置系统失去类型安全。所有 config 访问都绕过了 TypeScript 检查。

**建议**: 定义明确的 `ConfigSchema` 接口，使用 `zod` 或手动的类型守卫替代 `any`。

### 3.2 PTY 生命周期与 UI 耦合

`splitPanel` store 函数要求调用方先创建 PTY 再调用 store（见 `ContextMenu.tsx:232-250`、`Toolbar.tsx`）。PTY 生命周期散落在多个 UI 组件中。

**建议**: PTY 的创建/销毁应由 store 或专用 `pty.service.ts` 统一管理，UI 组件只触发 action，不直接操作 PTY。

### 3.3 快捷键常量与事件监听脱节

`shortcuts.ts` 定义了 `DEFAULT_SHORTCUTS` 和动作类型，但 `useGlobalEvents.ts` 完全不引用它们，而是硬编码 keyCode 检查。

**建议**: `useGlobalEvents.ts` 改为遍历 `DEFAULT_SHORTCUTS` 数组进行匹配，消除硬编码。

### 3.4 类型导入来源不一致

- `TerminalArea.tsx` 从 `../../store` 导入 `PanelState`
- `LayoutRenderer.tsx` 从自身文件导入自己的 `PanelState`

两者定义相同但来源不同，后续维护容易分裂。

---

## 4. BUG

### 4.1 IPC 通道命名冲突 【高】

`src/main/preload.ts:71`:
```typescript
ipcRenderer.on(IPC_CHANNELS.PTY_WRITE, (event, data) => {
  callback({ ptyId, data })
})
```

`pty.onData` 监听使用 `IPC_CHANNELS.PTY_WRITE` 通道接收 PTY → 渲染进程的数据流，而 `pty.write()` 也用同名通道发送渲染进程 → PTY 的数据。**双向数据流共用同一通道名**，容易引发数据混淆或竞态。

**修复**: 使用独立通道如 `IPC_CHANNELS.PTY_DATA` 处理 PTY → 渲染进程方向。

### 4.2 窗口状态恢复未 await 【中】

`src/main/index.ts:98`:
```typescript
restoreWindowState(window)  // async 函数，但未 await
```

应用打印 "Application initialized" 时，窗口尺寸/位置可能还未从数据库恢复完成。

**修复**: 改为 `await restoreWindowState(window)` 或改为同步读取。

### 4.3 删除会话未清理缓存 【中】

store 维护 `sessionsPanels` 和 `sessionsLayouts` 两个 Map。`ContextMenu.tsx` 删除会话时，仅调用 `setSessionIds` 更新 ID 列表，**被删除会话的 panels/layouts 数据仍永久留在 Map 中**，造成内存泄漏。

**修复**: 在删除 session 的 action 中同步 `sessionsPanels.delete(sessionId)` 和 `sessionsLayouts.delete(sessionId)`。

### 4.4 外键约束 pragma 时机 【低】

`src/main/db/database.ts`:
```typescript
this.db = new Database(dbPath)
this.db.pragma('foreign_keys = ON')  // 在 open 之后设置
```

每个进程启动时会设置 pragma，但如果数据库文件是由未启用外键的旧版本创建的，已存在的数据可能包含违反外键约束的脏数据。

**修复**: 在设置 pragma 后增加一次数据完整性校验。

---

## 5. 优化优先级排序

| 优先级 | 问题 | 工作量 |
|--------|------|--------|
| P0 | 4.1 IPC 通道命名冲突 | 小 |
| P0 | 4.3 删除会话内存泄漏 | 小 |
| P1 | 4.2 窗口状态恢复竞态 | 小 |
| P1 | 2.1 类型定义重复 + 命名冲突 | 中 |
| P1 | 2.2 快照保存逻辑抽取 | 中 |
| P1 | 3.2 PTY 生命周期解耦 | 大 |
| P2 | 1.1 死代码文件清理 | 小 |
| P2 | 1.2 未使用常量/函数清理 | 小 |
| P2 | 2.4 大文件拆分 | 中 |
| P2 | 3.1 ConfigMap 类型安全 | 中 |
| P2 | 3.3 快捷键常量连接 | 小 |
| P3 | 2.3 Tilde 路径展开抽取 | 小 |
| P3 | 4.4 外键 pragma 校验 | 小 |
