/**
 * 布局树操作（从 store/index.ts 拆出）
 * 包含布局简化、面板移除、分割、交换等操作
 */

import type { LayoutTree, LayoutChild, PanelNode } from '@core/types'

/**
 * 面板状态（store 内部类型，避免循环依赖）
 */
interface PanelState {
  id: string
  ptyId?: string
  title: string
  cwd?: string
}

/**
 * 规范化 flexValues：使其与孩子数量匹配，缺失的补默认值 1
 */
function normalizeFlexValues(existing: Record<number, number> | undefined, childCount: number): Record<number, number> {
  const result: Record<number, number> = {}
  for (let i = 0; i < childCount; i++) {
    result[i] = existing?.[i] ?? 1
  }
  return result
}

/**
 * 简化布局树：当容器只剩一个子节点时，用子节点替换容器
 * 注意：如果容器有 flexValues，则不进行简化，以保留面板比例信息
 */
export function simplifyLayout(node: LayoutChild): LayoutChild {
  if (node.type === 'panel') {
    return node
  }

  // 递归简化子节点
  const simplifiedChildren = node.children.map(simplifyLayout)

  // 如果只剩一个子节点，直接返回该子节点（移除容器）
  // 单个面板不需要 flexValues，简化后自然占满整个容器
  if (simplifiedChildren.length === 1) {
    return simplifiedChildren[0]
  }

  // 如果子节点为空，返回空面板节点（不应该发生）
  if (simplifiedChildren.length === 0) {
    return { type: 'panel', id: '' }
  }

  // 否则返回简化后的容器（保留并规范化 flexValues）
  const nodeLayout: LayoutTree = {
    ...node,
    children: simplifiedChildren,
  }

  if (nodeLayout.flexValues) {
    nodeLayout.flexValues = normalizeFlexValues(nodeLayout.flexValues, simplifiedChildren.length)
  }

  return nodeLayout
}

/**
 * 清理布局树中与孩子数量不匹配的 flexValues
 * 与 simplifyLayout 类似，但不进行简化，只清理 flexValues
 */
export function cleanupLayoutFlexValues(node: LayoutChild): LayoutChild {
  if (node.type === 'panel') {
    return node
  }

  // 递归清理子节点
  const cleanedChildren = node.children.map(cleanupLayoutFlexValues)

  const nodeLayout: LayoutTree = {
    ...node,
    children: cleanedChildren,
  }

  if (nodeLayout.flexValues) {
    nodeLayout.flexValues = normalizeFlexValues(nodeLayout.flexValues, cleanedChildren.length)
  }

  return nodeLayout
}

/**
 * 从布局树中移除面板
 */
export function removePanelFromLayout(node: LayoutChild, panelId: string): LayoutChild | null {
  if (node.type === 'panel') {
    if (node.id === panelId) {
      return null // 移除这个节点
    }
    return node
  }

  // 递归处理子节点
  const newChildren: LayoutChild[] = []
  for (const child of node.children) {
    const result = removePanelFromLayout(child, panelId)
    if (result !== null) {
      newChildren.push(result)
    }
  }

  // 如果所有子节点都被移除，返回 null
  if (newChildren.length === 0) {
    return null
  }

  // 简化并返回新节点
  return simplifyLayout({ ...node, children: newChildren })
}

/**
 * 分割面板：在指定面板旁边添加新面板，返回新布局
 */
export function splitPanelLayout(
  layout: LayoutTree | null,
  panelId: string,
  direction: 'horizontal' | 'vertical',
  newPanel: PanelState
): LayoutTree {
  const findAndSplit = (node: LayoutChild): LayoutChild => {
    if (node.type === 'panel') {
      if (node.id === panelId) {
        // 找到目标面板，创建一个新容器包裹它和新面板
        return {
          type: direction,
          children: [
            { type: 'panel', id: panelId },
            { type: 'panel', id: newPanel.id },
          ],
        }
      }
      return node
    }

    // 递归处理子节点
    return {
      ...node,
      children: node.children.map(findAndSplit),
    }
  }

  return (layout ? findAndSplit(layout) : {
    type: direction,
    children: [
      { type: 'panel', id: panelId },
      { type: 'panel', id: newPanel.id },
    ],
  }) as LayoutTree
}

/**
 * 交换两个面板在布局树中的位置
 */
export function swapPanelsInLayout(
  layout: LayoutTree,
  panelId1: string,
  panelId2: string
): LayoutTree {
  const swapInLayout = (node: LayoutChild): LayoutChild => {
    if (node.type === 'panel') {
      if (node.id === panelId1) {
        return { ...node, id: panelId2 } as PanelNode
      }
      if (node.id === panelId2) {
        return { ...node, id: panelId1 } as PanelNode
      }
      return node
    }

    // 递归处理子节点
    return {
      ...node,
      children: node.children.map(swapInLayout),
    } as LayoutTree
  }

  return swapInLayout(layout) as LayoutTree
}

/**
 * 更新布局的 flex 比例（通过路径直接更新）
 */
export function updateLayoutFlexAtPath(
  layout: LayoutTree,
  path: number[],
  flexValues: Record<number, number>
): LayoutTree {
  const updateNodeAtPath = (node: LayoutChild, pathArr: number[], depth: number = 0): LayoutChild => {
    if (node.type === 'panel') {
      return node
    }

    const nodeLayout = node as LayoutTree

    // 如果到达目标路径，更新 flexValues
    if (depth === pathArr.length) {
      return { ...nodeLayout, flexValues }
    }

    // 递归更新子节点
    const childIndex = pathArr[depth]
    return {
      ...nodeLayout,
      children: nodeLayout.children.map((child, i) => {
        if (i === childIndex) {
          return updateNodeAtPath(child, pathArr, depth + 1)
        }
        return child
      }),
    }
  }

  return updateNodeAtPath(layout, path) as LayoutTree
}
