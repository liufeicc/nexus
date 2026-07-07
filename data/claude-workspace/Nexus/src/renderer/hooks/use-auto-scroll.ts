/**
 * 自动滚动 hook
 *
 * 在流式文本或思考文本更新后自动滚动到底部。支持智能暂停/恢复：
 *   - 新内容到来时，如果用户在底部（或从未操作过），自动滚动到底部
 *   - 如果用户向上滚动离开了底部，暂停自动滚动
 *   - 如果用户重新滚动到底部，恢复自动滚动
 *
 * 实现原理：
 *   不依赖任何事件监听器。在每次 useEffect 中比较
 *   (scrollTop + clientHeight) 与上一次记录的 scrollHeight，
 *   判断新内容加入"前"用户是否在底部。
 *   这样避免了事件标记位的 RAF 时序问题、React state 异步
 *   竞态问题，以及 ref 绑定在条件渲染元素上为 null 的问题。
 */

import { useEffect, useRef, RefObject } from 'react'

interface UseAutoScrollInput {
  /** 流式回答文本，变化时触发滚动 */
  streamingText: string
  /** 思考文本，变化时触发滚动 */
  thinkingText: string
  /** 智能体运行状态 */
  isRunning: boolean
  /** 回答文字容器 ref */
  streamingRef: RefObject<HTMLDivElement | null>
  /** 思考文字容器 ref */
  thinkingRef: RefObject<HTMLDivElement | null>
}

/** 判断用户是否在底部时的容差（像素），覆盖浏览器浮点精度误差 */
const BOTTOM_THRESHOLD = 5

/** 执行滚动：将容器滚动到底部 */
function scrollToBottom(el: HTMLDivElement): void {
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight
  })
}

export function useAutoScroll({
  streamingText,
  thinkingText,
  isRunning,
  streamingRef,
  thinkingRef,
}: UseAutoScrollInput): void {
  // 记录上一次渲染后的 scrollHeight，用于判断新内容到来前用户是否在底部
  const prevStreamingHeightRef = useRef(0)
  const prevThinkingHeightRef = useRef(0)

  // 回答文字更新后自动滚动（带用户滚动检测）
  useEffect(() => {
    const el = streamingRef.current
    if (!streamingText || !isRunning || !el) return

    // 判断新内容加入前用户是否在底部：
    // scrollTop + clientHeight 是当前可见区域底部相对于旧内容的位置
    // 如果这个值 >= 旧内容高度，说明用户之前就在底部
    const wasAtBottom =
      el.scrollTop + el.clientHeight >=
      prevStreamingHeightRef.current - BOTTOM_THRESHOLD

    // 先更新记录（供下一次比较），再决定是否滚动
    prevStreamingHeightRef.current = el.scrollHeight

    if (wasAtBottom) {
      scrollToBottom(el)
    }
  }, [streamingText, isRunning, streamingRef])

  // 思考文字更新后自动滚动（带用户滚动检测，逻辑同上）
  useEffect(() => {
    const el = thinkingRef.current
    if (!thinkingText || !isRunning || !el) return

    const wasAtBottom =
      el.scrollTop + el.clientHeight >=
      prevThinkingHeightRef.current - BOTTOM_THRESHOLD

    prevThinkingHeightRef.current = el.scrollHeight

    if (wasAtBottom) {
      scrollToBottom(el)
    }
  }, [thinkingText, isRunning, thinkingRef])
}