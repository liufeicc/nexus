/**
 * 测试脚本：测试 web 工具（Tavily 后端）
 * 运行方式：TAVILY_API_KEY=tvly-xxx node scripts/test-web-tools.mjs
 *
 * 测试内容：
 * 1. 搜索 API 密钥缺失
 * 2. 正常搜索
 * 3. 空搜索关键词
 * 4. 提取 - SSRF 拦截
 * 5. 提取 - 空 URL
 * 6. 提取 - 超出数量限制
 * 7. URL 安全 - 私有 IP
 * 8. URL 安全 - 含密钥
 * 9. URL 安全 - 本地地址
 * 10. URL 安全 - 合法 URL
 */

// 内联 web-tools 逻辑（Node strip-only 不支持跨模块 TS 导入）
import https from 'https'

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'
const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract'
const MAX_SEARCH_RESULTS = 10
const MAX_EXTRACT_URLS = 10
const MAX_CONTENT_CHARS = 100_000

function isSafeUrl(urlString) {
  let parsed
  try { parsed = new URL(urlString) } catch {
    return { safe: false, reason: '无效的 URL' }
  }
  const hostname = parsed.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return { safe: false, reason: '不允许访问本地地址' }
  }
  if (hostname.startsWith('169.254.')) {
    return { safe: false, reason: '不允许访问链路本地地址' }
  }
  if (/^10\./.test(hostname)) return { safe: false, reason: '不允许访问私有网络地址' }
  if (/^192\.168\./.test(hostname)) return { safe: false, reason: '不允许访问私有网络地址' }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return { safe: false, reason: '不允许访问私有网络地址' }
  const secretPatterns = ['api_key=', 'api-key=', 'token=', 'secret=', 'password=', 'access_key=', 'auth_token=']
  const lowerUrl = urlString.toLowerCase()
  for (const pat of secretPatterns) {
    if (lowerUrl.includes(pat)) return { safe: false, reason: 'URL 包含敏感信息' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: '仅支持 http/https 协议' }
  }
  return { safe: true }
}

async function tavilySearch(query, maxResults) {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey || !apiKey.trim()) {
    return { success: false, error: 'TAVILY_API_KEY 环境变量未设置' }
  }
  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey.trim(), query, max_results: maxResults }),
    })
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      return { success: false, error: `Tavily API 请求失败 (HTTP ${response.status}): ${errorBody.slice(0, 200)}` }
    }
    const json = await response.json()
    const results = (json.results || []).map((r, i) => ({
      title: r.title || '',
      url: r.url || '',
      description: (r.content || '').slice(0, 500),
      position: i + 1,
    }))
    return { success: true, data: results }
  } catch (err) {
    return { success: false, error: `Tavily 搜索请求异常: ${err?.message || String(err)}` }
  }
}

async function tavilyExtract(urls) {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey || !apiKey.trim()) {
    return { success: false, error: 'TAVILY_API_KEY 环境变量未设置' }
  }
  for (const url of urls) {
    const check = isSafeUrl(url)
    if (!check.safe) {
      return { success: false, error: `URL 安全检查失败: ${url} — ${check.reason}` }
    }
  }
  try {
    const response = await fetch(TAVILY_EXTRACT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey.trim(), urls }),
    })
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      return { success: false, error: `Tavily Extract API 请求失败 (HTTP ${response.status}): ${errorBody.slice(0, 200)}` }
    }
    const json = await response.json()
    const results = (json.results || []).map(r => {
      const raw = r.raw_content || r.content || ''
      const content = raw.length > MAX_CONTENT_CHARS ? raw.slice(0, MAX_CONTENT_CHARS) + '\n\n...[内容已截断]' : raw
      return { url: r.url || '', title: r.title || '', content }
    })
    return { success: true, data: results }
  } catch (err) {
    return { success: false, error: `Tavily 提取请求异常: ${err?.message || String(err)}` }
  }
}

// ==================== 测试用例 ====================

function testMissingApiKey() {
  console.log('=== 测试 1: 缺失 TAVILY_API_KEY ===')
  const saved = process.env.TAVILY_API_KEY
  delete process.env.TAVILY_API_KEY
  tavilySearch('test', 5).then(r => {
    console.log('  成功:', r.success === false && r.error.includes('环境变量未设置') ? 'PASS' : 'FAIL')
    console.log('  错误:', r.error)
    process.env.TAVILY_API_KEY = saved
  })
}

