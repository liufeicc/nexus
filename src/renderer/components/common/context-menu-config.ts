/**
 * 右键菜单配置
 *
 * 按面板类型和上下文定义菜单项，减少 ContextMenu.tsx 的单文件职责。
 * 所有 label 使用 i18n 翻译 key（如 'contextMenu.copyPath'），在 ContextMenu.tsx 中通过 t() 翻译。
 */

export interface ContextMenuItemDef {
  /** 唯一标识 */
  id: string
  /** 显示文本（i18n key） */
  label: string
  /** 图标 SVG path */
  icon: string
  /** 是否使用 stroke 样式（outline 风格），而非 fill 填充 */
  strokeIcon?: boolean
  /** 是否可用 */
  enabled?: boolean
  /** 自定义样式（如颜色） */
  iconColor?: string
  /** 子菜单项 */
  children?: ContextMenuItemDef[]
  /** 分隔线（在此项之前） */
  dividerBefore?: boolean
}

/** 菜单分隔线标记 */
export interface ContextMenuDivider {
  dividerBefore: true
  id?: never
  label?: never
  icon?: never
}

export type ContextMenuEntry = ContextMenuItemDef | ContextMenuDivider

/**
 * 构建右键菜单项列表
 */
export function buildContextMenu(params: {
  isFilePanel: boolean
  hasSelectedSession: boolean
  hasSelectedPanel: boolean
  hasActiveSession: boolean
  hasTerminalSelection: boolean
  hasClipboardText: boolean
  hasFileClipboard: boolean
  hasFileSelection: boolean
  isFileViewerOpen: boolean
  viewerSelectedText: boolean
}): ContextMenuEntry[] {
  const {
    isFilePanel,
    hasSelectedSession,
    hasSelectedPanel,
    hasActiveSession,
    hasTerminalSelection,
    hasClipboardText,
    hasFileClipboard,
    hasFileSelection,
    isFileViewerOpen,
    viewerSelectedText,
  } = params

  const items: ContextMenuEntry[] = []

  // ---- 文件相关 ----
  if (isFilePanel) {
    items.push({
      id: 'copy-path',
      label: 'contextMenu.copyPath',
      icon: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
    })
  }

  // 复制：文件查看器打开时，看是否有选中文本；否则看是否有文件选择
  const canCopy = isFilePanel
    ? (isFileViewerOpen ? viewerSelectedText : hasFileSelection)
    : hasTerminalSelection
  items.push({
    id: 'copy',
    label: 'contextMenu.copy',
    icon: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
    enabled: canCopy,
  })

  // 粘贴：文件查看器打开时，同时检查文本剪贴板；否则只检查文件剪贴板
  const canPaste = isFilePanel
    ? (isFileViewerOpen ? hasClipboardText || hasFileClipboard : hasFileClipboard)
    : hasClipboardText
  items.push({
    id: 'paste',
    label: 'contextMenu.paste',
    icon: 'M19 2h-4.18C14.4.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 18H5V4h2v3h10V4h2v16z',
    enabled: canPaste,
  })

  if (isFilePanel) {
    items.push({
      id: 'cut',
      label: 'contextMenu.cut',
      icon: 'M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm0 12c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3v2h-2V3h-4v2h-2V3H9v2H7V3H5v2h2v2h2V7h2v2h2V7h2V5h-2V3h-2z',
      enabled: viewerSelectedText || (hasFileSelection && !isFileViewerOpen),
    })

    items.push({
      id: 'trash-file',
      label: 'contextMenu.delete',
      icon: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
      enabled: hasFileSelection && !isFileViewerOpen,
    })

    items.push({
      id: 'rename',
      label: 'contextMenu.rename',
      icon: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
      enabled: !isFileViewerOpen,
    })

    // 新建子菜单
    items.push({
      id: 'new',
      label: 'contextMenu.new',
      icon: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
      enabled: !isFileViewerOpen,
      children: [
        {
          id: 'new-folder',
          label: 'contextMenu.newFolder',
          icon: 'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
          iconColor: '#42a5f5',
        },
        {
          id: 'new-text',
          label: 'contextMenu.newText',
          icon: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z',
          iconColor: '#66bb6a',
        },
      ],
    })
  }

  items.push({ id: '_divider_file', label: '', icon: '', dividerBefore: true })

  // ---- 会话管理子菜单 ----
  items.push({
    id: 'session',
    label: 'contextMenu.sessionManage',
    icon: 'M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H4V5h16v14z',
    children: [
      {
        id: 'new-session',
        label: 'contextMenu.newSession',
        icon: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
      },
      {
        id: 'rename-session',
        label: 'contextMenu.renameSession',
        icon: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
        enabled: hasSelectedSession,
      },
      {
        id: 'delete-session',
        label: 'contextMenu.deleteSession',
        icon: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
        enabled: hasSelectedSession,
      },
    ],
  })

  items.push({ id: '_divider_session', label: '', icon: '', dividerBefore: true })

  // ---- 分屏子菜单 ----
  const splitEnabled = hasSelectedPanel || hasActiveSession
  items.push({
    id: 'horizontal',
    label: 'contextMenu.horizontalSplit',
    icon: 'M4 5c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V5zm8 0c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2h-6c-1.1 0-2-.9-2-2V5zm-1-2v18',
    strokeIcon: true,
    enabled: splitEnabled,
    children: [
      { id: 'split-horizontal', label: 'contextMenu.terminalPanel', icon: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12z', iconColor: '#4caf50' },
      { id: 'split-horizontal-file', label: 'contextMenu.filePanel', icon: 'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z', iconColor: '#42a5f5' },
      { id: 'split-horizontal-browser', label: 'contextMenu.browserPanel', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z', iconColor: '#ff9800' },
    ],
  })

  items.push({
    id: 'vertical',
    label: 'contextMenu.verticalSplit',
    icon: 'M4 4c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2v6c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V4zm0 10c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2v6c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2v-6zm-1-1h18m-18 8h18',
    strokeIcon: true,
    enabled: splitEnabled,
    children: [
      { id: 'split-vertical', label: 'contextMenu.terminalPanel', icon: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12z', iconColor: '#4caf50' },
      { id: 'split-vertical-file', label: 'contextMenu.filePanel', icon: 'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z', iconColor: '#42a5f5' },
      { id: 'split-vertical-browser', label: 'contextMenu.browserPanel', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z', iconColor: '#ff9800' },
    ],
  })

  // ---- 替换面板子菜单 ----
  items.push({
    id: 'replace',
    label: 'contextMenu.replacePanel',
    icon: 'M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z',
    enabled: hasSelectedPanel,
    children: [
      { id: 'replace-terminal', label: 'contextMenu.terminalPanel', icon: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12z', iconColor: '#4caf50' },
      { id: 'replace-file', label: 'contextMenu.filePanel', icon: 'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z', iconColor: '#42a5f5' },
      { id: 'replace-browser', label: 'contextMenu.browserPanel', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z', iconColor: '#ff9800' },
    ],
  })

  items.push({ id: '_divider_panel', label: '', icon: '', dividerBefore: true })

  // ---- 关闭面板 ----
  items.push({
    id: 'close-panel',
    label: 'contextMenu.closePanel',
    icon: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    enabled: hasSelectedPanel,
  })

  return items
}
