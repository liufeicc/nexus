/**
 * 内置工具集合
 *
 * 导出所有内置工具，方便批量注册到 ToolRegistry。
 */

import { terminalTool } from './terminal-tool'
import { browserTool } from './browser-tool'
import { readFileTool, writeFileTool, searchFilesTool, patchTool, copyFileTool, moveFileTool, trashFileTool, renameFileTool } from './file-tools'
import { createTodoTool } from './todo-tool'
import { webSearchTool, webExtractTool } from './web-tools'
import { clarifyTool } from './clarify-tool'
import { emailReadTool, emailViewTool, emailSendTool, emailMarkReadTool } from './email-tools'
import { nexusProfileReadTool, nexusProfileWriteTool, nexusProfileScanTool } from './nexus-profile-tool'
import { AgentSessionState } from '../session-state'

export { terminalTool } from './terminal-tool'
export { browserTool } from './browser-tool'
export { readFileTool, writeFileTool, searchFilesTool, patchTool, copyFileTool, moveFileTool, trashFileTool, renameFileTool } from './file-tools'
export { createTodoTool } from './todo-tool'
export { webSearchTool, webExtractTool } from './web-tools'
export { clarifyTool } from './clarify-tool'
export { emailReadTool, emailViewTool, emailSendTool, emailMarkReadTool } from './email-tools'
export { nexusProfileReadTool, nexusProfileWriteTool, nexusProfileScanTool } from './nexus-profile-tool'

/**
 * 创建所有内置工具实例，绑定到指定的会话状态。
 */
export function createBuiltTools(state: AgentSessionState) {
  return [
    terminalTool,
    browserTool,
    readFileTool,
    writeFileTool,
    searchFilesTool,
    patchTool,
    copyFileTool,
    moveFileTool,
    trashFileTool,
    renameFileTool,
    createTodoTool(() => state.todoStore),
    webSearchTool,
    webExtractTool,
    clarifyTool,
    emailReadTool,
    emailViewTool,
    emailSendTool,
    emailMarkReadTool,
    nexusProfileReadTool,
    nexusProfileWriteTool,
    nexusProfileScanTool,
  ]
}
