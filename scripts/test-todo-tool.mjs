/**
 * 测试脚本：测试 todo 工具
 * 运行方式：node scripts/test-todo-tool.mjs
 */

// 内联 TodoStore 实现（Node strip-only 不支持跨模块 TS 导入）
const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled']

class TodoStore {
  _items = []

  write(todos, merge = false) {
    if (!merge) {
      this._items = todos.map(t => this._validate(t)).filter(t => t.id !== '?')
      this._items = this._dedupeById(this._items).map(t => this._validate(t))
    } else {
      const existing = new Map()
      for (const item of this._items) existing.set(item.id, { ...item })
      for (const t of this._dedupeById(todos)) {
        const id = String(t.id ?? '').trim()
        if (!id) continue
        if (existing.has(id)) {
          const item = existing.get(id)
          if (t.content) item.content = String(t.content).trim()
          if (t.status) {
            const s = String(t.status).trim().toLowerCase()
            if (VALID_STATUSES.includes(s)) item.status = s
          }
        } else {
          const validated = this._validate(t)
          existing.set(validated.id, validated)
        }
      }
      this._items = [...existing.values()]
    }
    return this.read()
  }

  read() { return this._items.map(i => ({ ...i })) }

  hasItems() { return this._items.length > 0 }

  formatForInjection() {
    const active = this._items.filter(i => i.status === 'pending' || i.status === 'in_progress')
    if (active.length === 0) return null
    const markers = { completed: '[x]', in_progress: '[>]', pending: '[ ]', cancelled: '[~]' }
    const lines = ['[Your active task list was preserved across context compression]']
    for (const item of active) {
      const marker = markers[item.status] ?? '[?]'
      lines.push(`- ${marker} ${item.id}. ${item.content} (${item.status})`)
    }
    return lines.join('\n')
  }

  _validate(item) {
    const id = String(item.id ?? '').trim() || '?'
    const content = String(item.content ?? '').trim() || '(no description)'
    let status = String(item.status ?? 'pending').trim().toLowerCase()
    if (!VALID_STATUSES.includes(status)) status = 'pending'
    return { id, content, status }
  }

  _dedupeById(items) {
    const lastIndex = new Map()
    for (let i = 0; i < items.length; i++) {
      const id = String(items[i].id).trim() || '?'
      lastIndex.set(id, i)
    }
    return [...lastIndex.values()].sort((a, b) => a - b).map(i => items[i])
  }
}

function formatTodos(items) {
  if (items.length === 0) return '任务列表为空'
  const icons = { pending: '[ ]', in_progress: '[>]', completed: '[x]', cancelled: '[~]' }
  return items.map(t => `  ${icons[t.status] ?? '[?]'} [${t.id}] (${t.status}): ${t.content}`).join('\n')
}

function buildSummary(items) {
  return {
    total: items.length,
    pending: items.filter(i => i.status === 'pending').length,
    in_progress: items.filter(i => i.status === 'in_progress').length,
    completed: items.filter(i => i.status === 'completed').length,
    cancelled: items.filter(i => i.status === 'cancelled').length,
  }
}

// ==================== 测试用例 ====================

function testReplaceWrite() {
  console.log('=== 测试 1: Replace 模式写入 ===')
  const store = new TodoStore()
  const items = store.write([
    { id: '1', content: 'Read codebase', status: 'completed' },
    { id: '2', content: 'Write fix', status: 'in_progress' },
    { id: '3', content: 'Run tests', status: 'pending' },
  ])
  console.log('  任务数:', items.length)
  console.log('  第一个 ID:', items[0].id)
  console.log('  成功:', items.length === 3 && items[0].id === '1' ? 'PASS' : 'FAIL')
}

function testReadOnly() {
  console.log('\n=== 测试 2: 仅读取（不提供 todos） ===')
  const store = new TodoStore()
  store.write([{ id: 'a', content: 'Task A', status: 'pending' }])
  const items = store.read()
  console.log('  任务数:', items.length)
  console.log('  内容:', items[0].content)
  console.log('  成功:', items.length === 1 && items[0].content === 'Task A' ? 'PASS' : 'FAIL')
}

function testMergeMode() {
  console.log('\n=== 测试 3: Merge 模式更新 ===')
  const store = new TodoStore()
  store.write([
    { id: '1', content: 'Task A', status: 'pending' },
    { id: '2', content: 'Task B', status: 'pending' },
  ])
  // Merge: 只更新 id=1
  const items = store.write([{ id: '1', content: 'Task A Updated', status: 'completed' }], true)
  console.log('  任务数:', items.length)
  const t1 = items.find(i => i.id === '1')
  const t2 = items.find(i => i.id === '2')
  console.log('  Task 1:', t1?.status, t1?.content)
  console.log('  Task 2:', t2?.status, t2?.content)
  console.log('  成功:', items.length === 2 && t1?.status === 'completed' && t2?.status === 'pending' ? 'PASS' : 'FAIL')
}

