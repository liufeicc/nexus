import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../../i18n'

interface SkillMeta {
  name: string
  description: string
  category: string | null
  path: string
  platformCompatible: boolean
  readinessStatus: string
  trustLevel: string
  missingEnvVars: string[]
}

interface SkillPanelProps {
  /** 面板是否可见 */
  visible: boolean
  /** 关闭面板 */
  onClose: () => void
}

export default function SkillPanel({ visible, onClose }: SkillPanelProps) {
  const { t } = useI18n()
  const [skills, setSkills] = useState<SkillMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<{ name: string; content: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 加载技能列表
  const loadSkills = useCallback(async () => {
    if (!visible) return
    setLoading(true)
    setError(null)
    setSelectedSkill(null)
    try {
      const result = await window.electronAPI.skill.list()
      if (result.success && result.skills) {
        setSkills(result.skills)
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
    loadSkills()
  }, [loadSkills])

  // 查看技能详情
  const handleViewSkill = async (name: string) => {
    try {
      const result = await window.electronAPI.skill.view(name)
      if (result.success && result.content) {
        setSelectedSkill({
          name: result.content.name,
          content: result.content.content,
        })
      }
    } catch (err) {
      setError(String(err))
    }
  }

  // 删除技能
  const handleDelete = async (name: string) => {
    const result = await window.electronAPI.skill.manage('delete', name)
    if (result.success) {
      setSkills(prev => prev.filter(s => s.name !== name))
      if (selectedSkill?.name === name) {
        setSelectedSkill(null)
      }
    } else {
      setError(result.message || t('common.delete'))
    }
  }

  if (!visible) return null

  return (
    <div className="skill-panel-overlay" onClick={onClose}>
      <div className="skill-panel" onClick={(e) => e.stopPropagation()}>
        <div className="skill-panel-header">
          <h3>{t('skillPanel.title')}</h3>
          <button className="skill-panel-close" onClick={onClose}>{'\u2715'}</button>
        </div>

        {loading && <div className="skill-panel-loading">{t('common.loading')}</div>}
        {error && <div className="skill-panel-error">{error}</div>}

        {!selectedSkill && !loading && (
          <div className="skill-list">
            {skills.length === 0 ? (
              <div className="skill-empty">{t('skillPanel.noSkills')}</div>
            ) : (
              skills.map(skill => (
                <div
                  key={skill.name}
                  className="skill-item"
                  onClick={() => handleViewSkill(skill.name)}
                >
                  <div className="skill-item-left">
                    <div className="skill-item-header">
                      <div className="skill-item-name">{skill.name}</div>
                      {skill.category && (
                        <span className="skill-item-category">{skill.category}</span>
                      )}
                    </div>
                    <div className="skill-item-desc">
                      {skill.description.length > 80
                        ? skill.description.slice(0, 80) + '...'
                        : skill.description}
                    </div>
                  </div>
                  <button
                    className="skill-item-delete"
                    onClick={(e) => { e.stopPropagation(); handleDelete(skill.name) }}
                    title={t('common.delete')}
                  >
                    {'\u2715'}
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {selectedSkill && (
          <div className="skill-detail">
            <div className="skill-detail-back-row">
              <button className="skill-back-btn" onClick={() => {
                setSelectedSkill(null)
              }}>
                {'\u2190'} {t('common.cancel')}
              </button>
            </div>
            <h4>{selectedSkill.name}</h4>
            <pre className="skill-detail-content">{selectedSkill.content}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
