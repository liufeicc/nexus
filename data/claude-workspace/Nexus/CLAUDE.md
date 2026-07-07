# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 开发命令

```bash
npm run dev          # 开发模式，启动 Vite 并自动打开 Electron
npm run build        # 类型检查 + 构建 + 打包
npm run build:linux  # 构建 Linux 版本
npm run build:win    # 构建 Windows 版本
npm run type-check   # TypeScript 类型检查
npm run lint         # ESLint 检查
npm run format       # Prettier 格式化
```

## 项目架构

### 技术栈
- **框架**: Electron 30 + React 18 + TypeScript 5
- **构建工具**: Vite 5 + vite-plugin-electron + vite-plugin-electron-renderer
- **终端渲染**: xterm.js 5.3.0 + xterm-addon-fit
- **PTY 支持**: node-pty
- **状态管理**: Zustand
- **数据库**: better-sqlite3

### 目录结构
```
src/
├── main/              # Electron 主进程
│   ├── index.ts       # 主进程入口
│   ├── preload.ts     # 预加载脚本 (contextBridge)
│   ├── ipc/           # IPC 处理器
│   ├── services/      # 服务层 (PTY、数据库)
│   ├── db/            # SQLite DAO 层
│   └── utils/         # 工具函数
├── renderer/          # 渲染进程 (React UI)
│   ├── components/    # React 组件
│   ├── hooks/         # 自定义 Hooks
│   ├── store/         # Zustand 状态管理
│   ├── styles/        # CSS 样式
│   └── utils/         # 工具函数
└── core/              # 核心业务逻辑
    ├── types/         # TypeScript 类型定义
    └── constants/     # 常量 (IPC 频道、主题、快捷键)
```

### IPC 通信模式
主进程和渲染进程通过 `contextBridge` + `ipcRenderer` 通信：
- IPC 频道定义在 `src/core/constants/ipc-channels.ts`
- 预加载脚本在 `src/main/preload.ts` 中暴露安全的 API 给渲染进程
- IPC 处理器注册在 `src/main/ipc/ipc-handlers.ts`

### 核心模块
1. **会话管理**: 支持多标签会话，状态持久化到 SQLite
2. **快照系统**: 保存/恢复终端布局状态
3. **PTY 服务**: 封装 node-pty，提供终端后端支持
4. **主题系统**: 6 套预设主题，通过 CSS 变量切换

### 注意事项
- Linux 上 Electron 需要 `--no-sandbox` 参数启动（权限问题）
- 原生模块 (better-sqlite3, node-pty) 需要使用 electron-rebuild 重新编译
- 主进程代码打包时需 `external` 处理原生模块

## 文档与原型

### docs/目录
| 文件 | 说明 |
|------|------|
| [原型.html](./docs/原型.html) | UI 原型设计，展示界面布局和交互效果 |
| [总体设计.md](./docs/总体设计.md) | 软件架构设计文档，包含技术架构、核心模块、UI 设计要点 |
| [数据库设计.md](./docs/数据库设计.md) | SQLite 数据库表结构、DAO 接口设计 |
| [操作手册.md](./docs/操作手册.md) | 用户操作指南，包含界面布局、功能操作详解 |
| [业务操作与数据库映射.md](./docs/业务操作与数据库映射.md) | 界面操作与数据库操作的对应关系 |

## 子代理使用指南

Claude 应根据用户问题判断并调用合适的子代理。

### 子代理分工

| 任务类型 | 子代理 | 产出物 |
|----------|--------|--------|
| 产品设计、需求分析 | `pm-subagent` | 《总体设计.md》 |
| 交互设计、界面设计 | `ui-designer` | 《原型.html》、《操作手册.md》 |
| 软件开发、代码实现 | `se-subagent` | 《数据库设计.md》、《业务操作与数据库映射.md》 |

### 调用原则

- **单一任务**: 调用一个对应的子代理
- **复合任务**: 可并行或串行调用多个子代理（如先产品设计 → 再界面设计 → 最后开发实现）

## 代码修改规范

- 修改 review 中的 BUG 时，完成后需说明"影响什么操作"，方便进行对应的功能测试。
