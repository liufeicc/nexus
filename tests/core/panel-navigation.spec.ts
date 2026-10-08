/**
 * 面板空间导航（Alt+方向键）几何寻址单元测试
 *
 * 覆盖场景：
 * - 规则网格的四方向寻址
 * - 左右分栏且右列上下分层时"同排优先"的判定
 * - 无同排候选时退化为最近的斜向面板
 * - 目标方向没有面板时返回 null（焦点保持不动）
 * - 单个面板、零尺寸面板、输入顺序变化等边界情况
 */

import { describe, it, expect } from 'vitest'
import {
  findAdjacentPanel,
  type PanelRect,
} from '../../src/renderer/utils/panel-navigation'

/**
 * 构造面板矩形
 */
function rect(
  panelId: string,
  left: number,
  top: number,
  right: number,
  bottom: number
): PanelRect {
  return { panelId, left, top, right, bottom }
}

describe('findAdjacentPanel', () => {
  /**
   * 2×2 规则网格：
   * ┌───┬───┐
   * │ A │ B │
   * ├───┼───┤
   * │ C │ D │
   * └───┴───┘
   */
  const grid: PanelRect[] = [
    rect('A', 0, 0, 100, 100),
    rect('B', 100, 0, 200, 100),
    rect('C', 0, 100, 100, 200),
    rect('D', 100, 100, 200, 200),
  ]

  it('网格内四方向都能选中相邻面板', () => {
    expect(findAdjacentPanel(grid, 'A', 'right')).toBe('B')
    expect(findAdjacentPanel(grid, 'A', 'down')).toBe('C')
    expect(findAdjacentPanel(grid, 'B', 'left')).toBe('A')
    expect(findAdjacentPanel(grid, 'B', 'down')).toBe('D')
    expect(findAdjacentPanel(grid, 'C', 'right')).toBe('D')
    expect(findAdjacentPanel(grid, 'C', 'up')).toBe('A')
    expect(findAdjacentPanel(grid, 'D', 'left')).toBe('C')
    expect(findAdjacentPanel(grid, 'D', 'up')).toBe('B')
  })

  it('到达边界时返回 null（焦点保持不动）', () => {
    expect(findAdjacentPanel(grid, 'A', 'left')).toBeNull()
    expect(findAdjacentPanel(grid, 'A', 'up')).toBeNull()
    expect(findAdjacentPanel(grid, 'B', 'right')).toBeNull()
    expect(findAdjacentPanel(grid, 'D', 'right')).toBeNull()
    expect(findAdjacentPanel(grid, 'D', 'down')).toBeNull()
  })

  it('多列布局只跳到相邻列，不跳过中间列', () => {
    const columns: PanelRect[] = [
      rect('A', 0, 0, 100, 100),
      rect('B', 100, 0, 200, 100),
      rect('C', 200, 0, 300, 100),
    ]
    expect(findAdjacentPanel(columns, 'B', 'right')).toBe('C')
    expect(findAdjacentPanel(columns, 'B', 'left')).toBe('A')
    expect(findAdjacentPanel(columns, 'A', 'right')).toBe('B')
  })

  /**
   * 左侧一个整列面板，右侧上下分层：
   * ┌────┬─────┐
   * │    │ R1  │
   * │ L  ├─────┤
   * │    │ R2  │
   * └────┴─────┘
   */
  const splitLayout: PanelRect[] = [
    rect('L', 0, 0, 100, 200),
    rect('R1', 100, 0, 200, 60),
    rect('R2', 100, 60, 200, 200),
  ]

  it('同排候选中取交叉轴中心更近的那个', () => {
    // L 的中心 Y = 100，R1 中心 Y = 30（距 70），R2 中心 Y = 130（距 30）
    expect(findAdjacentPanel(splitLayout, 'L', 'right')).toBe('R2')
  })

  it('上下相邻但边缘相接时仍能正确跳转', () => {
    // R2 向上：R1 在交叉轴（X 轴）上与 R2 完全重叠且边缘相接
    expect(findAdjacentPanel(splitLayout, 'R2', 'up')).toBe('R1')
  })

  it('同排优先级高于斜向面板的直线距离', () => {
    const layout: PanelRect[] = [
      rect('cur', 0, 0, 100, 100),
      rect('alignedRight', 100, 0, 200, 100),
      // 斜向面板的中心离 cur 更近，但与 cur 在交叉轴上没有重叠
      rect('diagonalRight', 110, 150, 210, 250),
    ]
    expect(findAdjacentPanel(layout, 'cur', 'right')).toBe('alignedRight')
  })

  it('没有同排候选时退化为综合距离最近的斜向面板', () => {
    const layout: PanelRect[] = [
      rect('cur', 0, 0, 100, 100),
      rect('near', 300, 120, 400, 220),
      rect('far', 900, 400, 1000, 500),
    ]
    expect(findAdjacentPanel(layout, 'cur', 'right')).toBe('near')
    expect(findAdjacentPanel(layout, 'cur', 'down')).toBe('near')
  })

  it('反方向的更近面板不会成为目标', () => {
    const layout: PanelRect[] = [
      rect('A', 100, 0, 200, 100),
      rect('B', 0, 0, 100, 100),
    ]
    // B 在 A 的左侧，向右没有面板
    expect(findAdjacentPanel(layout, 'A', 'right')).toBeNull()
    // 向左则命中 B
    expect(findAdjacentPanel(layout, 'A', 'left')).toBe('B')
  })

  it('单个面板没有可移动目标', () => {
    const single: PanelRect[] = [rect('only', 0, 0, 100, 100)]
    expect(findAdjacentPanel(single, 'only', 'right')).toBeNull()
    expect(findAdjacentPanel(single, 'only', 'down')).toBeNull()
  })

  it('忽略零尺寸面板（隐藏会话中的面板）', () => {
    const layout: PanelRect[] = [
      rect('cur', 0, 0, 100, 100),
      rect('hidden', 200, 0, 200, 0),
    ]
    expect(findAdjacentPanel(layout, 'cur', 'right')).toBeNull()
  })

  it('当前面板不在集合中时返回 null', () => {
    expect(findAdjacentPanel(grid, 'not-exist', 'right')).toBeNull()
  })

  it('结果不受候选排列顺序影响', () => {
    const shuffled = [grid[3], grid[1], grid[2], grid[0]]
    expect(findAdjacentPanel(shuffled, 'A', 'right')).toBe('B')
    expect(findAdjacentPanel(shuffled, 'A', 'down')).toBe('C')
    expect(findAdjacentPanel(shuffled, 'D', 'up')).toBe('B')
  })
})
