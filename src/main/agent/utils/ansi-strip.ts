/**
 * ANSI 转义序列清理
 *
 * 用于去除终端输出中的 ANSI 颜色代码、光标控制等转义序列。
 */

/**
 * 快速路径检测：如果文本中不含 ESC 字节或 C1 控制字节，跳过正则
 */
const HAS_ESCAPE = /[\x1b\x80-\x9f]/

/**
 * 完整 ANSI 转义匹配正则
 *
 * 覆盖以下序列类型：
 * - CSI 序列：\x1b[...X（含 ? 前缀、冒号参数、中间字节）
 * - OSC 序列：\x1b]...BEL 或 \x1b]...\x1b\\
 * - DCS/SOS/PM/APC 字符串
 * - nF 多字节转义 / Fp/Fe/Fs 单字节转义
 * - 8-bit CSI 和 OSC
 * - 其他 8-bit C1 控制字符
 */
const ANSI_ESCAPE_RE = /\x1b(?:\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|\][\s\S]*?(?:\x07|\x1b\\)|[PX^_][\s\S]*?(?:\x1b\\)|[\x20-\x2f]+[\x30-\x7e]|[\x30-\x7e])|\x9b[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|\x9d[\s\S]*?(?:\x07|\x9c)|[\x80-\x9f]/gs

/**
 * 去除文本中的 ANSI 转义序列
 *
 * @param text - 可能包含 ANSI 转义序列的文本
 * @returns 清理后的纯文本
 */
export function stripAnsi(text: string): string {
  if (!text || !HAS_ESCAPE.test(text)) {
    return text // fast path：不含转义字节，直接返回
  }
  return text.replace(ANSI_ESCAPE_RE, '')
}
