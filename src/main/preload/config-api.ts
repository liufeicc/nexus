/**
 * 配置管理 API
 * 提供应用配置的读写、模型测试、邮件测试等功能
 */

import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'

export const config = {
  save: (key: string, value: any) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE, key, value),
  get: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET, key),
  getAll: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET_ALL),
  delete: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_DELETE, key),
  testModel: (config: { provider: string; apiUrl: string; apiKey: string; model: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONFIG_TEST_MODEL, config),
  getModelCatalog: () =>
    ipcRenderer.invoke(IPC_CHANNELS.MODEL_CATALOG_GET),
  /** 测试邮件连接（IMAP + SMTP） */
  testEmail: (config: {
    imapHost: string
    imapPort: number
    imapSecure: boolean
    smtpHost: string
    smtpPort: number
    smtpSecure: boolean
    email: string
    appPassword: string
  }) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONFIG_TEST_EMAIL, config),
  /** 监听语言变更事件（灵动岛窗口使用） */
  onLanguageChanged: (callback: (lang: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { lang: string }) => callback(data.lang)
    ipcRenderer.on('language-changed', listener)
    return () => ipcRenderer.removeListener('language-changed', listener)
  },
}

/** 配置变更事件监听（主进程 → 渲染进程） */
export const onConfigChanged = (callback: (data: { key: string }) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, data: { key: string }) => callback(data)
  ipcRenderer.on(IPC_CHANNELS.CONFIG_CHANGED, listener)
  return () => ipcRenderer.removeListener(IPC_CHANNELS.CONFIG_CHANGED, listener)
}
