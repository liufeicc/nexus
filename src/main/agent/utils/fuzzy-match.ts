/**
 * 模糊匹配模块（用于文件编辑操作）
 *
 * 实现 9 策略链，按顺序尝试查找匹配位置，容忍 LLM 生成的空格、缩进、转义等差异。
 *
 * 策略链（按顺序）：
 * 1. exact — 精确 indexOf 匹配
 * 2. line_trimmed — 逐行 trim 后匹配
 * 3. whitespace_normalized — 折叠多个空格/tab 为单个空格
 * 4. indentation_flexible — 忽略缩进差异（lstrip）
 * 5. escape_normalized — 将 \n \t \r 字面量转为实际字符
 * 6. trimmed_boundary — 仅 trim 首行和末行空白
 * 7. unicode_normalized — Unicode 规范化（智能引号、破折号等 → ASCII）
 * 8. block_anchor — 锚定首尾行，中间用相似度比对
 * 9. context_aware — 逐行相似度 ≥80% 的行占 ≥50% 即匹配
 */

// ==================== Unicode 规范化 ====================

const UNICODE_MAP: Record<string, string> = {
  '\u201c': '"', '\u201d': '"',  // 智能双引号
  '\u2018': "'", '\u2019': "'",  // 智能单引号
  '\u2014': '--', '\u2013': '-',  // em/en 破折号
  '\u2026': '...', '\u00a0': ' ', // 省略号和非断空格
}

function unicodeNormalize(text: string): string {
  let result = text
  for (const [char, repl] of Object.entries(UNICODE_MAP)) {
    result = result.split(char).join(repl)
  }
  return result
}

// ==================== 位置映射辅助函数 ====================

/**
 * 计算行号区间到字符偏移的映射
 */
function calculateLinePositions(
  contentLines: string[], startLine: number, endLine: number, contentLength: number,
): [number, number] {
  let startPos = 0
  for (let i = 0; i < startLine; i++) {
    startPos += contentLines[i].length + 1
  }
  let endPos = 0
  for (let i = 0; i < endLine; i++) {
    endPos += contentLines[i].length + 1
  }
  endPos -= 1
  if (endPos >= contentLength) endPos = contentLength
  return [startPos, endPos]
}

/**
 * 在规范化后的内容中查找匹配块，映射回原始位置
 */
function findNormalizedMatches(
  content: string, contentLines: string[], contentNormLines: string[],
  pattern: string, patternNormalized: string,
): [number, number][] {
  const patLines = patternNormalized.split('\n')
  const numPatLines = patLines.length
  const matches: [number, number][] = []

  for (let i = 0; i <= contentNormLines.length - numPatLines; i++) {
    const block = contentNormLines.slice(i, i + numPatLines).join('\n')
    if (block === patternNormalized) {
      const [start, end] = calculateLinePositions(contentLines, i, i + numPatLines, content.length)
      matches.push([start, end])
    }
  }
  return matches
}

/**
 * 将规范化字符串中的匹配位置映射回原始位置（用于空白规范化）
 */
function mapNormalizedPositions(original: string, normalized: string, normMatches: [number, number][]): [number, number][] {
  if (!normMatches.length) return []

  // 构建 orig->norm 映射
  const origToNorm: number[] = []
  let oi = 0, ni = 0
  while (oi < original.length && ni < normalized.length) {
    if (original[oi] === normalized[ni]) {
      origToNorm.push(ni)
      oi++
      ni++
    } else if (' \t'.includes(original[oi]) && normalized[ni] === ' ') {
      origToNorm.push(ni)
      oi++
      if (oi < original.length && !' \t'.includes(original[oi])) ni++
    } else if (' \t'.includes(original[oi])) {
      origToNorm.push(ni)
      oi++
    } else {
      origToNorm.push(ni)
      oi++
    }
  }
  while (oi < original.length) {
    origToNorm.push(normalized.length)
    oi++
  }

  // 反向映射
  const normToStart: Record<number, number> = {}
  const normToEnd: Record<number, number> = {}
  for (let op = 0; op < origToNorm.length; op++) {
    const np = origToNorm[op]
    if (!(np in normToStart)) normToStart[np] = op
    normToEnd[np] = op
  }

  const results: [number, number][] = []
  for (const [ns, ne] of normMatches) {
    const os = ns in normToStart ? normToStart[ns] : Object.entries(normToStart).find(([k]) => Number(k) >= ns)?.[1] ?? ns
    let oe = (ne - 1) in normToEnd ? normToEnd[ne - 1] + 1 : os + (ne - ns)
    // 扩展到包含后续空白
    while (oe < original.length && ' \t'.includes(original[oe])) oe++
    results.push([os, Math.min(oe, original.length)])
  }
  return results
}

// ==================== 策略实现 ====================

