/**
 * IPC 通信频道定义
 */

export const IPC_CHANNELS = {
  // 会话管理
  SESSION_CREATE: 'session:create',
  SESSION_LIST: 'session:list',
  SESSION_GET: 'session:get',
  SESSION_UPDATE: 'session:update',
  SESSION_DELETE: 'session:delete',
  SESSION_SET_ACTIVE: 'session:set-active',
  SESSION_GET_ACTIVE: 'session:get-active',
  SESSION_GET_RECENT: 'session:get-recent',

  // 快照管理
  SNAPSHOT_SAVE: 'snapshot:save',
  SNAPSHOT_GET: 'snapshot:get',
  SNAPSHOT_LIST: 'snapshot:list',
  SNAPSHOT_DELETE: 'snapshot:delete',
  SNAPSHOT_GET_LATEST: 'snapshot:get-latest',
  SNAPSHOT_SAVE_ON_EXIT: 'snapshot:save-on-exit', // 退出前保存快照（主进程 → 渲染进程）

  // 配置管理
  CONFIG_SAVE: 'config:save',
  CONFIG_GET: 'config:get',
  CONFIG_GET_ALL: 'config:get-all',
  CONFIG_DELETE: 'config:delete',
  CONFIG_TEST_MODEL: 'config:test-model',
  CONFIG_CHANGED: 'config:changed', // 配置修改后主进程 → 渲染进程通知

  // PTY 管理
  PTY_CREATE: 'pty:create',
  PTY_DATA: 'pty:data', // PTY → 渲染进程的数据流
  PTY_WRITE: 'pty:write', // 渲染进程 → PTY 的数据写入
  PTY_RESIZE: 'pty:resize',
  PTY_KILL: 'pty:kill',
  PTY_CWD_CHANGED: 'pty:cwd-changed', // 终端 cwd 变化事件（主进程 → 渲染进程）

  // 窗口管理
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_UNMAXIMIZE: 'window:unmaximize',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_CLOSE: 'window:close',
  WINDOW_MAXIMIZED_CHANGED: 'window:maximized-changed',

  // 应用管理
  APP_GET_PATH: 'app:get-path',
  APP_GET_VERSION: 'app:get-version',

  // 路径检查
  PATH_EXISTS: 'path:exists',
  PATH_AUTOCOMPLETE: 'path:autocomplete',

  // 剪贴板
  CLIPBOARD_READ_TEXT: 'clipboard:read-text',
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text',

  // 文件系统
  FS_READ_DIR: 'fs:read-dir',
  FS_READ_FILE: 'fs:read-file',
  FS_COPY_FILE: 'fs:copy-file',
  FS_EXISTS: 'fs:exists',
  FS_WATCH_DIR: 'fs:watch-dir',
  FS_UNWATCH_DIR: 'fs:unwatch-dir',
  FS_DIR_CHANGED: 'fs:dir-changed',
  FS_WATCH_FILE: 'fs:watch-file',
  FS_UNWATCH_FILE: 'fs:unwatch-file',
  FS_FILE_CHANGED: 'fs:file-changed',
  FS_TRASH_ITEM: 'fs:trash-item',
  FS_READ_FILE_AS_BASE64: 'fs:read-file-as-base64',
  FS_RENAME: 'fs:rename',
  FS_WRITE_FILE: 'fs:write-file',
  FS_CREATE_DIR: 'fs:create-dir',
  FS_CREATE_FILE: 'fs:create-file',

  // 浏览器管理
  BROWSER_CREATE: 'browser:create',
  BROWSER_CREATE_TAB: 'browser:create-tab',
  BROWSER_REMOVE_TAB: 'browser:remove-tab',
  BROWSER_SET_ACTIVE_VIEW: 'browser:set-active-view',
  BROWSER_SET_BOUNDS: 'browser:set-bounds',
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_GO_BACK: 'browser:go-back',
  BROWSER_GO_FORWARD: 'browser:go-forward',
  BROWSER_RELOAD: 'browser:reload',
  BROWSER_STOP: 'browser:stop',
  BROWSER_GET_URL: 'browser:get-url',
  BROWSER_GET_TITLE: 'browser:get-title',
  BROWSER_CAN_GO_BACK: 'browser:can-go-back',
  BROWSER_CAN_GO_FORWARD: 'browser:can-go-forward',
  BROWSER_DESTROY: 'browser:destroy',
  BROWSER_CAPTURE_PAGE: 'browser:capture-page',
  // 浏览器历史
  BROWSER_HISTORY_SAVE: 'browser:history:save',
  BROWSER_HISTORY_LIST: 'browser:history:list',
  BROWSER_HISTORY_DELETE: 'browser:history:delete',
  BROWSER_HISTORY_CLEAR: 'browser:history:clear',

  // 浏览器书签
  BROWSER_BOOKMARK_ADD: 'browser:bookmark:add',
  BROWSER_BOOKMARK_LIST: 'browser:bookmark:list',
  BROWSER_BOOKMARK_DELETE: 'browser:bookmark:delete',
  BROWSER_BOOKMARK_REORDER: 'browser:bookmark:reorder',

  // 浏览器事件（主进程 → 渲染进程）
  BROWSER_NAVIGATING: 'browser:navigating',
  BROWSER_DID_NAVIGATE: 'browser:did-navigate',
  BROWSER_DID_NAVIGATE_IN_PAGE: 'browser:did-navigate-in-page',
  BROWSER_PAGE_TITLE_UPDATED: 'browser:page-title-updated',
  BROWSER_PAGE_FAVICON_UPDATED: 'browser:page-favicon-updated',
  BROWSER_CONTEXT_MENU: 'browser:context-menu',
  BROWSER_WINDOW_OPEN: 'browser:window-open', // window.open() 拦截，改为新标签

  // 操作记录读取（渲染进程 → 主进程）
  OPERATION_GET_NEW: 'operation:get-new',
  OPERATION_QUERY: 'operation:query',
  OPERATION_GET_RECENT: 'operation:get-recent',

  // 智能体 AI 对话（渲染进程 → 主进程）
  AGENT_SEND_MESSAGE: 'agent:send-message',
  AGENT_INTERRUPT: 'agent:interrupt',
  AGENT_GET_STATUS: 'agent:get-status',

  // 智能体 AI 事件（主进程 → 渲染进程）
  AGENT_STREAMING: 'agent:streaming',
  AGENT_THINKING: 'agent:thinking',
  AGENT_TOOL_CALL: 'agent:tool-call',
  AGENT_TOOL_RESULT: 'agent:tool-result',
  AGENT_STATE_CHANGE: 'agent:state-change',
  AGENT_NEW_ITERATION: 'agent:new-iteration',
  AGENT_TOOL_CALLING_STARTED: 'agent:tool-calling-started',

  // 后台智能体活动事件（主进程 → 渲染进程）
  AGENT_BACKGROUND_ACTIVITY: 'agent:background-activity',

  // 智能体交互式交互（主进程 ↔ 渲染进程）
  AGENT_REQUEST_APPROVAL: 'agent:request-approval',
  AGENT_APPROVAL_RESULT: 'agent:approval-result',
  AGENT_CLARIFY: 'agent:clarify',
  AGENT_CLARIFY_RESULT: 'agent:clarify-result',

  // 文件附件（渲染进程 ↔ 主进程）
  FILE_ATTACH: 'file:attach',           // 保存附件到临时目录
  FILE_READ_AS_TEXT: 'file:read-as-text', // 读取文本文件内容
  FILE_READ_AS_BASE64: 'file:read-as-base64', // 读取文件为 base64
  FILE_DIALOG_OPEN: 'file:dialog-open',  // 打开文件选择对话框
  FILE_DETECT_TYPE: 'file:detect-type',  // 检测文件类型

  // 文件管理工具（智能体调用）
  FILE_COPY: 'file:copy',        // 复制文件/目录
  FILE_MOVE: 'file:move',        // 移动文件/目录（剪切）
  FILE_TRASH: 'file:trash',      // 移入回收站
  FILE_RENAME: 'file:rename',    // 重命名文件/目录

  // Task 任务管理（渲染进程 ↔ 主进程）
  TASK_LIST: 'task:list',               // 获取任务列表
  TASK_VIEW: 'task:view',               // 获取单个任务完整内容
  TASK_MANAGE: 'task:manage',            // 创建/编辑/删除任务

  // Nexus 连接管理（渲染进程 ↔ 主进程）
  NEXUS_CONNECT: 'nexus:connect',          // 请求连接终端面板
  NEXUS_CONNECT_BROWSER: 'nexus:connect-browser',  // 请求连接浏览器面板
  NEXUS_CONNECT_FILE: 'nexus:connect-file',        // 请求连接文件面板
  NEXUS_DISCONNECT: 'nexus:disconnect',    // 请求断开连接
  NEXUS_CONNECTION_STATE_CHANGED: 'nexus:connection-state-changed',  // 连接状态变化事件

  // 历史对话管理（渲染进程 ↔ 主进程）
  AGENT_CLEAR_HISTORY: 'agent:clear-history',  // 清除当前会话的对话历史
  AGENT_COMPRESS_HISTORY: 'agent:compress-history',  // 手动触发对话历史压缩
  AGENT_GET_CONTEXT_USAGE: 'agent:get-context-usage',  // 获取初始上下文使用率

  // 输入历史管理（DynamicIsland 输入记录）
  INPUT_HISTORY_ADD: 'input-history:add',
  INPUT_HISTORY_LIST: 'input-history:list',
  INPUT_HISTORY_DELETE: 'input-history:delete',
  INPUT_HISTORY_CLEAR: 'input-history:clear',
} as const

export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
