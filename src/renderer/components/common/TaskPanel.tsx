import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../../i18n'

interface TaskMeta {
  name: string
  title: string
  description: string
}

interface TaskPanelProps {
  /** 面板是否可见 */
  visible: boolean
  /** 选择任务后的回调，将任务内容传入 */
  onSelect: (taskContent: string) => void
  /** 关闭面板 */
  onClose: () => void
  /** 是否禁用执行按钮（Agent 回复中） */
  disabled?: boolean
  /** 任务被删除后的回调 */
  onDeleted?: () => void
}

export default function TaskPanel({ visible, onSelect, onClose, disabled = false, onDeleted }: TaskPanelProps) {
  const { t } = useI18n()
  const [tasks, setTasks] = useState<TaskMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTask, setSelectedTask] = useState<{ name: string; title: string; content: string } | null>(null)
  const [editedContent, setEditedContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /** 判断内容是否被修改过 */
  const isModified = selectedTask !== null && editedContent !== selectedTask.content

  // 加载任务列表
  const loadTasks = useCallback(async () => {
    if (!visible) return
    setLoading(true)
    setError(null)
    setSelectedTask(null)
    setEditedContent('')
    try {
      const result = await window.electronAPI.task.list()
      if (result.success && result.tasks) {
        setTasks(result.tasks)
      } else {
        setError(result.error || t('toast.saveFailed'))
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [visible])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  // 查看任务详情
  const handleViewTask = async (name: string) => {
    try {
      const result = await window.electronAPI.task.view(name)
      if (result.success && result.content) {
        setSelectedTask({
          name: result.content.name,
          title: result.content.title,
          content: result.content.content,
        })
        setEditedContent(result.content.content)
      }
    } catch (err) {
      setError(String(err))
    }
  }

  // 执行任务（使用编辑后的内容，不保存文件）
  const handleExecute = () => {
    if (selectedTask) {
      onSelect(editedContent)
      onClose()
    }
  }

  // 保存修改到任务文件
  const handleSave = async () => {
    if (!selectedTask) return
    setSaving(true)
    setError(null)
    try {
      const result = await window.electronAPI.task.manage('edit', selectedTask.name, editedContent)
      if (result.success) {
        setSelectedTask(prev => prev ? { ...prev, content: editedContent } : null)
      } else {
        setError(result.message || t('toast.saveFailed'))
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  // 删除任务
  const handleDelete = async (name: string) => {
    const result = await window.electronAPI.task.manage('delete', name)
    if (result.success) {
      setTasks(prev => prev.filter(t => t.name !== name))
      if (selectedTask?.name === name) {
        setSelectedTask(null)
        setEditedContent('')
      }
      onDeleted?.()
    } else {
      setError(result.message || t('common.delete'))
    }
  }

  if (!visible) return null

  return (
    <div className="task-panel-overlay" onClick={onClose}>
      <div className="task-panel" onClick={(e) => e.stopPropagation()}>
        <div className="task-panel-header">
          <h3>{isModified ? '\u273B ' + t('taskPanel.title') : t('taskPanel.title')}</h3>
          <button className="task-panel-close" onClick={onClose}>{'\u2715'}</button>
        </div>

        {loading && <div className="task-panel-loading">{t('common.loading')}</div>}
        {error && <div className="task-panel-error">{error}</div>}

        {!selectedTask && !loading && (
          <div className="task-list">
            {tasks.length === 0 ? (
              <div className="task-empty">{t('taskPanel.noTasks')}</div>
            ) : (
              tasks.map(task => (
                <div
                  key={task.name}
                  className="task-item"
                  onClick={() => handleViewTask(task.name)}
                >
                  <div className="task-item-left">
                    <div className="task-item-title">{task.title}</div>
                    <div className="task-item-desc">
                      {task.description.length > 80
                        ? task.description.slice(0, 80) + '...'
                        : task.description}
                    </div>
                  </div>
                  <button
                    className="task-item-delete"
                    onClick={(e) => { e.stopPropagation(); handleDelete(task.name) }}
                    title={t('common.delete')}
                  >
                    {'\u2715'}
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {selectedTask && (
          <div className="task-detail">
            <div className="task-detail-back-row">
              <button className="task-back-btn" onClick={() => {
                setSelectedTask(null)
                setEditedContent('')
              }}>
                {'\u2190'} {t('common.cancel')}
              </button>
              <button
                className="task-back-btn"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? t('common.loading') : t('common.save')}
              </button>
            </div>
            <h4>{selectedTask.title}</h4>
            <textarea
              className="task-detail-content"
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              spellCheck={false}
            />
            <button className="task-execute-btn" onClick={handleExecute} disabled={disabled} title={disabled ? t('agent.waiting') : undefined}>
              {t('taskPanel.executeTask')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