/** 策略 1: 精确匹配 */
function strategyExact(content: string, pattern: string): [number, number][] {
  const matches: [number, number][] = []
  let start = 0
  while (true) {
    const pos = content.indexOf(pattern, start)
    if (pos === -1) break
    matches.push([pos, pos + pattern.length])
    start = pos + 1
  }
  return matches
}

/** 策略 2: 逐行 trim 匹配 */
function strategyLineTrimmed(content: string, pattern: string): [number, number][] {
  const patLines = pattern.split('\n').map(l => l.trim())
  const patNorm = patLines.join('\n')
  const contentLines = content.split('\n')
  const contentNorm = contentLines.map(l => l.trim())
  return findNormalizedMatches(content, contentLines, contentNorm, pattern, patNorm)
}

/** 策略 3: 空白规范化匹配 */
function strategyWhitespaceNormalized(content: string, pattern: string): [number, number][] {
  const normalize = (s: string) => s.replace(/[ \t]+/g, ' ')
  const patNorm = normalize(pattern)
  const contentNorm = normalize(content)
  const normMatches = strategyExact(contentNorm, patNorm)
  if (!normMatches.length) return []
  return mapNormalizedPositions(content, contentNorm, normMatches)
}

/** 策略 4: 忽略缩进匹配 */
function strategyIndentationFlexible(content: string, pattern: string): [number, number][] {
  const contentLines = content.split('\n')
  const contentStrip = contentLines.map(l => l.replace(/^\s+/, ''))
  const patStrip = pattern.split('\n').map(l => l.replace(/^\s+/, '')).join('\n')
  return findNormalizedMatches(content, contentLines, contentStrip, pattern, patStrip)
}

/** 策略 5: 转义规范化匹配 */
function strategyEscapeNormalized(content: string, pattern: string): [number, number][] {
  const unescape = (s: string) => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
  const patUnescaped = unescape(pattern)
  if (patUnescaped === pattern) return []
  return strategyExact(content, patUnescaped)
}

/** 策略 6: 首尾行 trim 匹配 */
function strategyTrimmedBoundary(content: string, pattern: string): [number, number][] {
  const patLines = pattern.split('\n')
  if (!patLines.length) return []
  patLines[0] = patLines[0].trim()
  if (patLines.length > 1) patLines[patLines.length - 1] = patLines[patLines.length - 1].trim()
  const modified = patLines.join('\n')
  const contentLines = content.split('\n')
  const matches: [number, number][] = []

  for (let i = 0; i <= contentLines.length - patLines.length; i++) {
    const block = contentLines.slice(i, i + patLines.length).slice()
    block[0] = block[0].trim()
    if (block.length > 1) block[block.length - 1] = block[block.length - 1].trim()
    if (block.join('\n') === modified) {
      const [start, end] = calculateLinePositions(contentLines, i, i + patLines.length, content.length)
      matches.push([start, end])
    }
  }
  return matches
}

/** 策略 7: Unicode 规范化匹配 */
function strategyUnicodeNormalized(content: string, pattern: string): [number, number][] {
  const normContent = unicodeNormalize(content)
  const normPattern = unicodeNormalize(pattern)
  if (normContent === content && normPattern === pattern) return []
  let matches = strategyExact(normContent, normPattern)
  if (!matches.length) matches = strategyLineTrimmed(normContent, normPattern)
  if (!matches.length) return []
  // 映射回原始位置
  const origToNorm: number[] = []
  let normPos = 0
  for (const char of content) {
    origToNorm.push(normPos)
    const repl = UNICODE_MAP[char]
    normPos += repl !== undefined ? repl.length : 1
  }
  origToNorm.push(normPos)

  const normToStart: Record<number, number> = {}
  for (let op = 0; op < origToNorm.length; op++) {
    const np = origToNorm[op]
    if (!(np in normToStart)) normToStart[np] = op
  }

  const results: [number, number][] = []
  for (const [ns, ne] of matches) {
    const os = ns in normToStart ? normToStart[ns] : Object.entries(normToStart).find(([k]) => Number(k) >= ns)?.[1] ?? ns
    let oe = os
    const contentLen = content.length
    while (oe < contentLen && origToNorm[oe] < ne) oe++
    results.push([os, oe])
  }
  return results
}

/** 简单相似度（仿 difflib.SequenceMatcher.ratio） */
function similarity(a: string, b: string): number {
  if (!a && !b) return 1.0
  if (!a || !b) return 0.0
  // 用最长公共子序列近似
  const m = a.length, n = b.length
  if (m * n > 50000) {
    // 大字符串用简化方法
    const setA = new Set(a.split(''))
    const setB = new Set(b.split(''))
    let common = 0
    for (const c of setA) { if (setB.has(c)) common++ }
    return (2 * common) / (setA.size + setB.size)
  }
  // 标准 LCS
  const dp: number[] = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    let prev = 0
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]
      if (a[i - 1] === b[j - 1]) dp[j] = prev + 1
      else dp[j] = Math.max(dp[j], dp[j - 1])
      prev = temp
    }
  }
  const lcs = dp[n]
  return (2 * lcs) / (m + n)
}

