/**
 * 对话历史消息数据访问层
 *
 * 管理 agent_messages 表的 CRUD 操作。
 * 按 topic_id（对话主题）组织消息，一个 topic 下的多轮对话共享同一 topic_id。
 */

import Database from 'better-sqlite3'
import { AgentMessage, ContentBlock } from '../../core/types/agent'
import { logger } from '../utils/logger'

export interface AgentMessageRow {
  id: number
  topic_id: string
  nexus_session_id: string
  turn_index: number
  role: string
  content: string | null
  tool_calls: string | null
  tool_call_id: string | null
  tool_name: string | null
  is_complete: number
  created_at: number
}

export interface TopicSummary {
  topicId: string
  messageCount: number
  createdAt: number
}

export interface TopicHistory {
  topicId: string
  messages: AgentMessage[]
}

export class AgentMessageDAO {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  // ==================== 加载历史 ====================

  /**
   * 加载指定 topic 的全部历史消息（按 turn_index 排序）
   */
  loadByTopic(topicId: string, nexusSessionId: string): AgentMessage[] {
    const rows = this.db.prepare(
      `SELECT id, topic_id, nexus_session_id, turn_index, role, content,
              tool_calls, tool_call_id, tool_name, is_complete, created_at
       FROM agent_messages
       WHERE topic_id = ? AND nexus_session_id = ?
       ORDER BY turn_index ASC, id ASC`
    ).all(topicId, nexusSessionId) as AgentMessageRow[]

    return rows.map(row => this.rowToMessage(row))
  }

  /**
   * 加载指定 nexusSession 下最新的 topic 历史
   * 返回 null 表示无任何历史
   */
  loadLatestTopic(nexusSessionId: string): TopicHistory | null {
    // 先找到最新的 topic_id
    const latest = this.db.prepare(
      `SELECT topic_id, MAX(created_at) as created_at
       FROM agent_messages
       WHERE nexus_session_id = ?
       GROUP BY topic_id
       ORDER BY created_at DESC
       LIMIT 1`
    ).get(nexusSessionId) as { topic_id: string; created_at: number } | undefined

    if (!latest) return null

    return {
      topicId: latest.topic_id,
      messages: this.loadByTopic(latest.topic_id, nexusSessionId),
    }
  }

  /**
   * 获取指定 session 下的所有 topic 列表（按创建时间倒序）
   */
  listTopics(nexusSessionId: string): TopicSummary[] {
    const rows = this.db.prepare(
      `SELECT topic_id, COUNT(*) as messageCount, MIN(created_at) as createdAt
       FROM agent_messages
       WHERE nexus_session_id = ?
       GROUP BY topic_id
       ORDER BY createdAt DESC`
    ).all(nexusSessionId) as Array<{ topic_id: string; messageCount: number; createdAt: number }>

    return rows.map(row => ({
      topicId: row.topic_id,
      messageCount: row.messageCount,
      createdAt: row.createdAt,
    }))
  }

  /**
   * 加载指定 session 的全部消息（按时间排序）
   *
   * 用于 agent 实例不存在时，按 nexusSessionId 读取完整对话历史。
   */
  loadAllBySessionId(nexusSessionId: string): AgentMessage[] {
    const rows = this.db.prepare(
      `SELECT id, topic_id, nexus_session_id, turn_index, role, content,
              tool_calls, tool_call_id, tool_name, is_complete, created_at
       FROM agent_messages
       WHERE nexus_session_id = ?
       ORDER BY created_at ASC, turn_index ASC, id ASC`
    ).all(nexusSessionId) as AgentMessageRow[]

    return rows.map(row => this.rowToMessage(row))
  }

  /**
   * 获取所有不重复的 nexus_session_id 列表
   */
  getDistinctSessionIds(): string[] {
    const rows = this.db.prepare(
      `SELECT DISTINCT nexus_session_id FROM agent_messages`
    ).all() as Array<{ nexus_session_id: string }>

    return rows.map(r => r.nexus_session_id)
  }

  // ==================== 保存消息 ====================

