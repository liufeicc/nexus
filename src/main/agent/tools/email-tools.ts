/**
 * 邮件工具 — 通过 IMAP/SMTP 协议实现邮件收发功能
 *
 * 实现 4 个工具：
 * - email_read: 读取收件箱邮件列表（摘要视图）
 * - email_view: 查看单封邮件完整内容
 * - email_send: 发送邮件（HTML/纯文本 + 附件）
 * - email_mark_read: 标记邮件为已读/未读
 *
 * 配置方式：系统启动时调用 configureEmail() 传入数据库中的 emailConfig 配置。
 * 未配置或未启用时，checkFn 返回 false，工具对 LLM 不可见。
 */

import fs from 'fs'
import path from 'path'
import { ImapFlow, ImapFlowOptions } from 'imapflow'
import nodemailer from 'nodemailer'
import { ToolDefinition, ToolResult } from '../../../core/types/agent'
import { logger } from '../../utils/logger'
import { isPathSafe } from './file-tools/path-safety'

/** 邮件账户配置 */
interface EmailAccountConfig {
  email: string
  appPassword: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  displayName?: string
}

/** 邮件工具配置（由系统启动时从数据库注入） */
let emailConfig: { enabled: boolean; account: EmailAccountConfig } | null = null

const MAX_EMAILS_LIST = 50
const MAX_LIST_CHARS = 30_000
const MAX_BODY_CHARS = 20_000
const MAX_ATTACHMENTS = 5
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024 // 25MB
const MAX_TOTAL_ATTACHMENT_SIZE = 50 * 1024 * 1024 // 50MB

/**
 * 配置邮件工具（系统启动时调用）
 */
export function configureEmail(config: { enabled: boolean; account: EmailAccountConfig } | null): void {
  emailConfig = config
}

/**
 * 检查 email 配置是否完整可用
 */
function isEmailConfigured(): boolean {
  if (!emailConfig || !emailConfig.enabled || !emailConfig.account) return false
  const a = emailConfig.account
  return !!(a.email && a.email.trim() && a.appPassword && a.imapHost && a.smtpHost)
}

/**
 * 构建 IMAP 连接配置
 */
function buildImapConfig(): ImapFlowOptions {
  const a = emailConfig!.account
  return {
    host: a.imapHost,
    port: a.imapPort || 993,
    secure: a.imapSecure !== false,
    auth: {
      user: a.email,
      pass: a.appPassword,
    },
    logger: false,
  }
}

/**
 * 安全执行 IMAP 操作：自动连接、执行、断开
 */
async function withImapClient<T>(op: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow(buildImapConfig())
  await client.connect()
  try {
    // 手动发送 ID 命令声明客户端身份
    // 部分服务器（如 163.com）不声明 ID 能力但强制要求，
    // imapflow 的 clientInfo 选项只会在服务器声明 ID 能力时自动发送
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any).exec('ID', [['name', 'Nexus'], ['version', '1.0']])
    } catch {
      // 不支持 ID 命令的服务器忽略
    }
    return await op(client)
  } finally {
    await client.logout().catch(() => {})
  }
}

/**
 * 将 IMAP 错误包装为友好的错误消息
 */
function wrapImapError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('authentication')) return '邮箱认证失败，请检查邮箱地址和授权码是否正确'
  if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) return '连接邮件服务器超时，请检查网络或服务器配置'
  if (msg.includes('ENOTFOUND')) return '无法解析邮件服务器地址，请检查服务器配置'
  if (msg.includes('ECONNREFUSED')) return '邮件服务器拒绝连接，请检查服务器地址和端口'
  return `IMAP 操作失败: ${msg}`
}

/**
 * 清理 HTML 内容：移除 script 标签和事件处理器
 */
function stripHtmlTags(html: string): string {
  if (!html) return ''
  let text = html
  // 移除 script 标签及其内容
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
  // 移除 style 标签
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
  // 移除所有 HTML 标签，只保留纯文本
  text = text.replace(/<[^>]+>/g, ' ')
  // 压缩空白
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

/**
 * 截断输出字符串，防止 context window 过大消耗
 */
function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n\n...[内容已截断，超出 ' + maxChars.toLocaleString() + ' 字符限制]'
}