/** 策略 8: 首尾锚定 + 中间相似度 */
function strategyBlockAnchor(content: string, pattern: string): [number, number][] {
  const normPattern = unicodeNormalize(pattern)
  const normContent = unicodeNormalize(content)
  const patLines = normPattern.split('\n')
  if (patLines.length < 2) return []

  const firstLine = patLines[0].trim()
  const lastLine = patLines[patLines.length - 1].trim()
  const normCLines = normContent.split('\n')
  const origCLines = content.split('\n')
  const numPatLines = patLines.length

  const potentials: number[] = []
  for (let i = 0; i <= normCLines.length - numPatLines; i++) {
    if (normCLines[i].trim() === firstLine && normCLines[i + numPatLines - 1].trim() === lastLine) {
      potentials.push(i)
    }
  }
  if (!potentials.length) return []

  const threshold = potentials.length === 1 ? 0.60 : 0.70
  const matches: [number, number][] = []

  for (const i of potentials) {
    let sim = 1.0
    if (numPatLines > 2) {
      const contentMid = normCLines.slice(i + 1, i + numPatLines - 1).join('\n')
      const patMid = patLines.slice(1, -1).join('\n')
      sim = similarity(contentMid, patMid)
    }
    if (sim >= threshold) {
      const [start, end] = calculateLinePositions(origCLines, i, i + numPatLines, content.length)
      matches.push([start, end])
    }
  }
  return matches
}

/** 策略 9: 逐行相似度感知 */
function strategyContextAware(content: string, pattern: string): [number, number][] {
  const patLines = pattern.split('\n')
  const contentLines = content.split('\n')
  if (!patLines.length) return []
  const numPatLines = patLines.length
  const matches: [number, number][] = []

  for (let i = 0; i <= contentLines.length - numPatLines; i++) {
    let highSimCount = 0
    for (let j = 0; j < numPatLines; j++) {
      const sim = similarity(patLines[j].trim(), contentLines[i + j].trim())
      if (sim >= 0.80) highSimCount++
    }
    if (highSimCount >= numPatLines * 0.5) {
      const [start, end] = calculateLinePositions(contentLines, i, i + numPatLines, content.length)
      matches.push([start, end])
    }
  }
  return matches
}

// ==================== 主入口 ====================

export interface FuzzyMatchResult {
  newContent: string
  matchCount: number
  strategy: string | undefined
  error: string | undefined
}

/**
 * 模糊查找替换 — 9 策略链
 *
 * @param content - 文件完整内容
 * @param oldString - 要查找的文本
 * @param newString - 替换文本
 * @param replaceAll - 是否替换所有匹配
 * @returns { newContent, matchCount, strategy, error }
 */
export function fuzzyFindAndReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean = false,
): FuzzyMatchResult {
  if (!oldString) {
    return { newContent: content, matchCount: 0, strategy: undefined, error: 'old_string 不能为空' }
  }
  if (oldString === newString) {
    return { newContent: content, matchCount: 0, strategy: undefined, error: 'old_string 和 new_string 相同' }
  }

  type Strategy = [string, (c: string, p: string) => [number, number][]]
  const strategies: Strategy[] = [
    ['exact', strategyExact],
    ['line_trimmed', strategyLineTrimmed],
    ['whitespace_normalized', strategyWhitespaceNormalized],
    ['indentation_flexible', strategyIndentationFlexible],
    ['escape_normalized', strategyEscapeNormalized],
    ['trimmed_boundary', strategyTrimmedBoundary],
    ['unicode_normalized', strategyUnicodeNormalized],
    ['block_anchor', strategyBlockAnchor],
    ['context_aware', strategyContextAware],
  ]

  for (const [name, fn] of strategies) {
    const matches = fn(content, oldString)
    if (!matches.length) continue

    if (matches.length > 1 && !replaceAll) {
      return {
        newContent: content,
        matchCount: 0,
        strategy: undefined,
        error: `找到 ${matches.length} 处匹配。请提供更多上下文以确保唯一匹配，或设置 replace_all=true。`,
      }
    }

    // 从后往前替换，保持位置不变
    const sorted = [...matches].sort((a, b) => b[0] - a[0])
    let result = content
    for (const [start, end] of sorted) {
      result = result.slice(0, start) + newString + result.slice(end)
    }

    return { newContent: result, matchCount: matches.length, strategy: name, error: undefined }
  }

  return { newContent: content, matchCount: 0, strategy: undefined, error: '未找到匹配的文本。请使用 read_file 查看文件当前内容，确认要查找的文本。' }
}
