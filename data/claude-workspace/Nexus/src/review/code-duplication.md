# 代码重复分析

## 一、核心重复：快照保存 + 面板操作（7处重复）

**涉及文件**: `Toolbar.tsx`, `ContextMenu.tsx`, `TerminalPanel.tsx`, `Sidebar.tsx`

### 重复模式

每个位置都实现了相同的操作流程：

```
1. 终止 PTY:      await window.electronAPI.pty.kill(panel.ptyId)
2. 从 store 移除: removePanel(panelId) 或 getState().removePanel(targetPanelId)
3. 保存快照:
   const state = useAppStore.getState()
   await window.electronAPI.snapshot.save(activeSessionId, {
     layoutData: state.layout as any,
     activePanelId: state.activePanelId,
     panelStates: state.panels.map(...)
   })
4. 通知刷新:     window.dispatchEvent(new CustomEvent('panels-change'))
```

### 具体位置

| 文件 | 函数/操作 | 行号范围 |
|------|----------|----------|
| `Toolbar.tsx` | handleAddPanel（创建第一个面板） | 33-83 |
| `Toolbar.tsx` | handleAddPanel（分屏） | 89-141 |
| `Toolbar.tsx` | handleClosePanel | 153-188 |
| `ContextMenu.tsx` | split-horizontal/vertical | 229-277 |
| `ContextMenu.tsx` | close-panel | 297-328 |
| `TerminalPanel.tsx` | performClosePanel | 298-341 |
| `Sidebar.tsx` | handleNewSession（新建会话） | 143-238 |

### 建议方案

提取 `src/renderer/hooks/usePanelActions.ts`：

```
createPanel(cwd: string)
closePanel(panelId: string)
splitPanel(targetPanelId, direction, cwd)
saveSnapshot()
```

---

## 二、PTY 创建 + 面板初始化逻辑重复（3处）

### 重复模式

```typescript
const ptyId = await window.electronAPI.pty.create({
  cwd: selectedPath,
  shell: window.electronAPI.platform.isWindows ? 'powershell.exe' : undefined,
})
const newPanelId = `panel-${Date.now()}`
const newPanel = {
  id: newPanelId,
  ptyId,
  cwd: selectedPath,
  title: `终端 - ${selectedPath}`,
}
```

### 具体位置

| 文件 | 位置 | 行号 |
|------|------|------|
| `Toolbar.tsx` | handleAddPanel（创建/分屏） | 33-51, 89-107 |
| `ContextMenu.tsx` | split-horizontal/vertical | 230-247 |
| `Sidebar.tsx` | handleNewSession | 171-201 |

### 建议

提取为 `createTerminalPanel(cwd: string)` 工具函数或 store action。

---

## 三、会话快照恢复逻辑重复（2处几乎完全相同）

### 具体位置

| 文件 | 函数 | 行号 |
|------|------|------|
| `Sidebar.tsx` | restoreSessionSnapshot（Sidebar 组件内） | 24-85 |
| `Sidebar.tsx` | restoreSessionSnapshot（SessionListItem 组件内） | 462-518 |

### 共同逻辑

- 检查缓存 `sessionsPanels.get(sessionId)`
- 缓存命中则直接使用
- 缓存未命中则获取快照、重建 PTY、更新 store
- 通知 `panels-change` 事件

### 建议

提取为单一函数 `restoreSessionSnapshot(sessionId)` 放在 Sidebar 外部或单独的 hook 中，两个组件共享。

---

## 四、常用路径保存逻辑重复（2处）

### 具体位置

| 文件 | 位置 | 行号 |
|------|------|------|
| `Sidebar.tsx` | handleNewSession 中 | 147-160 |
| `Modal.tsx` | saveToCommonPaths | 312-332 |

### 重复模式

```typescript
const savedPaths = await window.electronAPI.config.get('commonPaths')
const currentPaths = Array.isArray(savedPaths) ? savedPaths : []
const exists = currentPaths.some((p) => p.path === selectedPath)
if (!exists) {
  const newPath = {
    name: selectedPath.split('/').pop() || selectedPath,
    path: selectedPath,
    icon: '📁',
  }
  const updatedPaths = [newPath, ...currentPaths].slice(0, 10)
  await window.electronAPI.config.save('commonPaths', updatedPaths)
}
```

### 建议

提取 `useCommonPaths` hook 或工具函数。

---

## 五、会话列表加载逻辑重复（3处）

### 具体位置

| 文件 | 位置 | 行号 |
|------|------|------|
| `Sidebar.tsx` | loadSessions | 88-118 |
| `ContextMenu.tsx` | loadSessions | 19-30 |
| `Sidebar.tsx` | handleNewSession 中刷新列表 | 214-224 |