/**
 * 验证邮箱地址格式是否合法
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/**
 * 解析逗号分隔的邮箱地址列表
 */
function parseEmailList(input: string): string[] {
  return input
    .split(/[;,]/)
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * 构建 SMTP 传输器
 */
function createSmtpTransport() {
  const a = emailConfig!.account
  return nodemailer.createTransport({
    host: a.smtpHost,
    port: a.smtpPort || 465,
    secure: a.smtpSecure !== false,
    auth: {
      user: a.email,
      pass: a.appPassword,
    },
  })
}

/**
 * 发送邮件（SMTP）
 */
async function sendEmail(args: {
  to: string[]
  subject: string
  text?: string
  html?: string
  cc?: string[]
  bcc?: string[]
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>
}): Promise<{ success: boolean; message?: string; error?: string }> {
  const transport = createSmtpTransport()
  try {
    const mailOptions: nodemailer.SendMailOptions = {
      from: emailConfig!.account.displayName
        ? `"${emailConfig!.account.displayName}" <${emailConfig!.account.email}>`
        : emailConfig!.account.email,
      to: args.to.join(', '),
      subject: args.subject.replace(/[\r\n]/g, ' ').trim(),
      text: args.text,
      html: args.html,
      cc: args.cc?.join(', '),
      bcc: args.bcc?.join(', '),
      attachments: args.attachments,
    }

    const info = await transport.sendMail(mailOptions)
    logger.info(`[EmailSend] 邮件发送成功: messageId=${info.messageId}`)
    return { success: true, message: `邮件已发送，Message-ID: ${info.messageId}` }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`[EmailSend] 发送失败: ${msg}`)
    return { success: false, error: `SMTP 发送失败: ${msg}` }
  } finally {
    transport.close()
  }
}

// ─── email_read 工具 ───────────────────────────────────────────

export const emailReadTool: ToolDefinition = {
  name: 'email_read',
  description: (
    '读取收件箱邮件列表，返回邮件摘要（发件人、主题、日期、已读状态、UID）。'
    + '适合先浏览有哪些邮件，再用 email_view 查看具体邮件详情。'
    + '需要先配置邮箱账户。'
  ),
  checkFn: isEmailConfigured,
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: '返回邮件数量，默认 10，最大 50',
      },
      unseen_only: {
        type: 'boolean',
        description: '是否仅返回未读邮件，默认 false',
      },
      mailbox: {
        type: 'string',
        description: '邮箱文件夹名称，默认 "INBOX"',
      },
    },
    required: [],
  },
  handler: async (args): Promise<ToolResult> => {
    if (!isEmailConfigured()) {
      return { success: false, output: '邮件工具未配置或未启用，请在设置中配置邮箱账户' }
    }

    const limit = typeof args.limit === 'number'
      ? Math.min(Math.max(1, Math.floor(args.limit)), MAX_EMAILS_LIST)
      : 10
    const unseenOnly = args.unseen_only === true
    const mailbox = typeof args.mailbox === 'string' && args.mailbox.trim() ? args.mailbox.trim() : 'INBOX'

    logger.info(`[EmailRead] 读取: mailbox=${mailbox}, limit=${limit}, unseen_only=${unseenOnly}`)

    try {
      const emails = await withImapClient(async (client) => {
        await client.mailboxOpen(mailbox, { readOnly: true })

        const searchQuery: Record<string, unknown> = unseenOnly ? { unseen: true } : {}
        const messages: Array<{ uid: number; from: string; subject: string; date: Date; seen: boolean }> = []

        for await (const message of client.fetch(searchQuery, {
          uid: true,
          envelope: true,
          flags: true,
          source: false,
        })) {
          const envelope = message.envelope
          const from = envelope?.from?.[0]?.address || '未知发件人'
          const subject = envelope?.subject || '(无主题)'
          const date = envelope?.date || new Date()
          const seen = message.flags?.has('\\Seen') ?? true

          messages.push({ uid: message.uid, from, subject, date, seen })
          if (messages.length >= limit) break
        }

        return messages.reverse() // 最新的在前
      })

      if (emails.length === 0) {
        return {
          success: true,
          output: unseenOnly ? '收件箱中没有未读邮件' : '收件箱为空',
          data: { mailbox, emails: [] },
        }
      }

      const output = emails.map((m, i) => {
        const status = m.seen ? '已读' : '未读'
        const dateStr = formatDate(m.date)
        return `${i + 1}. [UID: ${m.uid}] [${status}] ${dateStr}\n   发件人: ${m.from}\n   主题: ${m.subject}`
      }).join('\n\n')

      return {
        success: true,
        output: truncateOutput(`收件箱邮件列表 (${emails.length} 封):\n\n${output}`, MAX_LIST_CHARS),
        data: { mailbox, emails },
      }
    } catch (err: unknown) {
      logger.error(`[EmailRead] 失败: ${err}`)
      return { success: false, output: wrapImapError(err) }
    }
  },
}

