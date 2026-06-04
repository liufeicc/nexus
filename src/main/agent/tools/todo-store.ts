/**
 * TodoStore — 内存中的任务列表
 *
 * 作为独立类存在，可被 AgentSessionState 持有实例。
 */

const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const

/** 单个任务项 */
export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

/**
 * TodoStore 类
 */
export class TodoStore {
  private _items: TodoItem[] = []
  private _onChange?: (items: TodoItem[]) => void

  /**
   * 注册变更回调。写入后自动触发，传入完整的当前计划列表。
   */
  setOnChange(callback: (items: TodoItem[]) => void): void {
    this._onChange = callback
  }

  /**
   * 写入 todos。写入后返回完整当前列表。
   */
  write(todos: TodoItem[], merge = false): TodoItem[] {
    if (!merge) {
      this._items = todos.map(t => this._validate(t)).filter(t => t.id !== '?')
      const deduped = this._dedupeById(this._items)
      this._items = deduped.map(t => this._validate(t))
    } else {
      const existing = new Map<string, TodoItem>()
      for (const item of this._items) existing.set(item.id, { ...item })

      for (const t of this._dedupeById(todos)) {
        const id = String(t.id ?? '').trim()
        if (!id) continue

        if (existing.has(id)) {
          const item = existing.get(id)!
          if (t.content) item.content = String(t.content).trim()
          if (t.status) {
            const s = String(t.status).trim().toLowerCase()
            if (VALID_STATUSES.includes(s as any)) item.status = s as any
          }
        } else {
          const validated = this._validate(t)
          existing.set(validated.id, validated)
        }
      }

      this._items = [...existing.values()]
    }
    const result = this.read()
    this._emitChange()
    return result
  }

  /** 触发变更回调（写入后自动调用） */
  private _emitChange(): void {
    this._onChange?.(this.read())
  }

  /** 返回当前列表的副本 */
  read(): TodoItem[] {
    return this._items.map(item => ({ ...item }))
  }

  /** 是否有任务 */
  hasItems(): boolean {
    return this._items.length > 0
  }

  /**
   * 格式化任务列表为上下文压缩注入文本。
   * 仅包含 pending/in_progress 项。
   */
  formatForInjection(): string | null {
    const activeItems = this._items.filter(
      item => item.status === 'pending' || item.status === 'in_progress'
    )
    if (activeItems.length === 0) return null

    const markers: Record<string, string> = {
      completed: '[x]',
      in_progress: '[>]',
      pending: '[ ]',
      cancelled: '[~]',
    }

    const lines = ['[Your active task list was preserved across context compression]']
    for (const item of activeItems) {
      const marker = markers[item.status] ?? '[?]'
      lines.push(`- ${marker} ${item.id}. ${item.content} (${item.status})`)
    }
    return lines.join('\n')
  }

  /** 验证并规范化单个任务项 */
  private _validate(item: any): TodoItem {
    const id = String(item.id ?? '').trim() || '?'
    const content = String(item.content ?? '').trim() || '(no description)'
    const status = String(item.status ?? 'pending').trim().toLowerCase()
    const validStatus = VALID_STATUSES.includes(status as any) ? (status as any) : 'pending'
    return { id, content, status: validStatus }
  }

  /** 按 ID 去重，保留最后出现的位置 */
  private _dedupeById(items: TodoItem[]): TodoItem[] {
    const lastIndex = new Map<string, number>()
    for (let i = 0; i < items.length; i++) {
      const id = String(items[i].id).trim() || '?'
      lastIndex.set(id, i)
    }
    const indices = [...lastIndex.values()].sort((a, b) => a - b)
    return indices.map(i => items[i])
  }
}
