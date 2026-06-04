/**
 * Electron API 类型声明
 */

import type {
  Session,
  Snapshot,
  SnapshotData,
  ConfigKey,
  ConfigValueMap,
  BrowserTab,
  Bookmark,
  AttachedFile,
} from '@core/types'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export interface ElectronAPI {
  // 配置管理（类型安全）
  config: {
    save: <K extends ConfigKey>(key: K, value: ConfigValueMap[K]) => Promise<void>
    get: <K extends ConfigKey>(key: K) => Promise<ConfigValueMap[K] | null>
    getAll: () => Promise<Partial<ConfigValueMap>>
    delete: (key: string) => Promise<void>
    testModel: (config: {
      provider: string
      apiUrl: string
      apiKey: string
      model: string
    }) => Promise<{
      success: boolean
      contextLength?: number
      supportsStream: boolean
      supportsInvoke: boolean
      supportsVision: boolean
      error?: string
    }>
    testEmail: (config: {
      imapHost: string
      imapPort: number
      imapSecure: boolean
      smtpHost: string
      smtpPort: number
      smtpSecure: boolean
      email: string
      appPassword: string
    }) => Promise<{
      success: boolean
      message?: string
      error?: string
    }>
    getModelCatalog: () => Promise<Array<{
      id: number
      displayName: string
      modelName: string
      provider: string
      interfaceType: string
      defaultApiUrl: string
      contextLength: number
      description: string | null
      sortWeight: number
    }>>
    /** 监听语言变更事件（灵动岛窗口使用） */
    onLanguageChanged: (callback: (lang: string) => void) => () => void
  }

  // 会话管理
  session: {
    create: (name?: string) => Promise<Session>
    list: () => Promise<Session[]>
    get: (id: string) => Promise<Session | null>
    update: (id: string, name: string) => Promise<void>
    delete: (id: string) => Promise<void>
    setActive: (id: string) => Promise<void>
    getActive: () => Promise<Session | null>
    getRecent: (limit?: number) => Promise<Session[]>
  }

  // 快照管理
  snapshot: {
    save: (sessionId: string, data: SnapshotData) => Promise<string>
    list: (sessionId: string) => Promise<Snapshot[]>
    get: (id: string) => Promise<Snapshot | null>
    delete: (id: string) => Promise<void>
    getLatest: (sessionId: string) => Promise<Snapshot | null>
  }

  // PTY 管理
  pty: {
    create: (params: {
      shell?: string
      cwd?: string
      cols?: number
      rows?: number
      panelId?: string
      sessionId?: string
    }) => Promise<string>
    write: (ptyId: string, data: string) => Promise<void>
    resize: (ptyId: string, cols: number, rows: number) => Promise<void>
    kill: (ptyId: string) => Promise<void>
    onData: (
      callback: (data: { ptyId: string; data: string }) => void
    ) => () => void
    /** 监听终端 cwd 变化（通过 OSC 7 序列追踪） */
    onCwdChanged: (
      callback: (data: { ptyId: string; cwd: string }) => void
    ) => () => void
  }

  // 应用信息
  app: {
    getPath: (name: string) => Promise<string>
    getVersion: () => Promise<string>
    getResourcePath: (filename: string) => Promise<string | null>
    /** 获取操作系统 locale */
    getLocale: () => Promise<string>
  }

  // 路径检查
  path: {
    exists: (path: string) => Promise<{ exists: boolean; path: string }>
    autocomplete: (input: string) => Promise<{
      suggestions: Array<{ name: string; path: string; isDirectory: boolean }>
    }>
  }

  // 平台信息
  platform: {
    isMac: boolean
    isWindows: boolean
    isLinux: boolean
  }

  // 剪贴板
  clipboard: {
    readText: () => Promise<string>
    writeText: (text: string) => Promise<void>
    readFiles: () => Promise<string[]>
  }

  // 文件系统
  fs: {
    readdir: (dirPath: string) => Promise<{
      items: Array<{ name: string; path: string; type: 'file' | 'directory' | 'symlink'; size?: number; mtime?: number }>
      error: string | null
    }>
    readFile: (filePath: string) => Promise<{
      content: string
      error: string | null
    }>
    /** 写入文件内容 */
    writeFile: (filePath: string, content: string) => Promise<{
      error: string | null
    }>
    /** 格式化文件大小为人类可读字符串 */
    formatSize?: (bytes: number) => string
    /** 复制文件或目录 */
    copyFile: (src: string, dst: string) => Promise<{ error: string | null }>
    /** 检查路径是否存在 */
    exists: (filePath: string) => Promise<{ exists: boolean }>
    /** 监听目录变化 */
    watchDir: (dirPath: string) => Promise<{ error: string | null }>
    /** 取消监听目录 */
    unwatchDir: (dirPath: string) => Promise<{ error: string | null }>
    /** 监听目录变化事件 */
    onDirChanged: (callback: (data: { dirPath: string }) => void) => () => void
    /** 监听文件变化 */
    watchFile: (filePath: string) => Promise<{ error: string | null }>
    /** 取消监听文件 */
    unwatchFile: (filePath: string) => Promise<{ error: string | null }>
    /** 监听文件变化事件 */
    onFileChanged: (
      callback: (data: { filePath: string; eventType: string; newPath?: string }) => void
    ) => () => void
    /** 将文件或目录移动到系统废纸篓 */
    trashItem: (paths: string[]) => Promise<{
      successCount: number
      errorCount: number
      errors: string[]
    }>
    /** 读取文件为 base64（用于图片/PDF 预览） */
    readFileAsBase64: (filePath: string) => Promise<{
      base64: string
      mimeType: string
      error: string | null
    }>
    /** 检测系统是否安装 LibreOffice */
    checkLibreOffice: () => Promise<{
      success: boolean
      installed: boolean
      path: string
      error?: string
    }>
    /** 使用 LibreOffice 将文件转换为 PDF */
    convertToPdf: (filePath: string) => Promise<{
      success: boolean
      pdfPath: string
      error: string | null
    }>
    /** 重命名文件或目录 */
    rename: (oldPath: string, newPath: string) => Promise<{ error: string | null }>
    /** 创建文件夹（自动处理重名冲突） */
    createDir: (dirPath: string) => Promise<{ resolvedPath: string; error: string | null }>
    /** 创建文件（自动处理重名冲突） */
    createFile: (filePath: string, content?: string) => Promise<{ resolvedPath: string; error: string | null }>
    /** 复制文件/目录（智能体文件管理工具使用） */
    copyFileItem: (src: string, dst: string) => Promise<{ error: string | null }>
    /** 移动文件/目录（智能体文件管理工具使用） */
    moveFileItem: (src: string, dst: string) => Promise<{ error: string | null }>
    /** 移入回收站（智能体文件管理工具使用） */
    trashFileItem: (paths: string | string[]) => Promise<{ successCount: number; errorCount: number; errors: string[] }>
    /** 重命名文件/目录（智能体文件管理工具使用） */
    renameFileItem: (oldPath: string, newName: string) => Promise<{ error: string | null; newPath?: string }>
    openWithSystem: (filePath: string) => Promise<{ error: string | null }>
  }

  // 浏览器控制
  browser: {
    /** 创建浏览器面板实例（不含 View） */
    createBrowserView: (browserId: string) => Promise<void>
    /** 在面板中创建新标签 */
    createTab: (browserId: string, tabId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
    /** 移除指定标签 */
    removeTab: (browserId: string, tabId: string) => Promise<void>
    /** 切换活动标签 */
    setActiveView: (browserId: string, tabId: string) => Promise<void>
    /** 设置 BrowserView 边界 */
    setBounds: (browserId: string, tabId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
    /** 导航到指定 URL */
    navigate: (browserId: string, tabId: string, url: string) => Promise<void>
    /** 后退 */
    goBack: (browserId: string, tabId: string) => Promise<void>
    /** 前进 */
    goForward: (browserId: string, tabId: string) => Promise<void>
    /** 刷新 */
    reload: (browserId: string, tabId: string) => Promise<void>
    /** 停止加载 */
    stop: (browserId: string, tabId: string) => Promise<void>
    /** 获取当前 URL */
    getUrl: (browserId: string, tabId: string) => Promise<string>
    /** 获取页面标题 */
    getTitle: (browserId: string, tabId: string) => Promise<string>
    /** 是否可以后退 */
    canGoBack: (browserId: string, tabId: string) => Promise<boolean>
    /** 是否可以前进 */
    canGoForward: (browserId: string, tabId: string) => Promise<boolean>
    /** 销毁浏览器面板 */
    destroy: (browserId: string) => Promise<void>
    /** 截取指定标签的快照，返回 base64 dataURL */
    capturePage: (browserId: string, tabId: string) => Promise<string>
    /** 锁定标签：注入 CSS/JS 阻止用户交互（智能体操作不受影响） */
    lockTab: (browserId: string, tabId: string) => Promise<void>
    /** 解锁标签：移除注入的 CSS/JS 恢复用户交互 */
    unlockTab: (browserId: string, tabId: string) => Promise<void>
    /** 浏览器历史管理 */
    history: {
      save: (url: string, title?: string) => Promise<void>
      list: (limit?: number) => Promise<Array<{ id: string; url: string; title?: string; visitedAt: number }>>
      delete: (id: string) => Promise<void>
      clear: () => Promise<void>
    }
    /** 浏览器书签管理 */
    bookmark: {
      add: (url: string, title?: string) => Promise<void>
      list: () => Promise<Bookmark[]>
      delete: (id: string) => Promise<void>
      reorder: (bookmarks: { id: string; sortOrder: number }[]) => Promise<void>
    }
    /** 监听导航开始事件 */
    onNavigating: (callback: (data: { browserId: string; tabId: string; url: string }) => void) => () => void
    /** 监听导航完成事件 */
    onDidNavigate: (callback: (data: { browserId: string; tabId: string; url: string }) => void) => () => void
    /** 监听页面内导航（hash 变化） */
    onDidNavigateInPage: (callback: (data: { browserId: string; tabId: string; url: string }) => void) => () => void
    /** 监听页面标题更新 */
    onPageTitleUpdated: (callback: (data: { browserId: string; tabId: string; title: string }) => void) => () => void
    /** 监听页面 favicon 更新 */
    onPageFaviconUpdated: (callback: (data: { browserId: string; tabId: string; favicons: string[] }) => void) => () => void
    /** 监听 window.open() 拦截事件（改为新标签） */
    onWindowOpen: (callback: (data: { browserId: string; sourceTabId: string; newTabId: string; url: string; name: string; disposition: string }) => void) => () => void
    /** 监听 BrowserView 右键菜单事件（转发坐标给渲染进程） */
    onContextMenu: (callback: (data: { browserId: string; tabId: string; x: number; y: number }) => void) => () => void
  }

  // 窗口控制
  minimizeWindow: () => void
  maximizeWindow: () => void
  unmaximizeWindow: () => void
  closeWindow: () => void
  isMaximized: () => Promise<boolean>
  onMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void

  // 操作记录
  operation: {
    /** 获取自上次读取后的新记录 */
    getNew: (sessionId: string, lastReadIndex: number) => Promise<Array<{ index: number; time: string; panelType: string; panelId: string; text: string; raw: string }>>
    /** 按条件查询 */
    query: (sessionId: string, filter: { panelType?: string; panelId?: string; keyword?: string }) => Promise<Array<{ index: number; time: string; panelType: string; panelId: string; text: string; raw: string }>>
    /** 获取最近 N 条 */
    getRecent: (sessionId: string, count: number) => Promise<Array<{ index: number; time: string; panelType: string; panelId: string; text: string; raw: string }>>
  }

  // 智能体管理
  agent: {
    /** 发送消息给 AIAgent（异步，结果通过事件返回） */
    sendMessage: (content: string, attachments?: AttachedFile[], sessionId?: string) => Promise<{ success: boolean; error?: string }>
    /** 中断 AIAgent 当前运行 */
    interrupt: (sessionId?: string) => Promise<void>
    /** 查询 AIAgent 状态 */
    getStatus: (sessionId?: string) => Promise<{ state: string; sessionId: string | null }>
    /** 设置计划模式开关 */
    setPlanMode: (enabled: boolean, sessionId?: string) => Promise<void>
    /** 查询当前计划模式状态 */
    getPlanMode: (sessionId?: string) => Promise<boolean>

    /** 监听流式文本增量 */
    onStreaming: (callback: (data: { text: string }) => void) => () => void
    /** 监听思考/推理增量 */
    onThinking: (callback: (data: { text: string }) => void) => () => void
    /** 监听工具调用 */
    onToolCall: (callback: (data: {
      toolCallId: string
      toolName: string
      toolArgs?: Record<string, unknown>
    }) => void) => () => void
    /** 监听工具结果 */
    onToolResult: (callback: (data: {
      toolCallId: string
      toolName: string
      success: boolean
      output: string
    }) => void) => () => void
    /** 监听新一轮 LLM 调用开始（清空流式文字） */
    onNewIteration: (callback: () => void) => () => void
    /** 监听 LLM 开始输出工具调用参数（显示"准备工具调用..."过渡提示） */
    onToolCallingStarted: (callback: (data: {
      toolCallId: string
      toolName: string
    }) => void) => () => void
    /** 监听状态变化 */
    onStateChange: (callback: (data: {
      state: string
      apiCall?: number
      budgetRemaining?: number
      finalResponse?: string | null
      errorMessage?: string | null
      contextUsagePercent?: number
    }) => void) => () => void

    /** 监听后台智能体活动（如对话历史压缩） */
    onBackgroundActivity: (callback: (data: {
      type: string
      status: string
      message: string
      progress?: number
    }) => void) => () => void

    /** 监听计划更新 (todo 任务列表变更) */
    onPlanUpdate: (callback: (data: {
      todos: Array<{ id: string; content: string; status: string }>
    }) => void) => () => void

    /** 监听 AI 自动切换计划模式事件 */
    onPlanModeChanged: (callback: (data: { planMode: boolean }) => void) => () => void

    // --- 交互式交互 ---

    /** 监听危险命令审批请求 */
    onApprovalRequest: (callback: (data: {
      command: string
      description: string
      sessionKey: string
    }) => void) => () => void
    /** 发送审批结果回主进程 */
    sendApprovalResult: (data: { action: string }) => Promise<{ success: boolean }>

    /** 监听 clarify 提问请求 */
    onClarifyRequest: (callback: (data: {
      question: string
      choices: string[] | null
    }) => void) => () => void
    /** 发送 clarify 回答回主进程 */
    sendClarifyResult: (data: { response: string }) => Promise<{ success: boolean }>

    /** 清除指定会话的对话历史 */
    clearHistory: (sessionId: string) => Promise<{ success: boolean; error?: string }>

    /** 手动触发指定会话的对话历史压缩 */
    compressHistory: (sessionId: string) => Promise<{ success: boolean }>

    /** 获取初始上下文使用率 */
    getContextUsage: () => Promise<{ contextUsagePercent: number }>

    /** 加载指定会话的对话历史（用于 UI 恢复） */
    loadHistory: (sessionId: string) => Promise<Array<{ question: string; answer: string; timestamp: number }>>
  }

  // 文件附件
  fileAttachment: {
    /** 打开文件选择对话框 */
    openFileDialog: () => Promise<{
      files: Array<{ name: string; path: string; type: 'image' | 'text' | 'other'; size: number; mimeType: string }> | null
      error?: string
    }>
    /** 保存附件到临时目录 */
    attachFile: (filePath: string) => Promise<{ savedPath: string; error?: string }>
    /** 读取文本文件内容 */
    readAsText: (filePath: string) => Promise<{ content: string; error?: string }>
    /** 读取文件为 base64 */
    readAsBase64: (filePath: string) => Promise<{ base64: string; mimeType: string; error?: string }>
    /** 检测文件类型 */
    detectType: (filePath: string) => Promise<{
      type: string
      exists: boolean
      isFile?: boolean
      size?: number
      extension?: string
      error?: string
    }>
  }

  // 灵动岛窗口控制
  dynamicIsland: {
    /** 获取窗口位置和大小 */
    getBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>
    /** 获取主窗口边界（用于约束拖动范围） */
    getMainBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>
    /** 设置窗口位置 */
    setPosition: (position: { x: number; y: number }) => Promise<boolean>
    /** 设置窗口大小（展开/收起时调整） */
    setSize: (size: { width: number; height: number }) => Promise<boolean>
    /** 开始拖动（通知主进程拖动窗口） */
    startDrag: () => Promise<boolean>
    /** 关闭窗口 */
    close: () => Promise<boolean>
  }

  // Task 任务管理
  task: {
    /** 获取任务列表 */
    list: () => Promise<{ success: boolean; tasks?: Array<{ name: string; title: string; description: string }>; error?: string }>
    /** 获取单个任务完整内容 */
    view: (name: string) => Promise<{ success: boolean; content?: { name: string; title: string; content: string }; error?: string }>
    /** 管理任务（创建/编辑/删除） */
    manage: (action: string, name?: string, content?: string) => Promise<{ success: boolean; message: string }>
  }

  // Skill 技能管理
  skill: {
    /** 获取技能列表 */
    list: () => Promise<{ success: boolean; skills?: Array<{ name: string; description: string; category: string | null; path: string; platformCompatible: boolean; readinessStatus: string; trustLevel: string; missingEnvVars: string[] }>; error?: string }>
    /** 获取单个技能完整内容 */
    view: (name: string) => Promise<{ success: boolean; content?: { name: string; description: string; content: string; linkedFiles?: { references?: string[]; templates?: string[]; assets?: string[]; scripts?: string[] } | null; tags: string[]; relatedSkills: string[]; warnings: string[] }; error?: string }>
    /** 管理技能（创建/编辑/删除） */
    manage: (action: string, name?: string, content?: string) => Promise<{ success: boolean; message: string }>
  }

  // Nexus 连接管理
  nexus: {
    /** 请求连接终端面板 */
    connect: (panelId: string, ptyId: string) => Promise<{ success: boolean; error?: string }>
    /** 请求连接浏览器面板 */
    connectBrowser: (panelId: string) => Promise<{ success: boolean; error?: string }>
    /** 请求连接文件面板 */
    connectFile: (panelId: string) => Promise<{ success: boolean; error?: string }>
    /** 请求断开所有连接 */
    disconnect: () => Promise<{ success: boolean; error?: string }>
    /** 仅断开浏览器轨连接 */
    disconnectBrowser: () => Promise<{ success: boolean; error?: string }>
    /** 仅断开数据轨连接 */
    disconnectData: () => Promise<{ success: boolean; error?: string }>
    /** 监听连接状态变化 */
    onConnectionStateChanged: (callback: (data: { panelId: string | null; connected: boolean; track: 'browser' | 'data' }) => void) => () => void
  }

  // 输入历史
  inputHistory: {
    add: (text: string) => Promise<void>
    list: (limit?: number) => Promise<Array<{ id: number; text: string; createdAt: number }>>
    delete: (id: number) => Promise<void>
    clear: () => Promise<void>
  }

  // 引导窗口
  /** 引导完成：保存配置并创建主窗口 */
  onboardingComplete: (agentConfig: any, subAgentConfig: any, emailConfig?: {
    enabled: boolean
    account: {
      email: string
      appPassword: string
      imapHost: string
      imapPort: number
      imapSecure: boolean
      smtpHost: string
      smtpPort: number
      smtpSecure: boolean
      displayName?: string
    } | null
  }) => Promise<{ success: boolean; error?: string }>
  /** 跳过引导：直接创建主窗口 */
  onboardingSkip: () => Promise<{ success: boolean; error?: string }>

  // 记忆管理
  memory: {
    /** 获取记忆列表 */
    list: () => Promise<{ success: boolean; memories?: Array<{ id: string; content: string; scope: 'memory' | 'user'; source: 'entry' | 'fact'; trustScore?: number; retrievalCount?: number; createdAt: number; updatedAt: number }>; error?: string }>
    /** 获取单条记忆详情 */
    view: (id: string, source: string) => Promise<{ success: boolean; memory?: { id: string; content: string; scope: 'memory' | 'user'; createdAt: number; updatedAt: number }; error?: string }>
    /** 删除记忆 */
    delete: (id: string, source: string) => Promise<{ success: boolean; message: string; error?: string }>
  }

  // 自动更新
  update: {
    /** 检查更新 */
    checkForUpdate: () => Promise<{ success: boolean; error?: string }>
    /** 下载更新 */
    downloadUpdate: () => Promise<{ success: boolean; error?: string }>
    /** 安装更新并重启 */
    installAndRestart: () => Promise<void>
    /** 监听更新状态变更 */
    onUpdateState: (callback: (data: { state: string; version?: string; progress?: number; releaseNotes?: string }) => void) => () => void
    /** 监听更新错误 */
    onUpdateError: (callback: (data: { error: string }) => void) => () => void
  }

  // 目录档案 NEXUS.md
  nexusProfile: {
    /** 读取指定目录的 NEXUS.md */
    read: (dir: string) => Promise<{ exists: boolean; content: string; error?: string }>
    /** 写入指定目录的 NEXUS.md */
    write: (dir: string, content: string) => Promise<{ success: boolean; error?: string }>
    /** 检查目录下是否存在 NEXUS.md */
    exists: (dir: string) => Promise<{ exists: boolean }>
    /** 自动生成指定目录的 NEXUS.md */
    generate: (dir: string) => Promise<{ success: boolean; error?: string }>
  }

  // 配置变更事件
  onConfigChanged: (callback: (data: { key: string }) => void) => () => void

  // 退出前保存快照
  onSaveOnExit: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
