/**
 * 已附加文件的 UI 徽标组件
 *
 * 显示在 DynamicIsland 输入框上方，让用户看到已附加的文件列表。
 */

import React from 'react'
import type { AttachedFile } from '@core/types/agent'
import { formatFileSize } from './file-attachment-utils'
import { useI18n } from '../../i18n'

interface AttachedFileBadgeProps {
  file: AttachedFile
  onRemove: (id: string) => void
}

export function AttachedFileBadge({ file, onRemove }: AttachedFileBadgeProps) {
  const { t } = useI18n()
  const icon = file.type === 'image' ? '🖼️' : file.type === 'text' ? '📄' : '📎'

  return (
    <div className="attached-file-badge">
      <span className="attached-file-icon" title={file.type}>
        {icon}
      </span>
      <span className="attached-file-name" title={file.path}>
        {file.name}
      </span>
      <span className="attached-file-size">
        {formatFileSize(file.size)}
      </span>
      <button
        className="attached-file-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(file.id) }}
        title={t('common.remove')}
      >
        ✕
      </button>
    </div>
  )
}
