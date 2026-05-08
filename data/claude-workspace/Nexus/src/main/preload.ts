/**
 * 预加载脚本
 * 在渲染进程和主进程之间建立安全的通信桥梁
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../core/constants/ipc-channels'
import type { LayoutTree } from '../core/types/layout'
import type { SnapshotPanelState } from '../core/types/snapshot'

// 定义暴露给渲染进程的 API
const electronAPI = {
  // ===== 配置管理 =====
  config: {
    save: (key: string, value: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE, key, value),
    get: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET, key),
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET_ALL),
    delete: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_DELETE, key),
    testModel: (config: { provider: string; apiUrl: string; apiKey: string; model: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONFIG_TEST_MODEL, config),
  },

  // ===== 会话管理 =====
  session: {
    create: (name?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SESSION_CREATE, name),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET, id),
    update: (id: string, name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SESSION_UPDATE, id, name),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_DELETE, id),
    setActive: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SESSION_SET_ACTIVE, id),
    getActive: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET_ACTIVE),
    getRecent: (limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET_RECENT, limit),
  },

  // ===== 快照管理 =====
  snapshot: {
    save: (
      sessionId: string,
      data: {
        name?: string
        layoutData: LayoutTree | null
        activePanelId?: string
        panelStates: SnapshotPanelState[]
      }
    ) => ipcRenderer.invoke(IPC_CHANNELS.SNAPSHOT_SAVE, sessionId, data),
    list: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SNAPSHOT_LIST, sessionId),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SNAPSHOT_GET, id),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SNAPSHOT_DELETE, id),
    getLatest: (sessionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SNAPSHOT_GET_LATEST, sessionId),
  },

  // ===== PTY 管理 =====
  pty: {
    create: (params: {
      shell?: string
      cwd?: string
      cols?: number
      rows?: number
      panelId?: string
      sessionId?: string
    }) => ipcRenderer.invoke(IPC_CHANNELS.PTY_CREATE, params),
    write: (ptyId: string, data: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.PTY_WRITE, ptyId, data),
    resize: (ptyId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.PTY_RESIZE, ptyId, cols, rows),
    kill: (ptyId: string) => ipcRenderer.invoke(IPC_CHANNELS.PTY_KILL, ptyId),
    onData: (callback: (data: { ptyId: string; data: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { ptyId: string; data: string }) =>
        callback(data)
      ipcRenderer.on(IPC_CHANNELS.PTY_DATA, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.PTY_DATA, listener)
    },
    /**
     * 监听终端 cwd 变化（通过 OSC 7 序列追踪）
     */
    onCwdChanged: (callback: (data: { ptyId: string; cwd: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { ptyId: string; cwd: string }) =>
        callback(data)
      ipcRenderer.on(IPC_CHANNELS.PTY_CWD_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.PTY_CWD_CHANGED, listener)
    },
  },

  // ===== 应用信息 =====
  app: {
    getPath: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PATH, name),
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
    getResourcePath: (filename: string) => ipcRenderer.invoke('app:get-resource-path', filename),
  },

  // ===== 路径检查 =====
  path: {
    exists: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.PATH_EXISTS, path),
    autocomplete: (input: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.PATH_AUTOCOMPLETE, input),
  },

  // ===== 渲染进程内部事件（非 IPC） =====
  // 显示路径选择器（直接调用 store，不需要 IPC）
  showPathSelector: (onConfirm: (path: string) => void, sessionId?: string) => {
    // 存储回调到全局，供 Modal 组件使用
    const win = window as unknown as { __pathSelectorCallback?: (path: string) => void; __pathSelectorSessionId?: string }
    win.__pathSelectorCallback = onConfirm
    win.__pathSelectorSessionId = sessionId
    window.dispatchEvent(new CustomEvent('show-path-selector'))
  },

  // ===== 平台信息 =====
  platform: {
    isMac: process.platform === 'darwin',
    isWindows: process.platform === 'win32',
    isLinux: process.platform === 'linux',
  },

  // ===== 剪贴板 =====
  clipboard: {
    readText: () => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_READ_TEXT),
    writeText: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_WRITE_TEXT, text),
  },

  // ===== 文件系统 =====
  fs: {
    /**
     * 读取目录内容
     * @param dirPath - 目录路径
     * @returns { items: FileItem[], error: string | null }
     */
    readdir: (dirPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_READ_DIR, dirPath),
    /**
     * 读取文件内容
     * @param filePath - 文件路径
     * @returns { content: string, error: string | null }
     */
    readFile: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_READ_FILE, filePath),
    /**
     * 写入文件内容
     * @param filePath - 文件路径
     * @param content - 文件内容
     * @returns { error: string | null }
     */
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_WRITE_FILE, filePath, content),
    /**
     * 复制文件或目录
     * @param src - 源路径
     * @param dst - 目标路径
     * @returns { error: string | null }
     */
    copyFile: (src: string, dst: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_COPY_FILE, src, dst),
    /**
     * 检查路径是否存在
     * @param filePath - 文件路径
     * @returns { exists: boolean }
     */
    exists: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_EXISTS, filePath),
    /**
     * 监听目录变化
     * @param dirPath - 目录路径
     */
    watchDir: (dirPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_WATCH_DIR, dirPath),
    /**
     * 取消监听目录
     * @param dirPath - 目录路径
     */
    unwatchDir: (dirPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_UNWATCH_DIR, dirPath),
    /**
     * 监听目录变化事件
     */
    onDirChanged: (callback: (data: { dirPath: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { dirPath: string }) =>
        callback(data)
      ipcRenderer.on(IPC_CHANNELS.FS_DIR_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.FS_DIR_CHANGED, listener)
    },
    /**
     * 监听文件变化
     */
    watchFile: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_WATCH_FILE, filePath),
    /**
     * 取消监听文件
     */
    unwatchFile: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_UNWATCH_FILE, filePath),
    /**
     * 监听文件变化事件
     */
    onFileChanged: (callback: (data: { filePath: string; eventType: string; newPath?: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { filePath: string; eventType: string; newPath?: string }) =>
        callback(data)
      ipcRenderer.on(IPC_CHANNELS.FS_FILE_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.FS_FILE_CHANGED, listener)
    },
    /**
     * 将文件或目录移动到系统废纸篓
     * @param paths - 文件或目录路径数组
     * @returns { successCount: number, errorCount: number, errors: string[] }
     */
    trashItem: (paths: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_TRASH_ITEM, paths),
    /**
     * 读取文件为 base64（用于图片/PDF 预览）
     * @param filePath - 文件路径
     * @returns { base64: string, mimeType: string, error: string | null }
     */
    readFileAsBase64: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_READ_FILE_AS_BASE64, filePath),
    /**
     * 重命名文件或目录
     * @param oldPath - 原路径
     * @param newPath - 新路径（同目录下的新文件名）
     * @returns { error: string | null }
     */
    rename: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_RENAME, oldPath, newPath),
    /**
     * 创建文件夹（自动处理重名冲突）
     * @param dirPath - 目录路径
     * @returns { resolvedPath: string, error: string | null }
     */
    createDir: (dirPath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_CREATE_DIR, dirPath),
    /**
     * 创建文件（自动处理重名冲突）
     * @param filePath - 文件路径
     * @param content - 文件内容（默认为空字符串）
     * @returns { resolvedPath: string, error: string | null }
     */
    createFile: (filePath: string, content?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_CREATE_FILE, filePath, content || ''),
    /**
     * 复制文件/目录（智能体文件管理工具使用）
     */
    copyFileItem: (src: string, dst: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_COPY, src, dst),
    /**
     * 移动文件/目录（智能体文件管理工具使用）
     */
    moveFileItem: (src: string, dst: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_MOVE, src, dst),
    /**
     * 移入回收站（智能体文件管理工具使用）
     */
    trashFileItem: (paths: string | string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_TRASH, paths),
    /**
     * 重命名文件/目录（智能体文件管理工具使用）
     */
    renameFileItem: (oldPath: string, newName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_RENAME, oldPath, newName),
  },

  // ===== 浏览器控制 =====
  browser: {
    /** 创建浏览器面板实例（不含 View） */
    createBrowserView: (browserId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CREATE, browserId),
    /** 在面板中创建新标签 */
    createTab: (browserId: string, tabId: string, bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CREATE_TAB, browserId, tabId, bounds),
    /** 移除指定标签 */
    removeTab: (browserId: string, tabId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REMOVE_TAB, browserId, tabId),
    /** 切换活动标签 */
    setActiveView: (browserId: string, tabId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_SET_ACTIVE_VIEW, browserId, tabId),
    /** 设置 BrowserView 边界 */
    setBounds: (browserId: string, tabId: string, bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_SET_BOUNDS, browserId, tabId, bounds),
    navigate: (browserId: string, tabId: string, url: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_NAVIGATE, browserId, tabId, url),
    goBack: (browserId: string, tabId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GO_BACK, browserId, tabId),
    goForward: (browserId: string, tabId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GO_FORWARD, browserId, tabId),
    reload: (browserId: string, tabId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_RELOAD, browserId, tabId),
    stop: (browserId: string, tabId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_STOP, browserId, tabId),
    getUrl: (browserId: string, tabId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_URL, browserId, tabId),
    getTitle: (browserId: string, tabId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_TITLE, browserId, tabId),
    canGoBack: (browserId: string, tabId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CAN_GO_BACK, browserId, tabId),
    canGoForward: (browserId: string, tabId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CAN_GO_FORWARD, browserId, tabId),
    destroy: (browserId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_DESTROY, browserId),
    /** 截取指定标签的快照 */
    capturePage: (browserId: string, tabId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CAPTURE_PAGE, browserId, tabId),
    /** 浏览器历史管理 */
    history: {
      save: (url: string, title?: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.BROWSER_HISTORY_SAVE, url, title),
      list: (limit?: number) =>
        ipcRenderer.invoke(IPC_CHANNELS.BROWSER_HISTORY_LIST, limit),
      delete: (id: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.BROWSER_HISTORY_DELETE, id),
      clear: () =>
        ipcRenderer.invoke(IPC_CHANNELS.BROWSER_HISTORY_CLEAR),
    },
    /** 浏览器书签管理 */
    bookmark: {
      add: (url: string, title?: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.BROWSER_BOOKMARK_ADD, url, title),
      list: () =>
        ipcRenderer.invoke(IPC_CHANNELS.BROWSER_BOOKMARK_LIST),
      delete: (id: string) =>
        ipcRenderer.invoke(IPC_CHANNELS.BROWSER_BOOKMARK_DELETE, id),
      reorder: (bookmarks: { id: string; sortOrder: number }[]) =>
        ipcRenderer.invoke(IPC_CHANNELS.BROWSER_BOOKMARK_REORDER, bookmarks),
    },
    onNavigating: (callback: (data: { browserId: string; tabId: string; url: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; tabId: string; url: string }) =>
        callback(data)
      ipcRenderer.on(IPC_CHANNELS.BROWSER_NAVIGATING, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_NAVIGATING, listener)
    },
    onDidNavigate: (callback: (data: { browserId: string; tabId: string; url: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; tabId: string; url: string }) =>
        callback(data)
      ipcRenderer.on(IPC_CHANNELS.BROWSER_DID_NAVIGATE, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_DID_NAVIGATE, listener)
    },
    onDidNavigateInPage: (callback: (data: { browserId: string; tabId: string; url: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; tabId: string; url: string }) =>
        callback(data)
      ipcRenderer.on(IPC_CHANNELS.BROWSER_DID_NAVIGATE_IN_PAGE, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_DID_NAVIGATE_IN_PAGE, listener)
    },
    onPageTitleUpdated: (callback: (data: { browserId: string; tabId: string; title: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; tabId: string; title: string }) =>
        callback(data)
      ipcRenderer.on(IPC_CHANNELS.BROWSER_PAGE_TITLE_UPDATED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_PAGE_TITLE_UPDATED, listener)
    },
    onPageFaviconUpdated: (callback: (data: { browserId: string; tabId: string; favicons: string[] }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; tabId: string; favicons: string[] }) =>
        callback(data)
      ipcRenderer.on(IPC_CHANNELS.BROWSER_PAGE_FAVICON_UPDATED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_PAGE_FAVICON_UPDATED, listener)
    },
    onWindowOpen: (callback: (data: { browserId: string; sourceTabId: string; newTabId: string; url: string; name: string; disposition: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; sourceTabId: string; newTabId: string; url: string; name: string; disposition: string }) =>
        callback(data)
      ipcRenderer.on(IPC_CHANNELS.BROWSER_WINDOW_OPEN, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_WINDOW_OPEN, listener)
    },
    /** 监听 BrowserView 右键菜单事件（转发坐标给渲染进程） */
    onContextMenu: (callback: (data: { browserId: string; tabId: string; x: number; y: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { browserId: string; tabId: string; x: number; y: number }) =>
        callback(data)
      ipcRenderer.on(IPC_CHANNELS.BROWSER_CONTEXT_MENU, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_CONTEXT_MENU, listener)
    },
  },

  // ===== 操作记录 =====
  operation: {
    /** 获取自上次读取后的新操作 */
    getNew: (sessionId: string, lastReadIndex: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPERATION_GET_NEW, sessionId, lastReadIndex),
    /** 按条件查询操作记录 */
    query: (sessionId: string, filter: { type?: string; panelId?: string; keyword?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPERATION_QUERY, sessionId, filter),
    /** 获取最近 N 条操作 */
    getRecent: (sessionId: string, count: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPERATION_GET_RECENT, sessionId, count),
  },

  // ===== 窗口控制 =====
  minimizeWindow: () => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE)
  },
  maximizeWindow: () => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE)
  },
  unmaximizeWindow: () => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_UNMAXIMIZE)
  },
  closeWindow: () => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE)
  },
  // 获取窗口是否最大化
  isMaximized: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED)
  },
  // 监听窗口最大化/还原事件
  onMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => {
      callback(isMaximized)
    }
    ipcRenderer.on(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_MAXIMIZED_CHANGED, listener)
  },

  // ===== 智能体管理 =====
  agent: {
    // --- AI 对话 ---

    /**
     * 发送消息给 AIAgent（异步，结果通过事件返回）
     */
    sendMessage: (content: string, attachments?: import('../core/types/agent').AttachedFile[], sessionId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_SEND_MESSAGE, content, attachments, sessionId),

    /**
     * 中断 AIAgent 当前运行
     */
    interrupt: (sessionId?: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_INTERRUPT, sessionId),

    /**
     * 查询 AIAgent 状态
     */
    getStatus: (sessionId?: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_STATUS, sessionId),

    // --- 事件监听器（返回 cleanup 函数）---

    /**
     * 监听流式文本增量
     */
    onStreaming: (callback: (data: { text: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { text: string }) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AGENT_STREAMING, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_STREAMING, listener)
    },

    /**
     * 监听思考/推理增量
     */
    onThinking: (callback: (data: { text: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { text: string }) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AGENT_THINKING, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_THINKING, listener)
    },

    /**
     * 监听工具调用
     */
    onToolCall: (callback: (data: {
      toolCallId: string
      toolName: string
      toolArgs?: Record<string, unknown>
    }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: {
        toolCallId: string
        toolName: string
        toolArgs?: Record<string, unknown>
      }) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AGENT_TOOL_CALL, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_TOOL_CALL, listener)
    },

    /**
     * 监听工具结果
     */
    onToolResult: (callback: (data: {
      toolCallId: string
      toolName: string
      success: boolean
      output: string
    }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: {
        toolCallId: string
        toolName: string
        success: boolean
        output: string
      }) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AGENT_TOOL_RESULT, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_TOOL_RESULT, listener)
    },

    /**
     * 监听新一轮 LLM 调用开始（清空流式文字）
     */
    onNewIteration: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on(IPC_CHANNELS.AGENT_NEW_ITERATION, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_NEW_ITERATION, listener)
    },

    /** 监听 LLM 开始输出工具调用参数（显示"准备工具调用..."过渡提示） */
    onToolCallingStarted: (callback: (data: {
      toolCallId: string
      toolName: string
    }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: {
        toolCallId: string
        toolName: string
      }) => {
        callback(data)
      }
      ipcRenderer.on(IPC_CHANNELS.AGENT_TOOL_CALLING_STARTED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_TOOL_CALLING_STARTED, listener)
    },

    /**
     * 监听状态变化
     */
    onStateChange: (callback: (data: {
      state: string
      apiCall?: number
      budgetRemaining?: number
    }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: {
        state: string
        apiCall?: number
        budgetRemaining?: number
      }) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AGENT_STATE_CHANGE, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_STATE_CHANGE, listener)
    },

    /**
     * 监听后台智能体活动（如对话历史压缩）
     */
    onBackgroundActivity: (callback: (data: {
      type: string       // 'compression' | 'indexing' 等
      status: string     // 'started' | 'progress' | 'completed' | 'error'
      message: string    // 描述信息，如 "正压缩对话历史..."
      progress?: number  // 进度 0-100（可选）
    }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: {
        type: string
        status: string
        message: string
        progress?: number
      }) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AGENT_BACKGROUND_ACTIVITY, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_BACKGROUND_ACTIVITY, listener)
    },

    // --- 交互式交互 ---

    /**
     * 监听危险命令审批请求
     */
    onApprovalRequest: (callback: (data: {
      command: string
      description: string
      sessionKey: string
    }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: {
        command: string
        description: string
        sessionKey: string
      }) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AGENT_REQUEST_APPROVAL, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_REQUEST_APPROVAL, listener)
    },

    /**
     * 发送审批结果回主进程
     */
    sendApprovalResult: (data: { action: string }) => {
      return ipcRenderer.invoke(IPC_CHANNELS.AGENT_APPROVAL_RESULT, data)
    },

    /**
     * 监听 clarify 提问请求
     */
    onClarifyRequest: (callback: (data: {
      question: string
      choices: string[] | null
    }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: {
        question: string
        choices: string[] | null
      }) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AGENT_CLARIFY, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_CLARIFY, listener)
    },

    /**
     * 发送 clarify 回答回主进程
     */
    sendClarifyResult: (data: { response: string }) => {
      return ipcRenderer.invoke(IPC_CHANNELS.AGENT_CLARIFY_RESULT, data)
    },

    /**
     * 清除当前会话的对话历史
     */
    clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_CLEAR_HISTORY),

    /**
     * 手动触发对话历史压缩
     */
    compressHistory: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_COMPRESS_HISTORY),

    /**
     * 获取初始上下文使用率（组件挂载时主动请求）
     */
    getContextUsage: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_CONTEXT_USAGE),
  },

  // ===== 文件附件 =====
  fileAttachment: {
    /**
     * 打开文件选择对话框
     */
    openFileDialog: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_DIALOG_OPEN),

    /**
     * 保存附件到临时目录
     */
    attachFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_ATTACH, filePath),

    /**
     * 读取文本文件内容
     */
    readAsText: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_AS_TEXT, filePath),

    /**
     * 读取文件为 base64
     */
    readAsBase64: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_AS_BASE64, filePath),

    /**
     * 检测文件类型
     */
    detectType: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_DETECT_TYPE, filePath),
  },

  // ===== 灵动岛窗口控制 =====
  dynamicIsland: {
    /** 获取窗口位置和大小 */
    getBounds: () => ipcRenderer.invoke('dynamic-island:get-bounds'),
    /** 获取主窗口边界（用于约束拖动范围） */
    getMainBounds: () => ipcRenderer.invoke('dynamic-island:get-main-bounds'),
    /** 设置窗口位置 */
    setPosition: (position: { x: number; y: number }) =>
      ipcRenderer.invoke('dynamic-island:set-position', position),
    /** 设置窗口大小（展开/收起时调整） */
    setSize: (size: { width: number; height: number }) =>
      ipcRenderer.invoke('dynamic-island:set-size', size),
    /** 开始拖动（通知主进程拖动窗口） */
    startDrag: () => ipcRenderer.invoke('dynamic-island:start-drag'),
    /** 关闭窗口 */
    close: () => ipcRenderer.invoke('dynamic-island:close'),
  },

  // ===== Task 任务管理 =====
  task: {
    /**
     * 获取任务列表
     */
    list: () => ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST),

    /**
     * 获取单个任务完整内容
     */
    view: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.TASK_VIEW, name),

    /**
     * 管理任务（创建/编辑/删除）
     */
    manage: (action: string, name?: string, content?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_MANAGE, { action, name, content }),
  },

  // ===== Nexus 连接管理 =====
  nexus: {
    /**
     * 请求连接终端面板（将智能体命令路由到此面板的 PTY）
     */
    connect: (panelId: string, ptyId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NEXUS_CONNECT, panelId, ptyId),

    /**
     * 请求连接浏览器面板（将智能体操作路由到此浏览器面板）
     */
    connectBrowser: (panelId: string, browserId: string, tabId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NEXUS_CONNECT_BROWSER, panelId, browserId, tabId),

    /**
     * 请求连接文件面板（将智能体文件操作关联到此文件面板）
     */
    connectFile: (panelId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.NEXUS_CONNECT_FILE, panelId),

    /**
     * 请求断开 Nexus 连接
     */
    disconnect: () =>
      ipcRenderer.invoke(IPC_CHANNELS.NEXUS_DISCONNECT),

    /**
     * 监听连接状态变化
     */
    onConnectionStateChanged: (callback: (data: { panelId: string | null; connected: boolean }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { panelId: string | null; connected: boolean }) =>
        callback(data)
      ipcRenderer.on(IPC_CHANNELS.NEXUS_CONNECTION_STATE_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.NEXUS_CONNECTION_STATE_CHANGED, listener)
    },
  },

  // ===== 输入历史 =====
  inputHistory: {
    /** 保存一条输入历史 */
    add: (text: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.INPUT_HISTORY_ADD, text),
    /** 查询历史记录 */
    list: (limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.INPUT_HISTORY_LIST, limit),
    /** 删除单条记录 */
    delete: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.INPUT_HISTORY_DELETE, id),
    /** 清空所有记录 */
    clear: () =>
      ipcRenderer.invoke(IPC_CHANNELS.INPUT_HISTORY_CLEAR),
  },

  // ===== 配置变更事件（主进程 → 渲染进程） =====
  onConfigChanged: (callback: (data: { key: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { key: string }) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.CONFIG_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CONFIG_CHANGED, listener)
  },

  // ===== 退出前保存快照 =====
  onSaveOnExit: (callback: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => callback()
    ipcRenderer.on(IPC_CHANNELS.SNAPSHOT_SAVE_ON_EXIT, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SNAPSHOT_SAVE_ON_EXIT, listener)
  },
}

// 暴露给渲染进程
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export {}
