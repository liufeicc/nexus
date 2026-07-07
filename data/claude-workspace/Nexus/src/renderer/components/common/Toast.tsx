/**
 * Toast 提示组件
 */

import React, { useEffect } from 'react'
import { useAppStore } from '../../store'

export function Toast() {
  const { toast, hideToast } = useAppStore()

  // 自动隐藏
  useEffect(() => {
    if (!toast?.visible) return
    const timer = setTimeout(() => {
      hideToast()
    }, 1500)
    return () => clearTimeout(timer)
  }, [toast?.visible, hideToast])

  if (!toast?.visible) {
    return null
  }

  return (
    <div className="toast" onClick={hideToast}>
      {toast.message}
    </div>
  )
}

export default Toast
