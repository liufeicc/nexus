/**
 * 面板焦点切换
 *
 * 作用：提供统一的面板激活入口，以及"按方向移动焦点"的动作实现。
 *
 * 设计要点：
 * - 激活链路与鼠标点击面板完全一致（BasePanel 也调用 activatePanel），
 *   避免快捷键与点击出现行为差异（例如旧终端选区未清除、新终端没拿到输入焦点）。
 * - 几何寻址逻辑放在 panel-navigation.ts，本文件只负责取 DOM 容器、读焦点状态、
 *   调用寻址函数并落地焦点切换。
 */

import { useAppStore } from '../store'
import type { PanelFocusDirection } from '@core/constants/shortcuts'
import { collectPanelRects, findAdjacentPanel } from './panel-navigation'

/**
 * 激活指定面板（统一的焦点切换入口）
 *
 * 与 BasePanel 的点击选中保持同一套动作：
 * 1. 若上一个获得焦点的是终端面板，派发事件让其清除视觉选区；
 * 2. 更新 store 中的 activePanelId；
 * 3. 派发事件通知新面板（终端会据此获取输入焦点）。
 *
 * @param panelId 目标面板 ID
 */
export function activatePanel(panelId: string): void {
  const state = useAppStore.getState()
  const prevActivePanelId = state.activePanelId
  const prevActivePanel = prevActivePanelId
    ? state.panels.find((p) => p.id === prevActivePanelId)
    : null

  // 旧面板是终端时清除其视觉选区（需在 setActivePanelId 之前派发，保证读到旧状态）
  if (prevActivePanel && prevActivePanel.panelType === 'terminal') {
    window.dispatchEvent(
      new CustomEvent('terminal-clear-selection', {
        detail: { panelId: prevActivePanelId },
      })
    )
  }

  state.setActivePanelId(panelId)

  // 通知新面板获取输入焦点（终端面板监听此事件并调用 xterm.focus()）
  window.dispatchEvent(new CustomEvent('terminal-focus', { detail: { panelId } }))
}

/**
 * 按方向移动面板焦点
 *
 * 边界约定：
 * - 该方向没有面板时不做任何事（焦点保持原地）；
 * - 当前没有有效焦点（例如刚切换到某个会话）时，直接聚焦视觉顺序第一个面板。
 *
 * @param direction 移动方向
 */
export function movePanelFocus(direction: PanelFocusDirection): void {
  const state = useAppStore.getState()
  const sessionId = state.activeSessionId
  if (!sessionId) return

  // 每个会话有独立的面板容器，按 ID 取当前会话容器可避免读到隐藏会话的面板
  const container = document.getElementById(`panels-container-${sessionId}`)
  const rects = collectPanelRects(container)
  if (rects.length === 0) return

  // 当前焦点面板不在可见面板集合中：直接聚焦第一个面板作为起点
  const current = rects.find((rect) => rect.panelId === state.activePanelId)
  if (!current) {
    activatePanel(rects[0].panelId)
    return
  }

  // 只有一个面板时没有可移动的目标
  if (rects.length === 1) return

  const targetPanelId = findAdjacentPanel(rects, current.panelId, direction)
  if (!targetPanelId) return

  activatePanel(targetPanelId)
}
