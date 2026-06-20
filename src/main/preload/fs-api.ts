/**
 * 文件系统 API
 * 提供文件/目录的读写、监听、移动、重命名、回收站等操作
 */

import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'

export const fs = {
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
   * 检测系统是否安装 LibreOffice
   * @returns { success: boolean, installed: boolean, path: string }
   */
  checkLibreOffice: () =>
    ipcRenderer.invoke(IPC_CHANNELS.FS_CHECK_LIBREOFFICE),
  /**
   * 使用 LibreOffice 将文件转换为 PDF
   * @param filePath - 源文件路径
   * @returns { success: boolean, pdfPath: string, error: string | null }
   */
  convertToPdf: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FS_CONVERT_TO_PDF, filePath),
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
  /**
   * 使用系统默认程序打开文件（如系统文件管理器双击行为）
   * @param filePath - 文件路径
   * @returns { error: string | null }
   */
  openWithSystem: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FS_OPEN_WITH_SYSTEM, filePath),
}