// ─── email_view 工具 ──────────────────────────────────────────

export const emailViewTool: ToolDefinition = {
  name: 'email_view',
  description: (
    '查看单封邮件的完整内容，包括正文和附件元数据。'
    + '需要先用 email_read 获取邮件 UID。'
    + '直接返回邮件正文，适合阅读详细内容。'
  ),
  checkFn: isEmailConfigured,
  parameters: {
    type: 'object',
    properties: {
      uid: {
        type: 'string',
        description: '邮件 UID（从 email_read 获取）',
      },
      mailbox: {
        type: 'string',
        description: '邮箱文件夹名称，默认 "INBOX"',
      },
      prefer_html: {
        type: 'boolean',
        description: '优先返回 HTML 正文，默认 true',
      },
      max_body_chars: {
        type: 'number',
        description: '正文最大字符数，默认 20000',
      },
    },
    required: ['uid'],
  },
  handler: async (args): Promise<ToolResult> => {
    if (!isEmailConfigured()) {
      return { success: false, output: '邮件工具未配置或未启用，请在设置中配置邮箱账户' }
    }

    const uid = typeof args.uid === 'string' ? parseInt(args.uid, 10) : NaN
    if (isNaN(uid) || uid <= 0) {
      return { success: false, output: '无效的 UID，请提供正整数' }
    }

    const mailbox = typeof args.mailbox === 'string' && args.mailbox.trim() ? args.mailbox.trim() : 'INBOX'
    const preferHtml = args.prefer_html !== false
    const maxChars = typeof args.max_body_chars === 'number' ? Math.max(1000, args.max_body_chars) : MAX_BODY_CHARS

    logger.info(`[EmailView] 查看: uid=${uid}, mailbox=${mailbox}`)

    try {
      const result = await withImapClient(async (client) => {
        await client.mailboxOpen(mailbox, { readOnly: true })

        // 先获取信封和邮件结构
        const message = await client.fetchOne(uid, {
          uid: true,
          envelope: true,
          bodyStructure: true,
        })

        if (!message) {
          throw new Error('Message not found')
        }

        const envelope = message.envelope
        const from = formatAddresses(envelope?.from)
        const to = formatAddresses(envelope?.to)
        const cc = envelope?.cc ? formatAddresses(envelope.cc) : ''
        const subject = envelope?.subject || '(无主题)'
        const date = envelope?.date ? formatDate(envelope.date) : '未知日期'

        // 从 bodyStructure 找到文本/HTML 部分
        const bodyParts: string[] = []
        const attachments: Array<{ filename: string; mimeType: string; size: string }> = []
        findBodyParts(message.bodyStructure, '', bodyParts, attachments, preferHtml)

        // 如果有正文部分，获取它们
        let body = ''
        let bodyType = ''
        if (bodyParts.length > 0) {
          const fetched = await client.fetchOne(uid, {
            bodyParts: bodyParts.map(bp => ({ key: bp })),
          })

          if (fetched && fetched.bodyParts) {
            // 按优先级选取正文（优先 HTML，其次纯文本）
            for (const [partKey, buffer] of fetched.bodyParts) {
              const text = buffer.toString('utf-8')
              if (!body) {
                if (partKey.endsWith('.html') || bodyParts.find(bp => bp === partKey && partKey.includes('text/html'))) {
                  body = stripHtmlTags(text)
                  bodyType = 'HTML'
                } else {
                  body = text
                  bodyType = '纯文本'
                }
              }
            }
          }
        }

        if (!body) {
          body = '(邮件内容为空)'
          bodyType = '纯文本'
        }

        body = truncateOutput(body, maxChars)

        return { from, to, cc, subject, date, body, bodyType, attachments }
      })

      let output = `发件人: ${result.from}\n`
      output += `收件人: ${result.to}\n`
      if (result.cc) output += `抄送: ${result.cc}\n`
      output += `主题: ${result.subject}\n`
      output += `日期: ${result.date}\n`
      output += `--- 正文 (${result.bodyType}) ---\n\n`
      output += result.body

      if (result.attachments.length > 0) {
        output += '\n\n--- 附件 ---\n'
        for (const att of result.attachments) {
          output += `- ${att.filename} (${att.mimeType}, ${att.size})\n`
        }
      }

      return {
        success: true,
        output,
        data: { uid, subject: result.subject, from: result.from, attachments: result.attachments },
      }
    } catch (err: unknown) {
      logger.error(`[EmailView] 失败: ${err}`)
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('NOT FOUND') || msg.includes('No messages')) {
        return { success: false, output: `未找到 UID 为 ${uid} 的邮件，该邮件可能已被移动或删除` }
      }
      return { success: false, output: wrapImapError(err) }
    }
  },
}

