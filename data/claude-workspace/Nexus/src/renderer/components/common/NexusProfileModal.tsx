/**
 * 目录档案 .NEXUS.md 维护窗口
 *
 * 使用 react-complex-tree 实现懒加载目录树，
 * 右侧显示 .NEXUS.md 编辑框，支持 Ctrl+S 保存。
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '../../store'
import { useI18n } from '../../i18n'
import {
  UncontrolledTreeEnvironment,
  Tree,
  StaticTreeDataProvider,
  TreeItemIndex,
  TreeItem,
} from 'react-complex-tree'
import 'react-complex-tree/lib/style.css'

const MAX_CONTENT_LENGTH = 1000

const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', '.next', '.nuxt', 'coverage', '.cache', '.vite', 'proc', 'sys', 'dev', 'run', 'snap']

const ROOT_ITEM_ID = '__root__'

/**
 * 读取目录下的直接子目录（过滤后）
 */
async function fetchChildren(dirPath: string): Promise<string[]> {
  try {
    const result = await window.electronAPI.fs.readdir(dirPath)
    if (result.error) return []
    const names: string[] = []
    for (const item of result.items) {
      if (item.type !== 'directory') continue
      if (EXCLUDED_DIRS.includes(item.name)) continue
      if (item.name.startsWith('.')) continue
      names.push(item.path)
    }
    return names.sort()
  } catch {
    return []
  }
}

/**
 * 获取系统根节点列表
 */
async function getRootChildren(): Promise<string[]> {
  if (window.electronAPI.platform.isWindows) {
    const drives: string[] = []
    for (const letter of ['C', 'D', 'E', 'F', 'G']) {
      const path = `${letter}:\\`
      try {
        const result = await window.electronAPI.fs.readdir(path)
        if (!result.error) drives.push(path)
      } catch { /* 盘符不存在 */ }
    }
    return drives
  }
  return fetchChildren('/')
}

/**
 * 从路径中提取名称
 */
