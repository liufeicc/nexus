/**
 * 应用面板 - Xephyr 嵌入同步 Hook（技术验证版）
 *
 * 职责：
 * - 首次测得有效占位区域后调用 launch 启动虚拟显示器 + 目标程序（幂等防重入）
 * - 通过 ResizeObserver 同步占位区域几何到嵌入窗口（setBounds）
 * - 会话切换（占位区域不可见）/任意模态框打开时隐藏嵌入窗口，恢复时还原
 * - 监听主进程状态推送（程序退出、启动失败），更新面板运行状态
 */

import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '../../store'

interface UseAppPanelSyncParams {
  panelId: string
  /** 要启动的程序命令 */
  appCommand: string
  /** 程序展示名称 */
  appName: string
  /** 当前运行状态 */
  runState: string
  /** 嵌入目标占位元素 */
  placeholderRef: React.RefObject<HTMLDivElement | null>
}

export function useAppPanelSync({ panelId, appCommand, appName, runState, placeholderRef }: UseAppPanelSyncParams): void {
  const {
    updateAppPanelRunState,
  } = useAppStore()
  // 主窗口本地弹层（主题下拉等）打开时，原生容器临时隐藏让路
  const domPopupOpen = useAppStore(s => s.domPopupOpen)

  // 模态框/菜单已迁移至共享置顶弹层窗口（浮于原生层之上），无需再为其隐藏容器窗口

  /** 测量占位区域，区域过小（含 display:none 时为 0）返回 null */
  const measure = useCallback(() => {
    const el = placeholderRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) return null
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }, [placeholderRef])

  /** 当前运行状态（starting 时尝试 launch；重试/重开通过重置回 starting 触发） */
  const launchAttemptedRef = useRef(false)

  // runState 回到 starting（含初次挂载与重试/重开）时解除尝试标记
  useEffect(() => {
    if (runState === 'starting') launchAttemptedRef.current = false
  }, [runState])

  /** 发起 launch 并处理失败 */
  const doLaunch = useCallback((bounds: NonNullable<ReturnType<typeof measure>>) => {
    launchAttemptedRef.current = true
    window.electronAPI.appPanel.launch(panelId, { exec: appCommand, name: appName }, bounds).then(res => {
      if (!res?.success) {
        updateAppPanelRunState(panelId, 'error', res?.error || '启动失败')
      }
    }).catch(err => {
      updateAppPanelRunState(panelId, 'error', String(err))
    })
  }, [panelId, appCommand, appName, updateAppPanelRunState, measure])

  /**
   * 同步入口：
   * - starting 且测得有效区域 → launch（每次 starting 周期仅一次）；
   *   已 launch 后保持几何同步，容器窗口由主进程在程序首帧就绪后自行显示
   * - exited/error → 隐藏容器窗口，让 DOM 状态层（重新打开/重试）可见
   * - running → 按可见性 setBounds / setVisible
   */
  const syncBounds = useCallback(() => {
    const bounds = measure()

    if (runState === 'starting') {
      if (!appCommand || !bounds) return
      if (!launchAttemptedRef.current) {
        doLaunch(bounds)
        return
      }
      window.electronAPI.appPanel.setBounds(panelId, bounds)
      return
    }

    if (runState === 'exited' || runState === 'error') {
      window.electronAPI.appPanel.setVisible(panelId, false)
      return
    }

    const shouldHide = !bounds || domPopupOpen
    if (shouldHide) {
      window.electronAPI.appPanel.setVisible(panelId, false)
    } else {
      window.electronAPI.appPanel.setBounds(panelId, bounds!)
      window.electronAPI.appPanel.setVisible(panelId, true)
    }
  }, [runState, appCommand, measure, doLaunch, domPopupOpen])

  // 用 ref 持有最新 syncBounds，避免模态状态变化导致 ResizeObserver 反复重建
  const syncRef = useRef(syncBounds)
  useEffect(() => {
    syncRef.current = syncBounds
  }, [syncBounds])

  // 挂载时建立 ResizeObserver，覆盖分屏拖动/窗口缩放/会话切换等几何变化
  useEffect(() => {
    const el = placeholderRef.current
    if (!el) return
    syncRef.current()
    const observer = new ResizeObserver(() => syncRef.current())
    observer.observe(el)
    return () => observer.disconnect()
  }, [placeholderRef])

  // 运行状态/本地弹层让路状态变化时重新同步（starting 触发 launch；下拉打开时隐藏容器）
  useEffect(() => {
    syncRef.current()
  }, [runState, domPopupOpen])

  // 监听主进程状态推送：程序退出 / 启动失败 / 进入运行
  useEffect(() => {
    const off = window.electronAPI.appPanel.onStateChanged(({ panelId: pid, state, detail }) => {
      if (pid !== panelId) return
      if (state === 'running') updateAppPanelRunState(panelId, 'running')
      else if (state === 'exited') updateAppPanelRunState(panelId, 'exited')
      else if (state === 'error') updateAppPanelRunState(panelId, 'error', detail)
    })
    return off
  }, [panelId, updateAppPanelRunState])
}