function testSearch() {
  console.log('\n=== 测试 2: 正常搜索 ===')
  const hasKey = process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY.trim()
  if (!hasKey) {
    console.log('  跳过: 未设置 TAVILY_API_KEY')
    return
  }
  tavilySearch('TypeScript 5.0 features', 3).then(r => {
    if (!r.success) {
      console.log('  成功: FAIL')
      console.log('  错误:', r.error)
      return
    }
    console.log('  结果数:', r.data?.length)
    if (r.data?.length > 0) {
      console.log('  标题:', r.data[0].title)
      console.log('  URL:', r.data[0].url.slice(0, 60) + '...')
      console.log('  摘要:', r.data[0].description.slice(0, 80) + '...')
    }
    console.log('  成功:', r.data && r.data.length > 0 ? 'PASS' : 'FAIL')
  })
}

function testEmptyQuery() {
  console.log('\n=== 测试 3: 空搜索关键词 ===')
  tavilySearch('', 5).then(r => {
    console.log('  结果:', r.data?.length ?? 'N/A')
    console.log('  成功:', r.data && r.data.length === 0 ? 'PASS' : 'FAIL')
  })
}

function testExtractSsrfLocalhost() {
  console.log('\n=== 测试 4: 提取 - SSRF 拦截 (localhost) ===')
  tavilyExtract(['http://127.0.0.1:8080/test']).then(r => {
    console.log('  被拦截:', r.success === false)
    console.log('  错误:', r.error)
    console.log('  成功:', r.success === false && r.error.includes('本地') ? 'PASS' : 'FAIL')
  })
}

function testExtractEmptyUrls() {
  console.log('\n=== 测试 5: 提取 - 空 URL 列表 ===')
  tavilyExtract([]).then(r => {
    console.log('  成功:', r.data && r.data.length === 0 ? 'PASS' : 'FAIL')
  })
}

function testExtractTooManyUrls() {
  console.log('\n=== 测试 6: 提取 - 超出数量限制 ===')
  const urls = Array.from({ length: 15 }, (_, i) => `https://example.com/page${i}`)
  tavilyExtract(urls).then(r => {
    console.log('  成功:', r.data && r.data.length <= MAX_EXTRACT_URLS ? 'PASS' : 'FAIL')
  })
}

function testUrlSafety() {
  console.log('\n=== 测试 7: URL 安全检查 ===')
  const cases = [
    { url: 'http://10.0.0.1/admin', expected: false, label: '私有 IP 10.x' },
    { url: 'http://192.168.1.1/login', expected: false, label: '私有 IP 192.168.x' },
    { url: 'http://172.16.0.1/test', expected: false, label: '私有 IP 172.16.x' },
    { url: 'https://example.com?token=abc123', expected: false, label: 'URL 含密钥' },
    { url: 'http://localhost:3000', expected: false, label: '本地地址' },
    { url: 'ftp://example.com/file.txt', expected: false, label: '非 http/https' },
    { url: 'https://www.typescriptlang.org/docs/', expected: true, label: '合法 HTTPS' },
    { url: 'https://github.com/microsoft/TypeScript', expected: true, label: '合法 GitHub' },
  ]
  let passed = 0
  for (const c of cases) {
    const r = isSafeUrl(c.url)
    const ok = r.safe === c.expected
    if (ok) passed++
    console.log(`  ${ok ? '✓' : '✗'} ${c.label}: ${r.safe ? '允许' : '拒绝'} (${r.reason || 'ok'})`)
  }
  console.log(`  成功: ${passed}/${cases.length} ${passed === cases.length ? 'PASS' : 'FAIL'}`)
}

// ==================== 主测试 ====================

console.log('\n========== Web 工具测试 ==========\n')
console.log('TAVILY_API_KEY:', process.env.TAVILY_API_KEY ? '已设置 (' + process.env.TAVILY_API_KEY.slice(0, 8) + '...)' : '未设置')

testMissingApiKey()
testSearch()
testEmptyQuery()
testExtractSsrfLocalhost()
testExtractEmptyUrls()
testExtractTooManyUrls()
testUrlSafety()

console.log('\n========== 等待异步结果... ==========\n')
