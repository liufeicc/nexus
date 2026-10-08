/**
 * 面板外部资源清理（统一收口）
 *
 * 面板持有主进程侧的外部资源：终端面板 → PTY 进程；应用面板 → 程序 + Xephyr 虚拟显示器。
 * 面板被销毁的每一条路径（关闭面板 / 替换面板 / 删除会话）都必须先调用本函数，
 * 否则外部资源成为孤儿进程（见 review 0.6.11 I-4：删除会话路径此前漏清理）。
 * 独立成模块供 panel-lifecycle.ts 与 simple-actions.ts 共用，避免循环依赖。
 */

import type { PanelState } from './types'

/**
 * 杀掉面板持有的外部资源（fire-and-forget，失败静默）：
 * - terminal：按 ptyId 杀 PTY 进程；
 * - app：按 panelId 杀程序与虚拟显示器（主进程 kill 同步先摘除会话记录，
 *   随后才做异步 X 资源销毁，因此重复调用/后续重启均幂等安全）；
 * - file-browser / browser：无外部进程，无需清理。
 */
export function killPanelResources(panel: PanelState): void {
  if (panel.panelType === 'terminal' && panel.ptyId) {
    window.electronAPI.pty.kill(panel.ptyId).catch(() => {})
  } else if (panel.panelType === 'app') {
    window.electronAPI.appPanel.kill(panel.id).catch(() => {})
  }
}
