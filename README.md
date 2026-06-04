# Nexus

**Nexus** - Terminal Views

一款基于 Electron 开发的图形化终端复用工具，提供类似 tmux 的多路复用功能，但通过直观的 GUI 界面降低使用门槛。

## 特性

- 多标签会话管理
- 支持水平/垂直分屏
- 树形嵌套布局（v2.0）
- 多主题切换
- 图形化操作界面
- SQLite 数据持久化

## 技术栈

- **框架**: Electron + React + TypeScript
- **终端渲染**: xterm.js
- **PTY 支持**: node-pty
- **状态管理**: Zustand
- **数据存储**: better-sqlite3
- **构建工具**: Vite

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 构建 Linux 版本
npm run build:linux

# 构建 Windows 版本
npm run build:win
```

## 项目结构

```
Nexus/
├── src/
│   ├── main/           # Electron 主进程
│   │   ├── index.ts    # 主进程入口
│   │   ├── preload.ts  # 预加载脚本
│   │   ├── services/   # 服务层
│   │   ├── db/         # 数据库相关
│   │   ├── ipc/        # IPC 通信
│   │   └── utils/      # 工具函数
│   ├── renderer/       # 渲染进程
│   │   ├── components/ # React 组件
│   │   ├── hooks/      # 自定义 Hooks
│   │   ├── store/      # 状态管理
│   │   └── styles/     # 样式文件
│   └── core/           # 核心业务逻辑
│       ├── types/      # 类型定义
│       └── constants/  # 常量定义
├── docs/               # 文档
├── resources/          # 静态资源
├── tests/              # 测试
└── package.json
```

## 许可证

MIT
