/**
 * 布局类型定义
 */

import type { PanelNode } from './pane'

/**
 * 布局容器节点
 */
export interface LayoutContainerNode {
  type: 'horizontal' | 'vertical'
  children: LayoutChild[]
  flexValues?: Record<number, number> // 存储子节点的 flex 比例
}

/**
 * 布局树子节点
 */
export type LayoutChild = LayoutContainerNode | PanelNode

/**
 * 布局树根节点
 */
export interface LayoutTree {
  type: 'horizontal' | 'vertical'
  children: LayoutChild[]
  flexValues?: Record<number, number> // 存储子节点的 flex 比例
}

/**
 * 分屏模式
 */
export type SplitDirection = 'horizontal' | 'vertical'