// ─── email_send 工具 ──────────────────────────────────────────

export const emailSendTool: ToolDefinition = {
  name: 'email_send',
  description: (
    '发送电子邮件。支持纯文本或 HTML 正文，可添加文件附件。'
    + '需要提供收件人地址和邮件主题。'
    + '多个收件人、抄送、密送地址用逗号分隔。'
  ),
  checkFn: isEmailConfigured,
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: '收件人邮箱地址（多个用逗号分隔）',
      },
      subject: {
        type: 'string',
        description: '邮件主题',
      },
      body: {
        type: 'string',
        description: '邮件正文（纯文本）',
      },
      html: {
        type: 'string',
        description: '邮件正文（HTML 格式）',
      },
      cc: {
        type: 'string',
        description: '抄送地址（多个用逗号分隔），可选',
      },
      bcc: {
        type: 'string',
        description: '密送地址（多个用逗号分隔），可选',
      },
      attachments: {
        type: 'array',
        description: '附件本地文件路径列表，可选',
        items: {
          type: 'string',
          description: '附件的本地文件路径',
        },
      },
    },
    required: ['to', 'subject'],
  },
  handler: async (args): Promise<ToolResult> => {
    if (!isEmailConfigured()) {
      return { success: false, output: '邮件工具未配置或未启用，请在设置中配置邮箱账户' }
    }

    const toStr = typeof args.to === 'string' ? args.to.trim() : ''
    const subject = typeof args.subject === 'string' ? args.subject.trim() : ''
    const body = typeof args.body === 'string' ? args.body : undefined
    const html = typeof args.html === 'string' ? args.html : undefined
    const ccStr = typeof args.cc === 'string' ? args.cc.trim() : undefined
    const bccStr = typeof args.bcc === 'string' ? args.bcc.trim() : undefined
    const attPaths = Array.isArray(args.attachments) ? args.attachments.map(String).filter(Boolean) : []

    if (!toStr) {
      return { success: false, output: '收件人地址不能为空' }
    }
    if (!subject) {
      return { success: false, output: '邮件主题不能为空' }
    }
    if (!body && !html) {
      return { success: false, output: '请提供邮件正文（body 或 html 至少一个）' }
    }

    const toList = parseEmailList(toStr)
    for (const addr of toList) {
      if (!isValidEmail(addr)) {
        return { success: false, output: `无效的收件人地址: ${addr}` }
      }
    }

    const ccList = ccStr ? parseEmailList(ccStr).filter(isValidEmail) : []
    const bccList = bccStr ? parseEmailList(bccStr).filter(isValidEmail) : []

    if (ccStr && ccList.length === 0 && ccStr.trim()) {
      return { success: false, output: '抄送地址格式无效' }
    }
    if (bccStr && bccList.length === 0 && bccStr.trim()) {
      return { success: false, output: '密送地址格式无效' }
    }

    // 附件处理
    const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = []
    if (attPaths.length > MAX_ATTACHMENTS) {
      return { success: false, output: `附件数量 (${attPaths.length}) 超过限制，最多 ${MAX_ATTACHMENTS} 个` }
    }

    let totalSize = 0
    for (const filePath of attPaths) {
      const safety = isPathSafe(filePath)
      if (!safety.safe) {
        return { success: false, output: `附件路径不安全: ${filePath} — ${safety.reason}` }
      }

      if (!fs.existsSync(filePath)) {
        return { success: false, output: `附件文件不存在: ${filePath}` }
      }

      const stats = fs.statSync(filePath)
      if (stats.size > MAX_ATTACHMENT_SIZE) {
        return { success: false, output: `附件文件过大: ${filePath} (${formatFileSize(stats.size)}，单文件限制 25MB)` }
      }

      totalSize += stats.size
      if (totalSize > MAX_TOTAL_ATTACHMENT_SIZE) {
        return { success: false, output: `附件总大小 (${formatFileSize(totalSize)}) 超过 50MB 限制` }
      }

      const content = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const contentType = getMimeType(ext)

      attachments.push({
        filename: path.basename(filePath),
        content,
        contentType,
      })
    }

    logger.info(`[EmailSend] 发送: to=${toStr}, subject=${subject}, attachments=${attachments.length}`)

    const sendResult = await sendEmail({
      to: toList,
      subject,
      text: body,
      html,
      cc: ccList,
      bcc: bccList,
      attachments,
    })

    if (!sendResult.success) {
      return { success: false, output: sendResult.error || '发送失败' }
    }

    const summary = `邮件发送成功\n收件人: ${toList.join(', ')}${ccList.length ? '\n抄送: ' + ccList.join(', ') : ''}${bccList.length ? '\n密送: ' + bccList.length + ' 个地址' : ''}\n主题: ${subject}\n${sendResult.message || ''}${attachments.length ? `\n附件: ${attachments.map(a => a.filename).join(', ')}` : ''}`

    return { success: true, output: summary, data: { to: toList, subject } }
  },
}

