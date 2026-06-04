/**
 * 网络搜索工具
 *
 * 实现两个工具：
 * - web_search: 默认使用必应搜索（HTML 解析），国内可用；也支持 DuckDuckGo
 * - web_extract: 从指定 URL 提取网页正文内容（自建 HTML 提取器）
 */

import dns from 'dns'
import { search as ddgSearchFn, SearchResults, SafeSearchType } from 'duck-duck-scrape'
import { ToolDefinition, ToolResult } from '../../../core/types/agent'
import { logger } from '../../utils/logger'

const MAX_SEARCH_RESULTS = 10
const MAX_EXTRACT_URLS = 10
const MAX_CONTENT_CHARS = 100_000

/**
 * 检查 IP 是否为内网/本地地址
 */
function isPrivateIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::' || ip === '0.0.0.0') {
    return true
  }
  if (ip.startsWith('169.254.')) return true
  if (/^10\./.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true
  return false
}

/**
 * DNS 预解析，检查解析后的 IP 是否为内网地址
 */
async function checkDnsRebinding(hostname: string): Promise<{ safe: boolean; reason?: string }> {
  try {
    const addresses = await dns.promises.resolve4(hostname)
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        logger.warn(`[WebSSRF] DNS 解析 ${hostname} → ${addr}（内网地址），已拒绝`)
        return { safe: false, reason: `DNS 解析到内网地址 ${addr}，不允许访问` }
      }
    }
  } catch (err: any) {
    try {
      const v6 = await dns.promises.resolve6(hostname)
      for (const addr of v6) {
        if (isPrivateIp(addr)) {
          logger.warn(`[WebSSRF] DNS 解析 ${hostname} → ${addr}（内网地址），已拒绝`)
          return { safe: false, reason: `DNS 解析到内网地址 ${addr}，不允许访问` }
        }
      }
    } catch {
      logger.warn(`[WebSSRF] DNS 解析 ${hostname} 失败，拒绝访问`)
      return { safe: false, reason: `DNS 解析失败，无法确认地址安全性` }
    }
  }
  return { safe: true }
}

/**
 * SSRF 保护：检查 URL 是否安全（非内网、非本地、不含密钥）
 */
async function isSafeUrl(urlString: string): Promise<{ safe: boolean; reason?: string }> {
  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    return { safe: false, reason: '无效的 URL' }
  }

  const hostname = parsed.hostname.toLowerCase()

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return { safe: false, reason: '不允许访问本地地址' }
  }
  if (hostname.startsWith('169.254.')) {
    return { safe: false, reason: '不允许访问链路本地地址' }
  }
  if (/^10\./.test(hostname)) {
    return { safe: false, reason: '不允许访问私有网络地址' }
  }
  if (/^192\.168\./.test(hostname)) {
    return { safe: false, reason: '不允许访问私有网络地址' }
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
    return { safe: false, reason: '不允许访问私有网络地址' }
  }

  const secretPatterns = ['api_key=', 'api-key=', 'token=', 'secret=', 'password=', 'access_key=', 'auth_token=']
  const lowerUrl = urlString.toLowerCase()
  for (const pat of secretPatterns) {
    if (lowerUrl.includes(pat)) {
      return { safe: false, reason: 'URL 包含敏感信息' }
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: '仅支持 http/https 协议' }
  }

  const dnsCheck = await checkDnsRebinding(hostname)
  if (!dnsCheck.safe) {
    return dnsCheck
  }

  return { safe: true }
}

/**
 * 调用 DuckDuckGo 搜索（duck-duck-scrape，纯 HTTP，无 Puppeteer）
 */
async function ddgSearch(query: string, maxResults: number): Promise<{
  success: boolean
  data?: Array<{ title: string; url: string; description: string; position: number }>
  error?: string
}> {
  try {
    const response: SearchResults = await ddgSearchFn(query, {
      safeSearch: SafeSearchType.MODERATE,
    })

    if (!response.results || response.results.length === 0) {
      return { success: true, data: [] }
    }

    const data = response.results.slice(0, maxResults).map((r, i) => ({
      title: r.title || '',
      url: r.url || '',
      description: (r.description || '').slice(0, 500),
      position: i + 1,
    }))

    return { success: true, data }
  } catch (err: any) {
    return {
      success: false,
      error: `DuckDuckGo 搜索异常: ${err?.message || String(err)}`,
    }
  }
}

