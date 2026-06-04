/**
 * 文件状态栏组件
 *
 * 位于文件面板最底部，显示已打开的文件标签，支持快速切换。
 * 当前查看的文件以强调色背景高亮。
 */

import React from 'react'
import { useI18n } from '../../i18n'

/** 已打开的文件条目 */
export interface OpenFileEntry {
  /** 文件唯一标识（使用文件路径） */
  path: string
  /** 文件名 */
  name: string
}

interface FileStatusBarProps {
  /** 已打开的文件列表 */
  openFiles: OpenFileEntry[]
  /** 当前正在查看的文件路径 */
  activeFile: string | null
  /** 点击标签切换文件 */
  onSwitch: (filePath: string) => void
  /** 关闭已打开的文件 */
  onCloseFile: (filePath: string) => void
  /** 点击"目录"卡片，回到目录浏览界面 */
  onNavigateToGrid?: () => void
  /** 智能体正在操作的文件路径列表 */
  agentActiveFiles?: string[]
  /** 智能体是否正在运行 */
  agentRunning?: boolean
}

/**
 * 根据文件扩展名获取图标颜色
 */
function getFileIconColor(fileName: string): string | undefined {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (ext === 'docx') return '#2563eb'
  if (ext === 'xlsx' || ext === 'xls') return '#16a34a'
  if (ext === 'pptx' || ext === 'ppt') return '#ea580c'
  if (ext === 'pdf') return '#ef4444'
  return undefined
}

/**
 * 文件状态栏组件
 */
export function FileStatusBar({ openFiles, activeFile, onSwitch, onCloseFile, onNavigateToGrid, agentActiveFiles, agentRunning }: FileStatusBarProps) {
  const { t } = useI18n()

  if (openFiles.length === 0) {
    return (
      <div className="file-statusbar">
        <span className="file-statusbar-empty">{t('common.noData')}</span>
      </div>
    )
  }

  return (
    <div className="file-statusbar">
      {/* "目录"卡片：点击回到目录浏览界面 */}
      {onNavigateToGrid && (
        <div
          className="file-statusbar-item file-statusbar-grid-tab"
          onClick={onNavigateToGrid}
          title={t('filePanel.directory')}
        >
          {/* 文件夹图标 */}
          <svg style={{ width: '12px', height: '12px', flexShrink: 0 }} viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
          </svg>
          <span className="file-name">{t('filePanel.directory')}</span>
        </div>
      )}

      {openFiles.map((file) => {
        const isActive = file.path === activeFile
        const isAgentFile = agentRunning && agentActiveFiles?.includes(file.path)
        return (
          <div
            key={file.path}
            className={`file-statusbar-item ${isActive ? 'active' : ''} ${isAgentFile ? 'agent-file' : ''}`}
            onClick={() => onSwitch(file.path)}
            title={file.path}
          >
            {/* 文件图标 */}
            <svg style={{ width: '12px', height: '12px', flexShrink: 0, color: getFileIconColor(file.name) }} viewBox="0 0 24 24" fill="currentColor">
              <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z" />
            </svg>
            <span className="file-name">{file.name}</span>
            {/* 智能体指示器 */}
            {isAgentFile && (
              <span className="file-agent-indicator" title={t('agent.thinking')}>
                <span className="agent-dot" />
                AI
              </span>
            )}
            {/* 关闭按钮（悬停显示） */}
            <span
              className="file-close"
              onClick={(e) => {
                e.stopPropagation()
                onCloseFile(file.path)
              }}
              title={t('common.close')}
            >
              <svg style={{ width: '10px', height: '10px' }} viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default FileStatusBar
