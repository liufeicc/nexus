/**
 * 打字机文字效果组件
 *
 * 功能：
 * 1. 逐字显示文字，模拟打字机效果
 * 2. 显示闪烁的光标
 * 3. 打字完成后触发回调
 *
 * 实现原理：
 * - 使用 setInterval 定时器，每隔 speed 毫秒增加一个字符
 * - 当所有字符显示完成后，清除定时器并触发 onTypingComplete 回调
 * - 光标使用 CSS 动画实现闪烁效果
 */

import React, { useState, useEffect, useRef } from 'react'

/**
 * 打字机组件属性
 */
interface TypewriterTextProps {
  /** 要显示的文字 */
  text: string
  /** 每个字符之间的延迟（毫秒） */
  speed?: number
  /** 打字完成后的回调 */
  onTypingComplete?: () => void
  /** 自定义类名 */
  className?: string
}

/**
 * 打字机文字效果组件
 */
export function TypewriterText({
  text,
  speed = 40,
  onTypingComplete,
  className = '',
}: TypewriterTextProps) {
  // 当前已显示的字符数
  const [displayedCount, setDisplayedCount] = useState(0)
  // 是否已完成打字
  const [isComplete, setIsComplete] = useState(false)
  // 定时器引用
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // 重置状态
    setDisplayedCount(0)
    setIsComplete(false)

    // 清除之前的定时器
    if (timerRef.current) {
      clearInterval(timerRef.current)
    }

    // 如果文字为空，延迟触发完成回调（避免在渲染期间触发其他组件的 setState）
    if (!text) {
      setTimeout(() => {
        setIsComplete(true)
        onTypingComplete?.()
      }, 0)
      return
    }

    // 启动打字机定时器
    timerRef.current = setInterval(() => {
      setDisplayedCount((prev) => {
        const next = prev + 1

        // 所有字符显示完成
        if (next >= text.length) {
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          setIsComplete(true)
          onTypingComplete?.()
          return next
        }

        return next
      })
    }, speed)

    // 组件卸载时清理定时器
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [text, speed, onTypingComplete])

  // 获取当前显示的文字
  const displayedText = text.slice(0, displayedCount)

  return (
    <span className={`typewriter-text ${className} ${isComplete ? 'typewriter-done' : ''}`}>
      {displayedText}
      {/* 打字机光标 - 完成后隐藏 */}
      {!isComplete && <span className="typewriter-cursor" />}
    </span>
  )
}

export default TypewriterText