/**
 * 必应搜索（HTML 解析）
 * 参考 SearXNG bing.py 的选择器
 */
async function bingSearch(query: string, maxResults: number): Promise<{
  success: boolean
  data?: Array<{ title: string; url: string; description: string; position: number }>
  error?: string
}> {
  try {
    const encodedQuery = encodeURIComponent(query)
    const searchUrl = `https://www.bing.com/search?q=${encodedQuery}&count=${maxResults}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })

    clearTimeout(timeout)

    if (!response.ok) {
      return { success: false, error: `必应请求失败: HTTP ${response.status}` }
    }

    const html = await response.text()
    const results = parseBingResults(html).slice(0, maxResults)

    return { success: true, data: results.map((r, i) => ({ ...r, position: i + 1 })) }
  } catch (err: any) {
    if (err?.name === 'AbortError') return { success: false, error: '必应超时' }
    return { success: false, error: `必应异常: ${err.message}` }
  }
}

/**
 * 解析必应搜索结果 HTML
 * 结构：b_results > li.b_algo > h2 > a + p
 */
function parseBingResults(html: string): Array<{ title: string; url: string; description: string }> {
  const results: Array<{ title: string; url: string; description: string }> = []
  const containerMatch = html.match(/<ol[^>]*id="b_results"[^>]*>([\s\S]*?)<\/ol>/)
  if (!containerMatch) return results

  const container = containerMatch[1]

  // 提取每个 b_algo 块
  const liRegex = /<li\s+[^>]*class="[^"]*b_algo[^"]*"[^>]*>/gi
  let startMatch

  while ((startMatch = liRegex.exec(container)) !== null) {
    if (results.length >= 10) break

    // 找到对应的 </li>（处理嵌套）
    let pos = startMatch.index + startMatch[0].length
    let depth = 1
    let endPos = -1

    while (depth > 0 && pos < container.length) {
      const nextOpen = container.indexOf('<li', pos)
      const nextClose = container.indexOf('</li>', pos)
      if (nextClose === -1) break
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++; pos = nextOpen + 3
      } else {
        depth--
        if (depth === 0) endPos = nextClose + 5
        pos = nextClose + 5
      }
    }

    if (endPos === -1) continue
    const block = container.slice(startMatch.index, endPos)

    // 提取 h2 > a（h2 可能有 class 等属性）
    const h2Match = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i)
    if (!h2Match) continue

    let url = h2Match[1]
    const title = unescapeHtmlEntities(h2Match[2].replace(/<[^>]+>/g, '').trim())
    if (!title) continue

    // 处理 bing.com/ck/a 跳转链接（base64url 解码）
    if (url.includes('bing.com/ck/a?')) {
      const uMatch = url.match(/[?&]u=([^&]+)/)
      if (uMatch) {
        try {
          let encoded = decodeURIComponent(uMatch[1])
          if (encoded.startsWith('a1')) {
            encoded = encoded.slice(2)
            encoded += '='.repeat((-encoded.length % 4))
            url = Buffer.from(encoded, 'base64url').toString('utf-8')
          }
        } catch {}
      }
    }

    // 提取 <p> 摘要
    let description = ''
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi
    let pMatch
    while ((pMatch = pRegex.exec(block)) !== null) {
      const text = unescapeHtmlEntities(pMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
      if (text) { description = text.slice(0, 500); break }
    }

    results.push({ title, url, description })
  }

  return results
}

/** HTML 实体解码 */
function unescapeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/**
 * 从 HTML 中提取文本内容（去除 script/style/noscript）
 */
function extractTextFromHtml(html: string): { title: string; content: string } {
  // 提取标题
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : ''

  // 移除 script、style、noscript 标签
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')

  // 移除 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ')

  // 清理空白
  text = text
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()

  return { title, content: text }
}

/**
 * 从 URL 列表提取网页正文
 */
async function extractHtmlContent(urls: string[]): Promise<{
  success: boolean
  data?: Array<{ url: string; title: string; content: string }>
  error?: string
}> {
  // SSRF 安全检查
  for (const url of urls) {
    const check = await isSafeUrl(url)
    if (!check.safe) {
      return { success: false, error: `URL 安全检查失败: ${url} — ${check.reason}` }
    }
  }

  const results: Array<{ url: string; title: string; content: string }> = []

  for (const url of urls) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      })

      clearTimeout(timeout)

      if (!response.ok) {
        results.push({ url, title: '', content: `获取失败 (HTTP ${response.status})` })
        continue
      }

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        results.push({ url, title: '', content: `不支持的内容类型: ${contentType}` })
        continue
      }

      const html = await response.text()
      const { title, content } = extractTextFromHtml(html)

      const truncated = content.length > MAX_CONTENT_CHARS
        ? content.slice(0, MAX_CONTENT_CHARS) + '\n\n...[内容已截断，超出 10 万字符限制]'
        : content

      results.push({ url, title, content: truncated })
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        results.push({ url, title: '', content: '请求超时（15 秒）' })
      } else {
        results.push({ url, title: '', content: `提取失败: ${err?.message || String(err)}` })
      }
    }
  }

  return { success: true, data: results }
}

// ─── web_search 工具 ─────────────────────────────────────────────

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: (
    '使用网络搜索引擎获取实时信息、新闻、文档等。'
    + '无需 API Key 即可使用。'
    + '搜索结果包含标题、URL 和摘要。'
    + '如果需要获取网页完整正文，请使用 web_extract 工具。'
  ),
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词',
      },
      limit: {
        type: 'number',
        description: '返回结果数量，默认 5，最大 10',
      },
    },
    required: ['query'],
  },
  handler: async (args): Promise<ToolResult> => {
    const query = String(args.query ?? '').trim()
    const limit = typeof args.limit === 'number'
      ? Math.min(Math.max(1, Math.floor(args.limit)), MAX_SEARCH_RESULTS)
      : 5

    if (!query) {
      return { success: false, output: '搜索关键词不能为空' }
    }

    logger.info(`[WebSearch] 必应搜索: "${query}" (limit: ${limit})`)

    const result = await bingSearch(query, limit)

    if (!result.success) {
      return { success: false, output: `网络搜索失败: ${result.error}` }
    }

    const results = result.data || []
    if (results.length === 0) {
      return {
        success: true,
        output: `未找到搜索结果: ${query}`,
        data: { query, results: [] },
      }
    }

    const output = results.map((r, i) =>
      `${i + 1}. ${r.title}\n   URL: ${r.url}\n   摘要: ${r.description}`
    ).join('\n\n')

    return {
      success: true,
      output: `搜索结果 (${results.length} 条):\n\n${output}`,
      data: { query, results },
    }
  },
}

// ─── web_extract 工具 ────────────────────────────────────────────

export const webExtractTool: ToolDefinition = {
  name: 'web_extract',
  description: (
    '从指定 URL 提取网页正文内容。'
    + '直接传入 URL 即可获取 markdown 格式的正文。\n\n'
    + '最多同时提取 10 个 URL 的内容。'
    + '如果 URL 无法访问，内容会被截断或返回错误。'
  ),
  parameters: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        description: '要提取内容的 URL 列表，最多 10 个',
        items: {
          type: 'string',
          description: '单个 URL',
        },
      },
      url: {
        type: 'string',
        description: '单个 URL（当只有一个 URL 时可用）',
      },
    },
    required: [],
  },
  handler: async (args): Promise<ToolResult> => {
    let urlList: string[] = []

    if (Array.isArray(args.urls)) {
      urlList = args.urls.map(u => String(u).trim()).filter(Boolean)
    } else if (args.url) {
      urlList = [String(args.url).trim()]
    }

    if (urlList.length === 0) {
      return { success: false, output: 'URL 列表不能为空。请提供 urls 数组或单个 url 参数' }
    }
    if (urlList.length > MAX_EXTRACT_URLS) {
      return { success: false, output: `URL 数量 (${urlList.length}) 超过限制，最多 ${MAX_EXTRACT_URLS} 个` }
    }

    logger.info(`[WebExtract] 提取: ${urlList.join(', ')}`)

    const result = await extractHtmlContent(urlList)

    if (!result.success) {
      return { success: false, output: `网页提取失败: ${result.error}` }
    }

    const extracted = result.data || []
    if (extracted.length === 0) {
      return {
        success: true,
        output: '未能从任何 URL 提取内容',
        data: { urls: urlList, extracted: [] },
      }
    }

    const output = extracted.map((r) => {
      let block = `--- ${r.title || r.url} ---\n`
      if (r.content.length > 3000) {
        block += r.content.slice(0, 3000) + '\n\n...[内容已截断]'
      } else {
        block += r.content || '(页面内容为空)'
      }
      return block
    }).join('\n\n')

    return {
      success: true,
      output,
      data: { urls: urlList, extracted },
    }
  },
}
