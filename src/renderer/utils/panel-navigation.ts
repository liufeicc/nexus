/**
 * 面板空间导航（几何计算）
 *
 * 作用：把"上/下/左/右"这样的方向输入，翻译成"应该把焦点交给哪个面板"。
 *
 * 设计要点：
 * 1. 寻址依据是面板在屏幕上的真实几何位置（DOM 矩形），不是布局树的嵌套顺序。
 *    这样无论布局怎么分屏，方向语义都符合直觉。
 * 2. 本文件只做几何计算与 DOM 读数，不依赖 store，也不在模块加载期触碰 DOM，
 *    因此可以被单元测试直接引入（详见 tests/core/panel-navigation.spec.ts）。
 * 3. 真正的焦点切换在 panel-focus.ts，与"鼠标点击面板"共用同一条链路。
 */

import type { PanelFocusDirection } from '@core/constants/shortcuts'

/**
 * 面板矩形（屏幕坐标，单位 px）
 */
export interface PanelRect {
  /** 面板唯一 ID */
  panelId: string
  left: number
  top: number
  right: number
  bottom: number
}

/** 浮点/边框误差容忍量（px） */
const EPS = 1

/**
 * 沿指定方向把矩形换算成"主轴 / 交叉轴"两组区间
 *
 * 约定：
 * - 左右方向时主轴是 X 轴，交叉轴是 Y 轴
 * - 上下方向时主轴是 Y 轴，交叉轴是 X 轴
 *
 * 这样四个方向可以共用同一套比较逻辑，只是换轴而已。
 */
function measure(rect: PanelRect, direction: PanelFocusDirection) {
  const horizontal = direction === 'left' || direction === 'right'
  return {
    /** 主轴区间起点（左 / 上） */
    mainMin: horizontal ? rect.left : rect.top,
    /** 主轴区间终点（右 / 下） */
    mainMax: horizontal ? rect.right : rect.bottom,
    /** 主轴中心 */
    mainCenter: horizontal ? (rect.left + rect.right) / 2 : (rect.top + rect.bottom) / 2,
    /** 交叉轴区间起点 */
    crossMin: horizontal ? rect.top : rect.left,
    /** 交叉轴区间终点 */
    crossMax: horizontal ? rect.bottom : rect.right,
    /** 交叉轴中心 */
    crossCenter: horizontal ? (rect.top + rect.bottom) / 2 : (rect.left + rect.right) / 2,
  }
}

/**
 * 判断矩形是否有有效面积
 * 隐藏的会话容器（display:none）里所有面板矩形都是 0，需要排除
 */
function hasArea(rect: PanelRect): boolean {
  return rect.right - rect.left >= EPS && rect.bottom - rect.top >= EPS
}

/**
 * 在给定面板集合中，寻找当前面板沿指定方向最应该切换过去的目标面板
 *
 * 实现逻辑：
 * 1. 只考虑中心位于当前面板"前方"（沿 direction）的候选，其余方向一律排除。
 * 2. 一级选择（同排优先）：候选与当前面板在交叉轴上存在投影重叠时，视为"同一排/同一列"，
 *    在这批候选里取主轴间距最小者；间距相同则取交叉轴中心更近者。
 *    这一步解决"左侧一个面板，右侧上下两个面板"时该往哪边跳的问题。
 * 3. 二级回退：若不存在同排候选（例如目标在斜向），退化为
 *    "主轴间距 + 交叉轴中心距"综合最小者。
 * 4. 仍然没有候选时返回 null，调用方据此保持焦点不动。
 *
 * @param rects 所有候选面板矩形
 * @param currentPanelId 当前获得焦点的面板 ID
 * @param direction 目标方向
 * @returns 目标面板 ID；无可达目标时返回 null
 */
