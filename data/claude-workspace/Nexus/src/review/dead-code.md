# 无效代码（Dead Code）清单

## 一、完全未使用的组件/文件（可直接删除）

| 文件 | 说明 |
|------|------|
| `src/renderer/components/common/Button.tsx` | 导出但从未被任何组件 import |
| `src/renderer/components/common/Icon.tsx` | 导出但从未被 import，所有图标均为内联 SVG |
| `src/renderer/components/session/SessionList.tsx` | 导出但从未被 import，Sidebar.tsx 内有自己的 SessionListItem 实现 |

---

## 二、导出但未被使用的函数和常量

| 文件 | 未使用导出 | 行号 | 说明 |
|------|-----------|------|------|
| `src/core/constants/shortcuts.ts` | `DEFAULT_SHORTCUTS` | 5 | 整个文件无外部引用 |
| `src/core/constants/shortcuts.ts` | `ShortcutAction` 类型 | 25 | 整个文件无外部引用 |
| `src/core/constants/themes.ts` | `getThemeById` | 138 | 导出但从未被 import 或调用 |
| `src/renderer/utils/helpers.ts` | `generateId` | 8 | 整个文件无外部引用 |
| `src/renderer/utils/helpers.ts` | `debounce` | 15 | Modal.tsx 有自己的 inline debounce，未用此函数 |
| `src/renderer/utils/helpers.ts` | `throttle` | 29 | 无外部引用 |
| `src/renderer/utils/helpers.ts` | `expandPath` | 46 | 无外部引用 |
| `src/renderer/utils/helpers.ts` | `shortenPath` | 57 | 仅在 helpers.ts 内部使用 |
| `src/main/ipc/ipc-handlers.ts` | `unregisterIpcHandlers` | 332 | main/index.ts shutdown 逻辑未调用 |
| `src/main/utils/logger.ts` | `LogLevel` 枚举 | 10 | 仅 logger 内部使用 |
| `src/main/utils/logger.ts` | `createLogger` | 73 | 仅创建 logger 单例时内部调用 |
| `src/main/index.ts` | `windowManager` | 169 | 导出但无任何文件 import |
| `src/renderer/store/index.ts` | `LayoutMode` | 39 | 导出但无外部引用 |

---

## 三、导出但未被使用的 DAO/Service 方法

| 文件 | 方法 | 行号 | 说明 |
|------|------|------|------|
| `src/main/windows/window-manager.ts` | `closeMainWindow` | 87 | main/index.ts 用 `windowManager = null` 清理，未调此方法 |
| `src/main/services/pty.service.ts` | `getPtyInfo` | 167 | 返回 PTY pid/cols/rows 信息，从未被调用 |
| `src/main/db/snapshot.dao.ts` | `deleteBySession` | 131 | SessionDAO.delete() 用原始 SQL 处理，未用此方法 |
| `src/main/db/session.dao.ts` | `updateLastUsed` | 192 | setActive() 已包含此逻辑 |

---

## 四、未使用的类型/接口

| 文件 | 未使用类型 | 行号 | 说明 |
|------|-----------|------|------|
| `src/core/constants/ipc-channels.ts` | `IPCChannel` | 58 | 导出但从未被 import |
| `src/core/types/config.ts` | `WindowStateConfig` | 8 | 通过 barrel 文件重新导出但无外部引用 |
| `src/core/types/config.ts` | `CommonPathItem` | 19 | 同上 |
| `src/core/types/config.ts` | `TerminalConfig` | 28 | 同上 |
| `src/core/types/config.ts` | `ThemeConfig` | 38 | 同上 |
| `src/core/types/config.ts` | `ConfigMap` | 45 | 同上 |
| `src/core/types/pane.ts` | `PanelSize` | 8 | 通过 barrel 文件重新导出但无外部引用 |
| `src/core/types/pane.ts` | `PanelPosition` | 16 | 同上（注意: `PanelState` 和 `PanelNode` 被使用了） |
| `src/core/types/layout.ts` | `LayoutContainerNode` | 10 | 通过 barrel 文件重新导出但无外部引用 |
| `src/core/types/layout.ts` | `SplitDirection` | 33 | 同上 |
| `src/core/types/session.ts` | `CreateSessionParams` | 20 | 通过 barrel 文件重新导出但无外部引用 |
| `src/core/types/session.ts` | `UpdateSessionParams` | 27 | 同上 |
| `src/main/db/session.dao.ts` | `SessionRow`, `Session` | 10, 22 | 仅文件内部使用，export 不必要；且 `Session` 与 core/types/session.ts 重复定义 |
| `src/main/db/snapshot.dao.ts` | `SnapshotRow`, `Snapshot` | 11, 24 | 仅文件内部使用；且 `Snapshot` 与 core/types/snapshot.ts 重名但定义不同 |

---

## 五、未使用的 IPC 频道定义

| 文件 | 频道 | 行号 | 说明 |
|------|------|------|------|
| `src/core/constants/ipc-channels.ts` | `WINDOW_GET_STATE` | 36 | 定义但无对应 handler，preload.ts 中无客户端 API |
| `src/core/constants/ipc-channels.ts` | `WINDOW_SET_STATE` | 37 | 同上 |

---

## 六、未使用的 CSS 类名

| 文件 | 未使用类 | 行号 | 说明 |
|------|---------|------|------|
| `components.css` | `.btn-ghost` | 41 | Button 组件未被使用，这些变体也无引用 |
| `components.css` | `.btn-icon`, `.btn-icon.active` | 51, 63 | 同上 |
| `components.css` | `.btn-small` | 68 | 同上 |
| `components.css` | `.btn-block` | 79 | 同上 |
| `components.css` | `.session-path` | 124 | 无 JSX 使用此类名 |
| `globals.css` | `.layout-resizer-handle` | 326 | LayoutRenderer.tsx Resizer 未使用此类 |
| `globals.css` | `.hidden` | 472 | 通用隐藏工具类，项目中从未使用 |

---

## 七、潜在 Bug

| 文件 | 问题 | 行号 | 说明 |
|------|------|------|------|
| `src/main/preload.ts` | `pty.onData` 监听 `PTY_WRITE` 频道 | 71 | `PTY_WRITE` 是渲染进程→主进程的写入频道，语义混淆。主进程 PtyService 发送数据的频道名需确认是否一致，可能存在双向通信共用同一频道名导致数据混乱的风险 |