### 重复模式

```typescript
const sessions = await window.electronAPI.session.list()
setAllSessions(sessions)
setSessionIds(sessions.map((s: Session) => s.id))
const recent = await window.electronAPI.session.getRecent(3)
setRecentSessions(recent)
```

### 建议

提取 `useSessionList` hook。

---

## 六、布局树操作函数内部重复

### 具体位置

| 文件 | 函数 | 行号 |
|------|------|------|
| `store/index.ts` | simplifyLayout | 45-85 |
| `store/index.ts` | cleanupLayoutFlexValues | 91-118 |

### 问题

两个函数的 `flexValues` 清理逻辑完全相同（行 71-81 与 105-114），但 `simplifyLayout` 多做了一步"只剩一个子节点时返回子节点"的简化。

### 建议

提取 `normalizeFlexValues(node, children)` 内部函数复用。

---

## 七、store 中更新会话缓存模式重复（9处）

### 涉及文件

`store/index.ts`

### 重复的 action

`setActiveSessionId`, `addPanel`, `removePanel`, `updatePanelTitle`, `setPanelsFromSnapshot`, `setLayout`, `updateLayoutFlex`, `splitPanel`, `swapPanels`

### 重复模式

每个 action 都有相同的模式：

```typescript
if (state.activeSessionId !== null) {
  const newSessionsPanels = new Map(state.sessionsPanels)
  newSessionsPanels.set(state.activeSessionId, newPanels)
  newState.sessionsPanels = newSessionsPanels
  const newSessionsLayouts = new Map(state.sessionsLayouts)
  newSessionsLayouts.set(state.activeSessionId, newLayout)
  newState.sessionsLayouts = newSessionsLayouts
}
```

### 建议

提取辅助函数 `updateSessionCache(state, panels, layout)`。

---

## 八、拖拽调整大小逻辑重复（2处）

### 具体位置

| 文件 | 位置 | 行号 |
|------|------|------|
| `Sidebar.tsx` | 侧边栏拖拽 | 241-281 |
| `LayoutRenderer.tsx` | Resizer 组件 | 27-94 |

### 共同模式

两者都实现了 `mousedown/mousemove/mouseup` 的拖拽模式，处理 cursor、userSelect 等。

### 建议

提取通用 `useDragResize` hook。

---

## 九、SVG 图标内联重复（5+处）

### 重复的图标

| 图标 | 出现位置 |
|------|---------|
| 删除（Trash） | ContextMenu.tsx:427, Sidebar.tsx:624, Toolbar.tsx:258, TerminalPanel.tsx:577, Modal.tsx:456 |
| 重命名/编辑 | ContextMenu.tsx:413, Sidebar.tsx:613 |
| 关闭（X） | ContextMenu.tsx:481, Toolbar.tsx:258, Header.tsx:227 |
| 加号（+） | ContextMenu.tsx:399, Sidebar.tsx:343, Sidebar.tsx:428, Toolbar.tsx:242 |

### 建议

扩展现有 `Icon.tsx` 为图标库，预定义常用图标，消除内联 SVG 重复。

---

## 十、窗口控制按钮样式重复

### 涉及位置

| 文件 | 类名 | 行号 |
|------|------|------|
| `globals.css` | `.window-control-btn` | 152-174 |
| `globals.css` | `.help-btn` | 120-142 |
| `globals.css` | `.sidebar-toggle-btn` | 332-355 |
| `components.css` | `.toolbar-btn` | 175-196 |
| `components.css` | `.session-action-btn` | 150-172 |
| `components.css` | `.theme-toggle-btn` | 203-245 |
| `components.css` | `.terminal-close-btn` | 772-805 |

### 共同模式

固定宽高、透明背景、圆角、hover 变色、flex 居中。

### 建议

在 CSS 中提取 `.icon-button` 基类。

---

## 缺失的抽象汇总

| 缺失抽象 | 用途 | 涉及文件 |
|---------|------|---------|
| `usePanelActions` hook | 面板创建/关闭/分屏/快照 | Toolbar, ContextMenu, TerminalPanel, Sidebar |
| `useSessionList` hook | 会话列表加载/刷新 | Sidebar, ContextMenu |
| `useCommonPaths` hook | 常用路径保存/读取 | Sidebar, Modal |
| `useDragResize` hook | 拖拽调整大小 | Sidebar, LayoutRenderer |
| `usePathAutocomplete` hook | 路径自动补全行为 | Modal (PathSelectorModal) |
| CustomEvent 封装 | 集中管理 `panels-change` 等魔法字符串 | 多个组件 |
