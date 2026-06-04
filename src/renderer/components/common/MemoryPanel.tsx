import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../../i18n'

interface MemoryItem {
  id: string
  content: string
  scope: 'memory' | 'user'
  source: 'entry' | 'fact'
  trustScore?: number
  retrievalCount?: number
  createdAt: number
  updatedAt: number
}

interface MemoryDetail {
  id: string
  content: string
  scope: 'memory' | 'user'
  source: 'entry' | 'fact'
  createdAt: number
  updatedAt: number
}

interface MemoryPanelProps {
  /** 面板是否可见 */
  visible: boolean
  /** 关闭面板 */
  onClose: () => void
  /** 记忆被删除后的回调 */
  onDeleted?: () => void
}

export default function MemoryPanel({ visible, onClose, onDeleted }: MemoryPanelProps) {
  const { t } = useI18n()
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedMemory, setSelectedMemory] = useState<MemoryDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 加载记忆列表
  const loadMemories = useCallback(async () => {
    if (!visible) return
    setLoading(true)
    setError(null)
    setSelectedMemory(null)
    try {
      const result = await window.electronAPI.memory.list()
      if (result.success && result.memories) {
        setMemories(result.memories)
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
    loadMemories()
  }, [loadMemories])

  // 查看记忆详情
  const handleView = async (memory: MemoryItem) => {
    try {
      const result = await window.electronAPI.memory.view(memory.id, memory.source)
      if (result.success && result.memory) {
        setSelectedMemory({
          ...result.memory,
          source: memory.source,
        })
      }
    } catch (err) {
      setError(String(err))
    }
  }

  // 删除记忆
  const handleDelete = async (id: string, source: string) => {
    const result = await window.electronAPI.memory.delete(id, source)
    if (result.success) {
      setMemories(prev => prev.filter(m => m.id !== id))
      if (selectedMemory?.id === id) {
        setSelectedMemory(null)
      }
      onDeleted?.()
    } else {
      setError(result.error || t('common.delete'))
    }
  }

  // 格式化相对时间
  const formatTime = (timestamp: number): string => {
    if (!timestamp) return ''
    const now = Math.floor(Date.now() / 1000)
    const diff = now - timestamp
    if (diff < 60) return t('memoryPanel.justNow')
    if (diff < 3600) return `${Math.floor(diff / 60)}${t('memoryPanel.minutesAgo')}`
    if (diff < 86400) return `${Math.floor(diff / 3600)}${t('memoryPanel.hoursAgo')}`
    if (diff < 604800) return `${Math.floor(diff / 86400)}${t('memoryPanel.daysAgo')}`
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  // 格式化具体日期时间
  const formatDateTime = (timestamp: number): string => {
    if (!timestamp) return ''
    return new Date(timestamp * 1000).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (!visible) return null

  return (
    <div className="memory-panel-overlay" onClick={onClose}>
      <div className="memory-panel" onClick={(e) => e.stopPropagation()}>
        <div className="memory-panel-header">
          <h3>{t('memoryPanel.title')}</h3>
          <button className="memory-panel-close" onClick={onClose}>{'\u2715'}</button>
        </div>

        {loading && <div className="memory-panel-loading">{t('common.loading')}</div>}
        {error && <div className="memory-panel-error">{error}</div>}

        {!selectedMemory && !loading && (
          <div className="memory-list">
            {memories.length === 0 ? (
              <div className="memory-empty">{t('memoryPanel.noMemories')}</div>
            ) : (
              memories.map(memory => (
                <div
                  key={memory.id}
                  className="memory-item"
                  onClick={() => handleView(memory)}
                >
                  <div className="memory-item-left">
                    <div className="memory-item-header">
                      <span className={`memory-item-badge ${memory.source === 'fact' ? 'badge-fact' : 'badge-entry'}`}>
                        {memory.source === 'fact' ? t('memoryPanel.fromSummary') : t('memoryPanel.fromConversation')}
                      </span>
                      {memory.scope === 'user' && (
                        <span className="memory-item-badge badge-user">{t('settings.agent')}</span>
                      )}
                      {memory.trustScore !== undefined && (
                        <span className="memory-item-trust">
                          {t('memoryPanel.trustScore')}: {(memory.trustScore * 100).toFixed(0)}%
                        </span>
                      )}
                      {memory.retrievalCount !== undefined && memory.retrievalCount > 0 && (
                        <span className="memory-item-retrieval">
                          {t('common.search')}: {memory.retrievalCount}
                        </span>
                      )}
                    </div>
                    <div className="memory-item-desc">
                      {memory.content.length > 100
                        ? memory.content.slice(0, 100) + '...'
                        : memory.content}
                    </div>
                    {memory.createdAt > 0 && (
                      <div className="memory-item-time">
                        {formatTime(memory.createdAt)} · {formatDateTime(memory.createdAt)}
                      </div>
                    )}
                  </div>
                  <button
                    className="memory-item-delete"
                    onClick={(e) => { e.stopPropagation(); handleDelete(memory.id, memory.source) }}
                    title={t('common.delete')}
                  >
                    {'\u2715'}
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {selectedMemory && (
          <div className="memory-detail">
            <div className="memory-detail-back-row">
              <button className="memory-back-btn" onClick={() => {
                setSelectedMemory(null)
              }}>
                {'\u2190'} {t('common.cancel')}
              </button>
              <button
                className="memory-delete-btn"
                onClick={() => {
                  const matched = memories.find(m => m.id === selectedMemory.id)
                  handleDelete(selectedMemory.id, matched?.source || 'entry')
                }}
              >
                {t('common.delete')}
              </button>
            </div>
            <div className="memory-detail-header">
              <span className={`memory-item-badge ${selectedMemory.source === 'fact' ? 'badge-fact' : 'badge-entry'}`}>
                {selectedMemory.source === 'fact' ? t('memoryPanel.fromSummary') : t('memoryPanel.fromConversation')}
              </span>
              <span className={`memory-item-badge ${selectedMemory.scope === 'user' ? 'badge-user' : 'badge-memory'}`}>
                {selectedMemory.scope === 'user' ? t('settings.agent') : t('memoryPanel.title')}
              </span>
            </div>
            <div className="memory-detail-content">
              {selectedMemory.content}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