function testMergeAddNew() {
  console.log('\n=== 测试 4: Merge 模式追加新项 ===')
  const store = new TodoStore()
  store.write([{ id: '1', content: 'Task A', status: 'pending' }])
  const items = store.write([{ id: '2', content: 'Task B', status: 'pending' }], true)
  console.log('  任务数:', items.length)
  console.log('  成功:', items.length === 2 ? 'PASS' : 'FAIL')
}

function testDedupe() {
  console.log('\n=== 测试 5: ID 去重（保留最后出现） ===')
  const store = new TodoStore()
  const items = store.write([
    { id: '1', content: 'Old version', status: 'pending' },
    { id: '2', content: 'Task B', status: 'pending' },
    { id: '1', content: 'New version', status: 'completed' },
  ])
  console.log('  任务数:', items.length)
  const t1 = items.find(i => i.id === '1')
  console.log('  Task 1 内容:', t1?.content)
  console.log('  成功:', items.length === 2 && t1?.content === 'New version' ? 'PASS' : 'FAIL')
}

function testValidation() {
  console.log('\n=== 测试 6: 验证和规范化 ===')
  const store = new TodoStore()
  const items = store.write([
    { id: '', content: '', status: 'invalid_status' },
    { id: '1', content: 'Valid task', status: 'INVALID' },
  ])
  console.log('  任务数:', items.length)
  console.log('  空 ID 任务:', items[0]?.id)
  console.log('  无效状态:', items[1]?.status)
  // 空 ID 会被过滤掉
  console.log('  成功:', items.length === 1 && items[0].status === 'pending' ? 'PASS' : 'FAIL')
}

function testFormatInjection() {
  console.log('\n=== 测试 7: 上下文压缩注入格式 ===')
  const store = new TodoStore()
  store.write([
    { id: '1', content: 'Read codebase', status: 'completed' },
    { id: '2', content: 'Write fix', status: 'in_progress' },
    { id: '3', content: 'Run tests', status: 'pending' },
    { id: '4', content: 'Abandoned', status: 'cancelled' },
  ])
  const injection = store.formatForInjection()
  console.log('  注入文本:')
  for (const line of (injection ?? '').split('\n')) console.log('    ' + line)
  const hasCompleted = injection?.includes('Read codebase')
  const hasAbandoned = injection?.includes('Abandoned')
  const hasActive = injection?.includes('Write fix') && injection?.includes('Run tests')
  console.log('  包含已完成:', hasCompleted)
  console.log('  包含已取消:', hasAbandoned)
  console.log('  包含活跃项:', hasActive)
  console.log('  成功:', hasActive && !hasCompleted && !hasAbandoned ? 'PASS' : 'FAIL')
}

function testInjectionAllCompleted() {
  console.log('\n=== 测试 8: 全部完成时不注入 ===')
  const store = new TodoStore()
  store.write([
    { id: '1', content: 'Done', status: 'completed' },
    { id: '2', content: 'Also done', status: 'cancelled' },
  ])
  const injection = store.formatForInjection()
  console.log('  注入结果:', injection)
  console.log('  成功:', injection === null ? 'PASS' : 'FAIL')
}

function testInjectionEmpty() {
  console.log('\n=== 测试 9: 空列表不注入 ===')
  const store = new TodoStore()
  console.log('  注入结果:', store.formatForInjection())
  console.log('  成功:', store.formatForInjection() === null ? 'PASS' : 'FAIL')
}

function testSummary() {
  console.log('\n=== 测试 10: 统计摘要 ===')
  const store = new TodoStore()
  store.write([
    { id: '1', content: 'A', status: 'pending' },
    { id: '2', content: 'B', status: 'in_progress' },
    { id: '3', content: 'C', status: 'completed' },
    { id: '4', content: 'D', status: 'cancelled' },
    { id: '5', content: 'E', status: 'pending' },
  ])
  const summary = buildSummary(store.read())
  console.log('  统计:', JSON.stringify(summary))
  console.log('  成功:', summary.total === 5 && summary.pending === 2 && summary.in_progress === 1 && summary.completed === 1 && summary.cancelled === 1 ? 'PASS' : 'FAIL')
}

function testHasItems() {
  console.log('\n=== 测试 11: hasItems 检查 ===')
  const store1 = new TodoStore()
  const store2 = new TodoStore()
  store2.write([{ id: '1', content: 'Task', status: 'pending' }])
  console.log('  空:', store1.hasItems())
  console.log('  有:', store2.hasItems())
  console.log('  成功:', !store1.hasItems() && store2.hasItems() ? 'PASS' : 'FAIL')
}

// ==================== 主测试 ====================

console.log('\n========== Todo 工具测试 ==========\n')

testReplaceWrite()
testReadOnly()
testMergeMode()
testMergeAddNew()
testDedupe()
testValidation()
testFormatInjection()
testInjectionAllCompleted()
testInjectionEmpty()
testSummary()
testHasItems()

console.log('\n========== 所有测试完成 ==========\n')
