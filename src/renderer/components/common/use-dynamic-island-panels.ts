/**
 * 灵动岛面板状态 Hook
 * 从 DynamicIsland.tsx 提取
 * 职责：任务/技能/记忆面板的打开/关闭状态
 */

import { useState, useCallback } from 'react'

export interface UseDynamicIslandPanelsOutput {
  taskPanelOpen: boolean
  skillPanelOpen: boolean
  memoryPanelOpen: boolean
  setTaskPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSkillPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setMemoryPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  handleOpenTask: () => void
  handleOpenSkill: () => void
  handleOpenMemory: () => void
  handleClosePanels: () => void
}

export function useDynamicIslandPanels(): UseDynamicIslandPanelsOutput {
  const [taskPanelOpen, setTaskPanelOpen] = useState(false)
  const [skillPanelOpen, setSkillPanelOpen] = useState(false)
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false)

  const handleOpenTask = useCallback(() => {
    setTaskPanelOpen(true)
    setSkillPanelOpen(false)
    setMemoryPanelOpen(false)
  }, [])

  const handleOpenSkill = useCallback(() => {
    setSkillPanelOpen(true)
    setTaskPanelOpen(false)
    setMemoryPanelOpen(false)
  }, [])

  const handleOpenMemory = useCallback(() => {
    setMemoryPanelOpen(true)
    setTaskPanelOpen(false)
    setSkillPanelOpen(false)
  }, [])

  const handleClosePanels = useCallback(() => {
    setTaskPanelOpen(false)
    setSkillPanelOpen(false)
    setMemoryPanelOpen(false)
  }, [])

  return {
    taskPanelOpen,
    skillPanelOpen,
    memoryPanelOpen,
    setTaskPanelOpen,
    setSkillPanelOpen,
    setMemoryPanelOpen,
    handleOpenTask,
    handleOpenSkill,
    handleOpenMemory,
    handleClosePanels,
  }
}