// ─── email_mark_read 工具 ─────────────────────────────────────

export const emailMarkReadTool: ToolDefinition = {
  name: 'email_mark_read',
  description: (
    '标记邮件为已读或未读。通过 UID 指定邮件。'
    + '可以一次标记多封邮件。'
  ),
  checkFn: isEmailConfigured,
  parameters: {
    type: 'object',
    properties: {
      uids: {
        type: 'array',
        description: '要标记的邮件 UID 列表',
        items: {
          type: 'string',
          description: '单个邮件 UID',
        },
      },
      uid: {
        type: 'string',
        description: '单个邮件 UID',
      },
      seen: {
        type: 'boolean',
        description: 'true=已读, false=未读, 默认 true',
      },
      mailbox: {
        type: 'string',
        description: '邮箱文件夹名称，默认 "INBOX"',
      },
    },
    required: [],
  },
  handler: async (args): Promise<ToolResult> => {
    if (!isEmailConfigured()) {
      return { success: false, output: '邮件工具未配置或未启用，请在设置中配置邮箱账户' }
    }

    const uidList: number[] = []

    if (Array.isArray(args.uids)) {
      for (const u of args.uids) {
        const n = parseInt(String(u), 10)
        if (isNaN(n) || n <= 0) {
          return { success: false, output: `无效的 UID: ${u}` }
        }
        uidList.push(n)
      }
    } else if (args.uid) {
      const n = parseInt(String(args.uid), 10)
      if (isNaN(n) || n <= 0) {
        return { success: false, output: `无效的 UID: ${args.uid}` }
      }
      uidList.push(n)
    }

    if (uidList.length === 0) {
      return { success: false, output: '请提供 uid 或 uids 参数' }
    }

    const seen = args.seen !== false
    const mailbox = typeof args.mailbox === 'string' && args.mailbox.trim() ? args.mailbox.trim() : 'INBOX'
    const flag = seen ? '已读' : '未读'

    logger.info(`[EmailMark] 标记: uids=[${uidList.join(',')}], seen=${seen}, mailbox=${mailbox}`)

    try {
      await withImapClient(async (client) => {
        await client.mailboxOpen(mailbox)
        for (const uid of uidList) {
          if (seen) {
            await client.messageFlagsAdd({ uid }, ['\\Seen'])
          } else {
            await client.messageFlagsRemove({ uid }, ['\\Seen'])
          }
        }
      })

      return {
        success: true,
        output: `已将 ${uidList.length} 封邮件标记为${flag}`,
        data: { uids: uidList, seen },
      }
    } catch (err: unknown) {
      logger.error(`[EmailMark] 失败: ${err}`)
      return { success: false, output: wrapImapError(err) }
    }
  },
}