  /**
   * 保存单条消息
   */
  saveMessage(
    topicId: string,
    nexusSessionId: string,
    msg: AgentMessage,
    turnIndex: number,
  ): void {
    const content = typeof msg.content === 'string'
      ? msg.content
      : msg.content ? JSON.stringify(msg.content) : null

    const toolCalls = msg.tool_calls ? JSON.stringify(msg.tool_calls) : null
    const toolName = msg.name || null

    this.db.prepare(
      `INSERT INTO agent_messages
       (topic_id, nexus_session_id, turn_index, role, content, tool_calls, tool_call_id, tool_name, is_complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))`
    ).run(topicId, nexusSessionId, turnIndex, msg.role, content, toolCalls, msg.tool_call_id || null, toolName, 0)
  }

  /**
   * 标记某 turn 的所有消息为完整（turn 成功完成后调用）
   */
  markTurnComplete(topicId: string, turnIndex: number, nexusSessionId: string): void {
    this.db.prepare(
      `UPDATE agent_messages SET is_complete = 1
       WHERE topic_id = ? AND turn_index = ? AND nexus_session_id = ?`
    ).run(topicId, turnIndex, nexusSessionId)
  }

  /**
   * 获取下一个 turn_index（用于新 turn 开始时确定序号）
   */
  getNextTurnIndex(topicId: string, nexusSessionId: string): number {
    const result = this.db.prepare(
      `SELECT MAX(turn_index) as maxTurn FROM agent_messages WHERE topic_id = ? AND nexus_session_id = ?`
    ).get(topicId, nexusSessionId) as { maxTurn: number | null } | undefined

    return (result?.maxTurn ?? -1) + 1
  }

  /**
   * 查询 topic 对应的 nexus_session_id
   */
  getTopicSessionId(topicId: string): string | null {
    const row = this.db.prepare(
      `SELECT nexus_session_id FROM agent_messages WHERE topic_id = ? LIMIT 1`
    ).get(topicId) as { nexus_session_id: string } | undefined

    return row?.nexus_session_id ?? null
  }

