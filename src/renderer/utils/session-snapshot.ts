/**
 * 会话快照恢复工具
 * 从快照恢复面板状态，重建 PTY 进程
 */

import { useAppStore } from '../store'
import { t } from '../i18n'

/**
 * 恢复会话快照
 * 优先使用缓存，缓存未命中时从数据库获取快照并重建 PTY
 */
export async function restoreSessionPanels(sessionId: string): Promise<void> {
  try {
    const state = useAppStore.getState()

    // 1. 检查缓存中是否已有该会话的面板
    const cachedPanels = state.sessionsPanels.get(sessionId)
    if (cachedPanels && cachedPanels.length > 0) {
      const cachedLayout = state.sessionsLayouts.get(sessionId)
      useAppStore.getState().setPanelsFromSnapshot(cachedPanels, cachedLayout || null)
      return
    }

    // 2. 缓存未命中，获取最新快照
    const snapshot = await window.electronAPI.snapshot.getLatest(sessionId)

    if (!snapshot || !snapshot.panelStates || snapshot.panelStates.length === 0) {
      // 没有快照，清空面板和布局
      useAppStore.getState().setPanelsFromSnapshot([], null)
      return
    }

    // 3. 使用 store 的 restorePanelsFromData 统一重建 PTY
    const panelStates = snapshot.panelStates.map((ps) => ({
      panelId: ps.panelId,
      panelType: ps.panelType,
      cwd: ps.cwd,
      rootPath: ps.rootPath,
      currentPath: ps.currentPath,
      viewMode: ps.viewMode,
      title: ps.title || `${t('panel.terminal')} - ${ps.cwd}`,
    }))
    await useAppStore.getState().restorePanelsFromData(panelStates, snapshot.layoutData || null)
  } catch (error) {
    console.error('[restoreSessionPanels] 恢复会话快照失败:', error)
  }
}