export function findAdjacentPanel(
  rects: PanelRect[],
  currentPanelId: string,
  direction: PanelFocusDirection,
): string | null {
  const current = rects.find((r) => r.panelId === currentPanelId)
  if (!current) return null

  const cur = measure(current, direction)
  // 方向系数：向右/向下为 +1，向左/向上为 -1，用于把"前方"统一成正数比较
  const forward = direction === 'right' || direction === 'down' ? 1 : -1

  /** 带几何度量的候选面板 */
  interface Candidate {
    panelId: string
    /** 主轴边缘间距：正数表示有间隙，负数表示主轴上互相重叠 */
    gap: number
    /** 交叉轴中心距 */
    crossDistance: number
    /** 主轴中心前进量（恒为正，越大说明越靠前） */
    mainDelta: number
  }

  const aligned: Candidate[] = [] // 与当前面板同排/同列的候选
  const others: Candidate[] = [] // 不在同一排/列的斜向候选

  for (const rect of rects) {
    if (rect.panelId === currentPanelId) continue
    if (!hasArea(rect)) continue

    const m = measure(rect, direction)

    // 方向判定：候选中心必须位于当前面板主轴中心的前方
    const mainDelta = (m.mainCenter - cur.mainCenter) * forward
    if (mainDelta <= EPS) continue

    // 边缘间距（沿移动方向看两者之间隔了多远）
    const gap = forward > 0 ? m.mainMin - cur.mainMax : cur.mainMin - m.mainMax

    // 交叉轴投影重叠量：> 0 表示在同一排/同一列上
    const overlap =
      Math.min(cur.crossMax, m.crossMax) - Math.max(cur.crossMin, m.crossMin)

    const candidate: Candidate = {
      panelId: rect.panelId,
      gap,
      crossDistance: Math.abs(m.crossCenter - cur.crossCenter),
      mainDelta,
    }

    if (overlap > EPS) {
      aligned.push(candidate)
    } else {
      others.push(candidate)
    }
  }

  /**
   * 比较器：依次比较主轴间距、主轴前进量、交叉轴距离，最后用 ID 兜底
   * 主轴间距先取 max(0, gap)，避免"尺寸很大的面板在主轴上跨越当前面板"时
   * 因为负间距被误判成最近目标。
   */
  const compare = (a: Candidate, b: Candidate): number => {
    const gapDiff = Math.max(0, a.gap) - Math.max(0, b.gap)
    if (Math.abs(gapDiff) > EPS) return gapDiff
    const mainDiff = a.mainDelta - b.mainDelta
    if (Math.abs(mainDiff) > EPS) return mainDiff
    const crossDiff = a.crossDistance - b.crossDistance
    if (Math.abs(crossDiff) > EPS) return crossDiff
    return a.panelId.localeCompare(b.panelId)
  }

  // 一级：同排候选优先
  if (aligned.length > 0) {
    return aligned.slice().sort(compare)[0].panelId
  }

  // 二级：退化为综合距离最近的斜向面板
  if (others.length > 0) {
    const byScore = others.slice().sort((a, b) => {
      const scoreDiff =
        Math.max(0, a.gap) + a.crossDistance - (Math.max(0, b.gap) + b.crossDistance)
      if (Math.abs(scoreDiff) > EPS) return scoreDiff
      return compare(a, b)
    })
    return byScore[0].panelId
  }

  return null
}

/**
 * 从容器 DOM 中采集当前会话所有可见面板的矩形
 *
 * 面板包装器统一带有 data-panel-id 属性（见 BasePanel），
 * 因此这里只需要按属性查找，无需关心面板类型。
 *
 * @param container 当前会话的面板容器（#panels-container-{sessionId}）
 */
export function collectPanelRects(container: HTMLElement | null): PanelRect[] {
  if (!container) return []

  const rects: PanelRect[] = []
  const elements = container.querySelectorAll<HTMLElement>('[data-panel-id]')

  elements.forEach((element) => {
    const panelId = element.dataset.panelId
    if (!panelId) return

    const domRect = element.getBoundingClientRect()
    // 隐藏会话中的面板矩形为 0，直接跳过
    if (domRect.width < EPS || domRect.height < EPS) return

    rects.push({
      panelId,
      left: domRect.left,
      top: domRect.top,
      right: domRect.right,
      bottom: domRect.bottom,
    })
  })

  return rects
}