  /**
   * 替换整个 topic 的消息（原子操作）
   *
   * 用于后台压缩完成后，将压缩结果写回数据库。
   * 删除所有旧消息 → 插入压缩后的新消息，turn_index 重新分配。
   *
   * @param topicId 要替换的 topic
   * @param nexusSessionId 会话 ID（用于新记录插入）
   * @param messages 压缩后的新消息列表
   */
  replaceTopicMessages(
    topicId: string,
    nexusSessionId: string,
    messages: AgentMessage[],
  ): void {
    const tx = this.db.transaction(() => {
      // 删除所有旧消息
      this.db.prepare(`DELETE FROM agent_messages WHERE topic_id = ?`).run(topicId)

      // 插入压缩后的新消息
      const stmt = this.db.prepare(
        `INSERT INTO agent_messages
         (topic_id, nexus_session_id, turn_index, role, content,
          tool_calls, tool_call_id, tool_name, is_complete)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
      )

      let turnIndex = 0
      for (const msg of messages) {
        const content = typeof msg.content === 'string'
          ? msg.content
          : msg.content ? JSON.stringify(msg.content) : null

        const toolCalls = msg.tool_calls ? JSON.stringify(msg.tool_calls) : null
        const toolName = msg.name || null

        // tool 消息与前一条 assistant 消息共享同一 turn
        const currentTurn = msg.role === 'tool' ? turnIndex : turnIndex++

        stmt.run(
          topicId,
          nexusSessionId,
          currentTurn,
          msg.role,
          content,
          toolCalls,
          msg.tool_call_id || null,
          toolName,
        )
      }
    })

    tx()
    logger.info(`[AgentMessageDAO] 已替换 topic ${topicId}，新消息数: ${messages.length}`)
  }

  /**
   * 加载全部消息（不按 topic 过滤）
   *
   * 用于后台压缩 Agent，需要读取完整的对话历史进行压缩。
   */
  loadAllMessages(): AgentMessage[] {
    const rows = this.db.prepare(
      `SELECT id, topic_id, nexus_session_id, turn_index, role, content,
              tool_calls, tool_call_id, tool_name, is_complete, created_at
       FROM agent_messages
       ORDER BY created_at ASC, turn_index ASC, id ASC`
    ).all() as AgentMessageRow[]

    return rows.map(row => this.rowToMessage(row))
  }

  /**
   * 删除指定 topic 的所有消息
   */
  deleteByTopic(topicId: string, nexusSessionId: string): void {
    this.db.prepare(`DELETE FROM agent_messages WHERE topic_id = ? AND nexus_session_id = ?`).run(topicId, nexusSessionId)
    logger.info(`[AgentMessageDAO] 已删除 topic ${topicId} 的对话历史 (session: ${nexusSessionId})`)
  }

  /**
   * 删除指定 session 的所有对话历史
   */
  deleteAllBySessionId(nexusSessionId: string): void {
    this.db.prepare(`DELETE FROM agent_messages WHERE nexus_session_id = ?`).run(nexusSessionId)
    logger.info(`[AgentMessageDAO] 已删除 session ${nexusSessionId} 的所有对话历史`)
  }

  /**
   * 删除所有对话历史（全表删除，仅限管理操作）
   */
  deleteAll(): void {
    this.db.prepare(`DELETE FROM agent_messages`).run()
    logger.info('[AgentMessageDAO] 已删除所有对话历史（全表）')
  }

  /**
   * 替换指定 session 的全部消息（原子操作）
   *
   * 用于后台压缩完成后，清空旧数据并插入压缩后的新数据。
   *
   * @param nexusSessionId 会话 ID
   * @param messages 压缩后的新消息列表
   */
  replaceAllMessages(nexusSessionId: string, messages: AgentMessage[]): void {
    if (messages.length === 0) return

    // 获取该 session 下已有的 topic_id
    const firstRow = this.db.prepare(
      `SELECT topic_id FROM agent_messages WHERE nexus_session_id = ? LIMIT 1`
    ).get(nexusSessionId) as { topic_id: string } | undefined

    const topicId = firstRow?.topic_id || `topic_${Date.now()}`

    const tx = this.db.transaction(() => {
      // 删除该 session 的所有消息
      this.db.prepare(`DELETE FROM agent_messages WHERE nexus_session_id = ?`).run(nexusSessionId)

      // 插入压缩后的新消息
      const stmt = this.db.prepare(
        `INSERT INTO agent_messages
         (topic_id, nexus_session_id, turn_index, role, content,
          tool_calls, tool_call_id, tool_name, is_complete, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, strftime('%s', 'now'))`
      )

      let turnIndex = 0
      for (const msg of messages) {
        const content = typeof msg.content === 'string'
          ? msg.content
          : msg.content ? JSON.stringify(msg.content) : null

        const toolCalls = msg.tool_calls ? JSON.stringify(msg.tool_calls) : null
        const toolName = msg.name || null

        // tool 消息与前一条 assistant 消息共享同一 turn
        const currentTurn = msg.role === 'tool' ? turnIndex : turnIndex++

        stmt.run(
          topicId,
          nexusSessionId,
          currentTurn,
          msg.role,
          content,
          toolCalls,
          msg.tool_call_id || null,
          toolName,
        )
      }
    })

    tx()
    logger.info(`[AgentMessageDAO] 已替换 session ${nexusSessionId} 的全部消息，新消息数: ${messages.length}`)
  }

  // ==================== 内部方法 ====================

  /**
   * 将数据库行转换为 AgentMessage
   */
  private rowToMessage(row: AgentMessageRow): AgentMessage {
    let content: string | ContentBlock[] | null = row.content
    // 尝试解析 JSON（多模态消息）
    if (content && typeof content === 'string') {
      try {
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) {
          content = parsed as ContentBlock[]
        }
      } catch {
        // 不是 JSON，保持字符串
      }
    }

    let toolCalls: Array<{ id: string; name: string; arguments: string }> | undefined
    if (row.tool_calls) {
      try {
        toolCalls = JSON.parse(row.tool_calls)
      } catch {
        toolCalls = undefined
      }
    }

    return {
      role: row.role as 'user' | 'assistant' | 'tool' | 'system',
      content: content,
      tool_calls: toolCalls,
      tool_call_id: row.tool_call_id || undefined,
      name: row.tool_name || undefined,
      timestamp: row.created_at * 1000, // 秒转毫秒
    }
  }
}
