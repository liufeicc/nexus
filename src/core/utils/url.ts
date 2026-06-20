/**
 * URL 处理工具
 */

/**
 * 将用户输入字符串转换为可导航的 URL。
 * 规则：
 * - 已有 http/https/file/about 协议前缀 → 原样返回
 * - localhost 或 IP 地址（如 "localhost:3000"、"127.0.0.1:8080"）→ 补 http:// 前缀
 * - 包含 "." 且不包含空格（如 "github.com"）→ 补 https:// 前缀
 * - 其他情况（如 "react hooks"）→ 转为 Google 搜索 URL
 *
 * @param input - 用户输入的 URL 或搜索关键词
 * @returns 可导航的完整 URL
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('file://') ||
    trimmed.startsWith('about:')
  ) {
    return trimmed
  }

  // localhost 或 IP 地址（如 "localhost:3000"、"127.0.0.1:8080"、"::1"）
  const localhostPattern = /^(localhost|\[::1\]|(\d{1,3}\.){3}\d{1,3})(:\d+)?$/
  if (localhostPattern.test(trimmed)) {
    return 'http://' + trimmed
  }

  // 看起来像域名（包含 "." 且不含空格）
  if (trimmed.includes('.') && !trimmed.includes(' ')) {
    return 'https://' + trimmed
  }

  // 否则作为搜索关键词
  return 'https://www.google.com/search?q=' + encodeURIComponent(trimmed)
}
