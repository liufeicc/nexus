/**
 * AgentMessageDAO 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { AgentMessageDAO } from '../../src/main/db/agent-message.dao'
import { SessionDAO } from '../../src/main/db/session.dao'
import { createTestDatabase, cleanupDatabase } from '../setup'
import type { AgentMessage } from '../../src/core/types/agent'

// Mock logger
vi.mock('../../src/main/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('AgentMessageDAO', () => {
  let db: Database.Database
  let dao: AgentMessageDAO
  let sessionDao: SessionDAO

  beforeEach(() => {
    db = createTestDatabase()
    dao = new AgentMessageDAO(db)
    sessionDao = new SessionDAO(db)
  })

  afterEach(() => {
    cleanupDatabase(db)
  })

  describe('saveMessage', () => {
    it('should save a user message', () => {
      const session = sessionDao.create('test')
      const topicId = 'topic-1'
      const message: AgentMessage = {
        role: 'user',
        content: 'Hello, agent!',
      }

      dao.saveMessage(topicId, session.id, message, 0)

      const messages = dao.loadByTopic(topicId, session.id)
      expect(messages).toHaveLength(1)
      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('Hello, agent!')
    })

    it('should save an assistant message', () => {
      const session = sessionDao.create('test')
      const topicId = 'topic-1'
      const message: AgentMessage = {
        role: 'assistant',
        content: 'I can help you with that.',
      }

      dao.saveMessage(topicId, session.id, message, 1)

      const messages = dao.loadByTopic(topicId, session.id)
      expect(messages).toHaveLength(1)
      expect(messages[0].role).toBe('assistant')
    })

    it('should save tool call message', () => {
      const session = sessionDao.create('test')
      const topicId = 'topic-1'
      const message: AgentMessage = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            name: 'read_file',
            arguments: '{"path": "/test.txt"}',
          },
        ],
      }

      dao.saveMessage(topicId, session.id, message, 2)

      const messages = dao.loadByTopic(topicId, session.id)
      expect(messages[0].tool_calls).toHaveLength(1)
      expect(messages[0].tool_calls![0].name).toBe('read_file')
    })

    it('should save tool result message', () => {
      const session = sessionDao.create('test')
      const topicId = 'topic-1'
      const message: AgentMessage = {
        role: 'tool',
        tool_call_id: 'call-1',
        name: 'read_file',
        content: 'File content here',
      }

      dao.saveMessage(topicId, session.id, message, 3)

      const messages = dao.loadByTopic(topicId, session.id)
      expect(messages[0].role).toBe('tool')
      expect(messages[0].tool_call_id).toBe('call-1')
      expect(messages[0].name).toBe('read_file')
    })
  })

  describe('loadByTopic', () => {
    it('should return empty array when no messages', () => {
      const session = sessionDao.create('test')
      expect(dao.loadByTopic('nonexistent', session.id)).toEqual([])
    })

    it('should filter by topic and session', () => {
      const s1 = sessionDao.create('session1')
      const s2 = sessionDao.create('session2')

      dao.saveMessage('topic-1', s1.id, { role: 'user', content: 'S1-T1' }, 0)
      dao.saveMessage('topic-2', s1.id, { role: 'user', content: 'S1-T2' }, 0)
      dao.saveMessage('topic-1', s2.id, { role: 'user', content: 'S2-T1' }, 0)

      const messages = dao.loadByTopic('topic-1', s1.id)
      expect(messages).toHaveLength(1)
      expect(messages[0].content).toBe('S1-T1')
    })

    it('should order by turnIndex ASC', () => {
      const session = sessionDao.create('test')
      const topicId = 'topic-1'

      dao.saveMessage(topicId, session.id, { role: 'assistant', content: 'Turn 2' }, 2)
      dao.saveMessage(topicId, session.id, { role: 'user', content: 'Turn 0' }, 0)
      dao.saveMessage(topicId, session.id, { role: 'assistant', content: 'Turn 1' }, 1)

      const messages = dao.loadByTopic(topicId, session.id)
      expect(messages[0].content).toBe('Turn 0')
      expect(messages[1].content).toBe('Turn 1')
      expect(messages[2].content).toBe('Turn 2')
    })
  })

  describe('listTopics', () => {
    it('should return empty array when no topics', () => {
      const session = sessionDao.create('test')
      expect(dao.listTopics(session.id)).toEqual([])
    })

    it('should return topic summaries with message count', () => {
      const session = sessionDao.create('test')

      dao.saveMessage('topic-1', session.id, { role: 'user', content: 'T1-M1' }, 0)
      dao.saveMessage('topic-1', session.id, { role: 'assistant', content: 'T1-M2' }, 1)
      dao.saveMessage('topic-2', session.id, { role: 'user', content: 'T2-M1' }, 0)

      const topics = dao.listTopics(session.id)
      expect(topics).toHaveLength(2)
      
      const t1 = topics.find(t => t.topicId === 'topic-1')
      expect(t1).toBeDefined()
      expect(t1!.messageCount).toBe(2)

      const t2 = topics.find(t => t.topicId === 'topic-2')
      expect(t2).toBeDefined()
      expect(t2!.messageCount).toBe(1)
    })
  })

  describe('loadLatestTopic', () => {
    it('should return null when no messages', () => {
      const session = sessionDao.create('test')
      expect(dao.loadLatestTopic(session.id)).toBeNull()
    })

    it('should return the latest topic history', () => {
      const session = sessionDao.create('test')

      dao.saveMessage('old-topic', session.id, { role: 'user', content: 'Old' }, 0)
      dao.saveMessage('new-topic', session.id, { role: 'user', content: 'New' }, 0)

      const latest = dao.loadLatestTopic(session.id)
      expect(latest).not.toBeNull()
      expect(latest!.topicId).toBeDefined()
      expect(latest!.messages.length).toBeGreaterThan(0)
    })
  })

  describe('getNextTurnIndex', () => {
    it('should return 0 when no messages', () => {
      const session = sessionDao.create('test')
      expect(dao.getNextTurnIndex('topic-1', session.id)).toBe(0)
    })

    it('should return max turn_index + 1', () => {
      const session = sessionDao.create('test')
      const topicId = 'topic-1'

      dao.saveMessage(topicId, session.id, { role: 'user', content: 'M0' }, 0)
      dao.saveMessage(topicId, session.id, { role: 'assistant', content: 'M1' }, 1)
      dao.saveMessage(topicId, session.id, { role: 'user', content: 'M2' }, 2)

      expect(dao.getNextTurnIndex(topicId, session.id)).toBe(3)
    })
  })

  describe('markTurnComplete', () => {
    it('should mark messages in a turn as complete', () => {
      const session = sessionDao.create('test')
      const topicId = 'topic-1'

      dao.saveMessage(topicId, session.id, { role: 'user', content: 'Q' }, 0)
      dao.saveMessage(topicId, session.id, { role: 'assistant', content: 'A' }, 0)

      dao.markTurnComplete(topicId, 0, session.id)

      // Verify by checking database directly
      const rows = db.prepare(
        'SELECT is_complete FROM agent_messages WHERE topic_id = ? AND nexus_session_id = ?'
      ).all(topicId, session.id) as Array<{ is_complete: number }>

      expect(rows.every(r => r.is_complete === 1)).toBe(true)
    })
  })

  describe('deleteByTopic', () => {
    it('should delete all messages for a topic', () => {
      const session = sessionDao.create('test')
      const topicId = 'topic-1'

      dao.saveMessage(topicId, session.id, { role: 'user', content: 'M1' }, 0)
      dao.saveMessage(topicId, session.id, { role: 'assistant', content: 'M2' }, 1)

      dao.deleteByTopic(topicId, session.id)
      expect(dao.loadByTopic(topicId, session.id)).toEqual([])
    })

    it('should not affect other topics', () => {
      const session = sessionDao.create('test')
      
      dao.saveMessage('keep', session.id, { role: 'user', content: 'Keep' }, 0)
      dao.saveMessage('delete', session.id, { role: 'user', content: 'Delete' }, 0)

      dao.deleteByTopic('delete', session.id)
      
      expect(dao.loadByTopic('keep', session.id)).toHaveLength(1)
      expect(dao.loadByTopic('delete', session.id)).toHaveLength(0)
    })
  })

  describe('deleteAllBySessionId', () => {
    it('should delete all messages for a session', () => {
      const session = sessionDao.create('test')
      
      dao.saveMessage('topic-1', session.id, { role: 'user', content: 'T1' }, 0)
      dao.saveMessage('topic-2', session.id, { role: 'user', content: 'T2' }, 0)

      dao.deleteAllBySessionId(session.id)
      expect(dao.listTopics(session.id)).toEqual([])
    })

    it('should not affect other sessions', () => {
      const s1 = sessionDao.create('session1')
      const s2 = sessionDao.create('session2')

      dao.saveMessage('topic', s1.id, { role: 'user', content: 'S1' }, 0)
      dao.saveMessage('topic', s2.id, { role: 'user', content: 'S2' }, 0)

      dao.deleteAllBySessionId(s1.id)
      
      expect(dao.listTopics(s1.id)).toEqual([])
      expect(dao.listTopics(s2.id)).toHaveLength(1)
    })
  })

  describe('message content parsing', () => {
    it('should parse JSON array content as ContentBlock array', () => {
      const session = sessionDao.create('test')
      const topicId = 'topic-1'
      const jsonContent = JSON.stringify([
        { type: 'text', text: 'Hello' },
        { type: 'image', image: { data: 'base64', mimeType: 'image/png' } },
      ])

      db.prepare(`
        INSERT INTO agent_messages (nexus_session_id, topic_id, turn_index, role, content, created_at)
        VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
      `).run(session.id, topicId, 0, 'user', jsonContent)

      const messages = dao.loadByTopic(topicId, session.id)
      expect(Array.isArray(messages[0].content)).toBe(true)
      expect((messages[0].content as any[])[0].type).toBe('text')
    })

    it('should keep string content as string', () => {
      const session = sessionDao.create('test')
      const topicId = 'topic-1'

      dao.saveMessage(topicId, session.id, { role: 'user', content: 'Plain text' }, 0)

      const messages = dao.loadByTopic(topicId, session.id)
      expect(messages[0].content).toBe('Plain text')
    })
  })

  describe('replaceTopicMessages', () => {
    it('should replace all messages in a topic', () => {
      const session = sessionDao.create('test')
      const topicId = 'topic-1'

      dao.saveMessage(topicId, session.id, { role: 'user', content: 'Old1' }, 0)
      dao.saveMessage(topicId, session.id, { role: 'assistant', content: 'Old2' }, 1)

      const newMessages: AgentMessage[] = [
        { role: 'user', content: 'New1' },
        { role: 'assistant', content: 'New2' },
      ]

      dao.replaceTopicMessages(topicId, session.id, newMessages)

      const messages = dao.loadByTopic(topicId, session.id)
      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe('New1')
      expect(messages[1].content).toBe('New2')
    })
  })
})