// ─── 辅助函数 ─────────────────────────────────────────────────

/**
 * 从 IMAP bodyStructure 中递归查找文本/HTML 正文部分和附件
 * @param node 结构节点
 * @param prefix 父节点编号前缀（如 "1."）
 * @param bodyParts 收集到的正文部分编号
 * @param attachments 收集到的附件信息
 * @param preferHtml 是否优先 HTML
 */
function findBodyParts(
  node: import('imapflow').MessageStructureObject | undefined,
  prefix: string,
  bodyParts: string[],
  attachments: Array<{ filename: string; mimeType: string; size: string }>,
  preferHtml: boolean,
): void {
  if (!node) return

  // 判断是否为正文部分（text/plain 或 text/html，且无 disposition）
  if (node.type.startsWith('text/') && !node.disposition) {
    const partNum = prefix || '1'
    // 如果偏好 HTML，优先收集 text/html；否则收集 text/plain
    if (preferHtml && node.type === 'text/html') {
      bodyParts.push(partNum)
    } else if (!preferHtml && node.type === 'text/plain') {
      bodyParts.push(partNum)
    } else if (bodyParts.length === 0) {
      // 作为后备，收集第一个找到的文本部分
      bodyParts.push(partNum)
    }
  }

  // 判断是否为附件（有 Content-Disposition: attachment/inline 且有文件名）
  if (node.disposition && (node.disposition.toLowerCase() === 'attachment' || node.disposition.toLowerCase() === 'inline')) {
    const filename = node.parameters?.name
      || node.dispositionParameters?.filename
      || (node.type === 'application/octet-stream' ? 'unnamed' : undefined)
    if (filename) {
      attachments.push({
        filename,
        mimeType: node.type || 'application/octet-stream',
        size: formatFileSize(node.size || 0),
      })
    }
  }

  // 递归处理子节点
  if (node.childNodes && node.childNodes.length > 0) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const childPart = prefix ? `${prefix}.${i + 1}` : String(i + 1)
      findBodyParts(node.childNodes[i], childPart, bodyParts, attachments, preferHtml)
    }
  }
}

/**
 * 格式化日期
 */
function formatDate(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 7) return `${days} 天前`

  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 格式化地址列表（从 ImapFlow 的 envelope address 格式）
 */
function formatAddresses(addrs: Array<{ name?: string; address?: string }> | undefined): string {
  if (!addrs || addrs.length === 0) return '未知'
  return addrs.map(a => {
    const name = a.name || ''
    const addr = a.address || ''
    return name ? `${name} <${addr}>` : addr
  }).join(', ')
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

/**
 * 根据文件扩展名猜测 MIME 类型
 */
function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
  }
  return map[ext] || 'application/octet-stream'
}