function getBasename(path: string): string {
  if (path === ROOT_ITEM_ID) return '' // 根节点名称由调用方翻译
  const trimmed = path.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

export function NexusProfileModal() {
  const { nexusProfileModal, setNexusProfileModalVisible } = useAppStore()
  const { t } = useI18n()

  const itemsRef = useRef<Record<TreeItemIndex, TreeItem>>({})
  const dataProviderRef = useRef<StaticTreeDataProvider | null>(null)
  const [, forceRender] = useState(0)

  // 选中/编辑状态
  const [selectedDir, setSelectedDir] = useState<string>('')
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('') // 保存时的原始内容，用于判断是否有修改
  const [fileExists, setFileExists] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false) // 未保存确认弹窗
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null) // 待执行的操作
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 当前文件是否有未保存的修改
  const hasDirty = content !== originalContent

  useEffect(() => {
    if (!nexusProfileModal.visible) return

    const init = async () => {
      const rootChildren = await getRootChildren()
      console.log('[NexusTree] rootChildren:', rootChildren)

      const items: Record<TreeItemIndex, TreeItem> = {
        [ROOT_ITEM_ID]: {
          index: ROOT_ITEM_ID,
          children: rootChildren,
          data: { name: t('nexusProfile.fileSystem') },
          isFolder: true,
        },
      }
      for (const childPath of rootChildren) {
        items[childPath] = {
          index: childPath,
          children: undefined,
          data: { name: getBasename(childPath) },
          isFolder: true,
        }
      }

      itemsRef.current = items
      dataProviderRef.current = new StaticTreeDataProvider(items)
      forceRender(n => n + 1)

      const state = useAppStore.getState()
      let defaultDir: string
      const activePanel = state.panels.find(p => p.id === state.activePanelId)
      if (activePanel && 'cwd' in activePanel && activePanel.cwd) {
        defaultDir = activePanel.cwd
      } else {
        try {
          defaultDir = await window.electronAPI.app.getPath('home')
        } catch {
          defaultDir = window.electronAPI.platform.isWindows ? 'C:\\' : '/'
        }
      }

      setSelectedDir(defaultDir)
      await loadNexusProfile(defaultDir)
    }

    init()
  }, [nexusProfileModal.visible])

  const handleExpandItem = useCallback(async (item: TreeItem, treeId: string) => {
    console.log('[NexusTree] handleExpandItem called:', item.index, 'children:', item.children)

    if (item.children !== undefined) {
      console.log('[NexusTree] already loaded, skipping')
      return
    }

    const dirPath = item.index as string
    const children = await fetchChildren(dirPath)
    console.log('[NexusTree] fetchChildren result:', children)

    const items = itemsRef.current
    const provider = dataProviderRef.current
    if (!provider) return

    // 1. 注入子节点
    for (const childPath of children) {
      if (!items[childPath]) {
        const childItem: TreeItem = {
          index: childPath,
          children: undefined,
          data: { name: getBasename(childPath) },
          isFolder: true,
        }
        items[childPath] = childItem
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(provider as any).data.items[childPath] = childItem
      }
    }

    // 2. 更新父节点 children
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(provider as any).data.items[dirPath].children = children
    console.log('[NexusTree] updated parent children:', dirPath, '->', children)

    // 3. 通知树组件
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(provider as any).onDidChangeTreeDataEmitter.emit([dirPath])
    console.log('[NexusTree] emitted change event')
  }, [])

  const handleSelectItems = useCallback(async (itemIds: TreeItemIndex[], _treeId: string) => {
    if (itemIds.length > 0) {
      const dir = itemIds[itemIds.length - 1] as string
      if (dir === ROOT_ITEM_ID) return

      // 如果当前文件有未保存的修改，弹出确认
      if (hasDirty && selectedDir) {
        setPendingAction(() => async () => {
          setSelectedDir(dir)
          await loadNexusProfile(dir)
        })
        setShowConfirmDialog(true)
      } else {
        setSelectedDir(dir)
        await loadNexusProfile(dir)
      }
    }
  }, [hasDirty, selectedDir])

  /**
   * 尝试关闭窗口，如果有未保存的修改则弹出确认
   */
  const handleClose = useCallback(() => {
    if (hasDirty && selectedDir) {
      setPendingAction(() => () => {
        setNexusProfileModalVisible(false)
      })
      setShowConfirmDialog(true)
    } else {
      setNexusProfileModalVisible(false)
    }
  }, [hasDirty, selectedDir, setNexusProfileModalVisible])

  const loadNexusProfile = async (dirPath: string) => {
    setLoading(true)
    try {
      const result = await window.electronAPI.nexusProfile.read(dirPath)
      setFileExists(result.exists)
      setContent(result.exists ? result.content : '')
      setOriginalContent(result.exists ? result.content : '') // 记录原始内容
    } catch (error) {
      console.error('[NexusProfileModal] 读取失败:', error)
      setContent('')
      setOriginalContent('')
      setFileExists(false)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!selectedDir || saving || content.length > MAX_CONTENT_LENGTH) return
    setSaving(true)
    try {
      const result = await window.electronAPI.nexusProfile.write(selectedDir, content)
      if (result.success) {
        setFileExists(true)
        setOriginalContent(content) // 更新原始内容为当前内容，清除 dirty 状态
      } else {
        console.error('[NexusProfileModal] 保存失败:', result.error)
      }
    } catch (error) {
      console.error('[NexusProfileModal] 保存异常:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleGenerate = async () => {
    if (!selectedDir || generating) return
    setGenerating(true)
    try {
      const result = await window.electronAPI.nexusProfile.generate(selectedDir)
      if (result.success) {
        // 生成成功后重新读取文件内容
        await loadNexusProfile(selectedDir)
      } else {
        console.error('[NexusProfileModal] 自动生成失败:', result.error)
      }
    } catch (error) {
      console.error('[NexusProfileModal] 自动生成异常:', error)
    } finally {
      setGenerating(false)
    }
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  if (!nexusProfileModal.visible) return null

  const dataProvider = dataProviderRef.current

  return (
    <div className="modal-overlay" onClick={e => e.stopPropagation()}>
      <div className="modal-container nexus-profile-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <svg className="modal-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
          </svg>
          <h3 className="modal-title">{t('toolbar.nexusProfile')}</h3>
        </div>

        <div className="modal-body nexus-profile-body">
          <div className="nexus-profile-tree">
            {dataProvider && (
              <UncontrolledTreeEnvironment
                dataProvider={dataProvider}
                getItemTitle={item => item.index === ROOT_ITEM_ID ? t('nexusProfile.fileSystem') : getBasename(item.index as string)}
                viewState={{
                  'nexus-dir-tree': {},
                }}
                onExpandItem={handleExpandItem}
                onSelectItems={handleSelectItems}
              >
                <Tree treeId="nexus-dir-tree" rootItem={ROOT_ITEM_ID} treeLabel={t('nexusProfile.treeLabel')} />
              </UncontrolledTreeEnvironment>
            )}
          </div>

          <div className="nexus-profile-editor">
            <div className="nexus-profile-editor-header">
              <span className="nexus-profile-dir-path">{selectedDir}</span>
              {hasDirty && <span className="nexus-profile-dirty" title={t('nexusProfile.unsavedChanges')}>●</span>}
            </div>

            {loading ? (
              <div className="nexus-profile-loading">{t('common.loading')}</div>
            ) : (
              <>
                <textarea
                  ref={textareaRef}
                  className="nexus-profile-textarea"
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={fileExists ? '' : t('nexusProfile.emptyPlaceholder')}
                  maxLength={MAX_CONTENT_LENGTH + 100}
                />
                <div className="nexus-profile-char-count">
                  <span className={content.length > MAX_CONTENT_LENGTH ? 'count-over' : 'count-normal'}>
                    {content.length} / {MAX_CONTENT_LENGTH}
                  </span>
                </div>
              </>
            )}

            <div className="nexus-profile-actions">
              <button
                className="modal-btn modal-btn-secondary"
                onClick={handleGenerate}
                disabled={generating || saving || !selectedDir}
                title={t('nexusProfile.generateTooltip')}
              >
                {generating ? t('nexusProfile.generating') : t('nexusProfile.autoGenerate')}
              </button>
              <div className="nexus-profile-actions-spacer" />
              <button
                className="modal-btn modal-btn-cancel"
                onClick={handleClose}
                disabled={saving || generating}
              >
                {t('common.close')}
              </button>
              <button
                className="modal-btn modal-btn-confirm"
                onClick={handleSave}
                disabled={saving || generating || content.length > MAX_CONTENT_LENGTH || !content.trim()}
              >
                {saving ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 未保存确认弹窗 */}
      {showConfirmDialog && (
        <div className="modal-overlay" onClick={() => setShowConfirmDialog(false)}>
          <div className="modal-container confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{t('nexusProfile.confirmClose')}</h3>
            </div>
            <div className="modal-body">
              <p className="confirm-message">
                {t('nexusProfile.confirmCloseMessage', { name: getBasename(selectedDir) })}
              </p>
              <div className="confirm-actions">
                <button
                  className="modal-btn modal-btn-secondary"
                  onClick={() => {
                    setShowConfirmDialog(false)
                    // 不保存，直接执行原操作
                    pendingAction?.()
                    setPendingAction(null)
                  }}
                >
                  {t('nexusProfile.dontSave')}
                </button>
                <button
                  className="modal-btn modal-btn-confirm"
                  onClick={async () => {
                    await handleSave()
                    setShowConfirmDialog(false)
                    // 保存成功后执行原操作
                    pendingAction?.()
                    setPendingAction(null)
                  }}
                >
                  {t('nexusProfile.saveAndClose')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
