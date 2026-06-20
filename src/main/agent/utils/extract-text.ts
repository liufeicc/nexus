/**
 * 从消息内容中提取文本字符串
 *
 * @param content - 消息内容（字符串、ContentBlock 数组或 null）
 * @returns 提取后的纯文本
 */
import { ContentBlock } from '../../../core/types/agent'

export function extractText(content: string | ContentBlock[] | null): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  // 多模态内容：提取所有文本块
  const texts = content.filter(b => b.type === 'text').map(b => b.text || '')
  return texts.join('\n')
}
