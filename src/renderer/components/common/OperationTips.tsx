import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useI18n } from '../../i18n'

const TIP_KEYS = [
  'tips.createSession',
  'tips.browserPanel',
  'tips.splitScreen',
  'tips.dragResize',
  'tips.filePreview',
  'tips.nexusStart',
  'tips.nexusTask',
  'tips.nexusSkill',
  'tips.nextTask',
  'tips.nexusSummarize',
]

const INTERVAL = 5000
const ANIM_DURATION = 300

export function OperationTips() {
  const { t } = useI18n()
  const [index, setIndex] = useState(0)
  const [fade, setFade] = useState(false)
  const [paused, setPaused] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const advanceTip = useCallback(() => {
    setFade(true)
    setTimeout(() => {
      setIndex((prev) => (prev + 1) % TIP_KEYS.length)
      setFade(false)
    }, ANIM_DURATION)
  }, [])

  useEffect(() => {
    if (paused) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }
    timerRef.current = setInterval(advanceTip, INTERVAL)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [paused, advanceTip])

  return (
    <span
      style={{ opacity: fade ? 0 : 1, transition: 'opacity 0.3s ease' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {t(TIP_KEYS[index])}
    </span>
  )
}

export default OperationTips
