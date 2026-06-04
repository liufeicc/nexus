/**
 * 全局快捷键定义
 *
 * 定义所有快捷键的键位组合和对应动作类型，
 * useGlobalEvents.ts 引用此文件进行匹配，避免硬编码。
 */

/** 快捷键动作类型 */
export type ShortcutAction =
  | { type: 'cycle-next-panel' }
  | { type: 'close-modal' }
  | { type: 'copy' }
  | { type: 'paste' }
  | { type: 'new-session' }
  | { type: 'close-session' }

/** 快捷键描述 */
export interface ShortcutDef {
  /** 显示名称，如 "Ctrl+T" */
  label: string
  /** 键位匹配条件 */
  match: (e: KeyboardEvent) => boolean
  /** 对应的动作 */
  action: ShortcutAction
}

/**
 * 默认快捷键列表
 *
 * 按优先级排列，靠前的先匹配。
 * 每个快捷键的 match 函数应尽可能精确，避免误触发。
 */
export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  {
    label: 'Escape',
    match: (e) => e.key === 'Escape',
    action: { type: 'close-modal' },
  },
  {
    label: 'Ctrl+Tab',
    match: (e) =>
      e.key === 'Tab' && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey,
    action: { type: 'cycle-next-panel' },
  },
  {
    label: 'Ctrl+C',
    match: (e) => e.ctrlKey && e.key === 'c',
    action: { type: 'copy' },
  },
  {
    label: 'Ctrl+V',
    match: (e) => e.ctrlKey && e.key === 'v',
    action: { type: 'paste' },
  },
  {
    label: 'Ctrl+T',
    match: (e) => e.ctrlKey && e.key === 't',
    action: { type: 'new-session' },
  },
  {
    label: 'Ctrl+W',
    match: (e) => e.ctrlKey && e.key === 'w',
    action: { type: 'close-session' },
  },
]
