/**
 * 灵动岛计划文档渲染组件
 *
 * 将 write_plan 工具生成的 Markdown 计划文档渲染为 React 元素。
 * 支持：标题、步骤列表（含状态标记）、有序/无序列表、引用、分隔线、行内格式。
 */

import React from 'react'

// ==================== 行内格式化 ====================

/**
 * 行内格式化：处理 **粗体**、*斜体*、`行内代码`
 */
function inlineFormat(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="plan-md-code">{part.slice(1, -1)}</code>
    return part
  })
}

// ==================== Markdown 渲染 ====================

/**
 * 渲染计划文档 Markdown 为 React 元素
 * 支持：#/##/### 标题、步骤列表（[ ]/[x]/[>]/[!]）、有序/无序列表、引用、分隔线
 */
export function renderPlanMarkdown(content: string): React.ReactNode[] {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // 空行跳过
    if (!trimmed) continue

    // 分隔线
    if (/^-{3,}$/.test(trimmed) || /^_{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed)) {
      elements.push(<hr key={i} className="plan-md-hr" />)
      continue
    }

    // 标题
    if (trimmed.startsWith('### ')) {
      elements.push(<h4 key={i} className="plan-md-h3">{inlineFormat(trimmed.slice(4))}</h4>)
      continue
    }
    if (trimmed.startsWith('## ')) {
      elements.push(<h3 key={i} className="plan-md-h2">{inlineFormat(trimmed.slice(3))}</h3>)
      continue
    }
    if (trimmed.startsWith('# ')) {
      elements.push(<h2 key={i} className="plan-md-h1">{inlineFormat(trimmed.slice(2))}</h2>)
      continue
    }

    // 步骤列表：数字. [状态] 描述
    const stepMatch = trimmed.match(/^(\d+)\.\s*\[([ x>!~])\]\s*(.+)/)
    if (stepMatch) {
      const statusChar = stepMatch[2]
      const statusClass = statusChar === 'x' ? 'completed' : statusChar === '>' ? 'in_progress' : statusChar === '!' ? 'failed' : ''
      const marker = statusChar === 'x' ? '✓' : statusChar === '>' ? '▶' : statusChar === '!' ? '✕' : '○'
      elements.push(
        <div key={i} className={`plan-md-step ${statusClass}`}>
          <span className="plan-md-step-marker">{marker}</span>
          <span className="plan-md-step-num">{stepMatch[1]}.</span>
          <span className="plan-md-step-text">{inlineFormat(stepMatch[3])}</span>
        </div>
      )
      continue
    }

    // 引用备注（> 开头）
    if (trimmed.startsWith('> ')) {
      elements.push(<div key={i} className="plan-md-note">{inlineFormat(trimmed.slice(2))}</div>)
      continue
    }

    // 无序列表（- 或 * 开头）
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <div key={i} className="plan-md-li">
          <span className="plan-md-li-marker">•</span>
          <span>{inlineFormat(trimmed.slice(2))}</span>
        </div>
      )
      continue
    }

    // 有序列表（数字. 开头，但不是步骤列表）
    const olMatch = trimmed.match(/^(\d+)\.\s+(.+)/)
    if (olMatch) {
      elements.push(
        <div key={i} className="plan-md-li plan-md-oli">
          <span className="plan-md-li-marker">{olMatch[1]}.</span>
          <span>{inlineFormat(olMatch[2])}</span>
        </div>
      )
      continue
    }

    // 普通段落
    elements.push(<p key={i} className="plan-md-p">{inlineFormat(trimmed)}</p>)
  }

  return elements
}

// ==================== 计划文档卡片组件 ====================

/**
 * 单个计划文档渲染卡片
 * 用于在流式输出区域展示 write_plan 生成的计划文档
 */
export function PlanDocumentCard({
  doc,
  planDocumentLabel,
}: {
  doc: { toolCallId: string; content: string }
  planDocumentLabel: string
}) {
  return (
    <div key={`plan-doc-${doc.toolCallId}`} className="island-plan-document">
      <div className="island-plan-doc-title">{planDocumentLabel}</div>
      <div className="island-plan-doc-content">
        {renderPlanMarkdown(doc.content)}
      </div>
    </div>
  )
}
