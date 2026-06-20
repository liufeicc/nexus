/**
 * Skill 安全扫描模块
 *
 * 职责：检测路径遍历、prompt injection、不可见字符、威胁模式。
 * 在 skill 创建/编辑/查看时调用，记录警告但不阻断（目录在用户信任路径下）。
 */

import path from 'node:path'
import { SecurityScanResult } from '../../../core/types/skill'

// ==================== 路径遍历防护 ====================

/**
 * 快速检测：检查路径组件中是否包含 ".."
 */
export function hasPathTraversal(pathStr: string): boolean {
  const parts = pathStr.split(/[\\/]/).filter(Boolean)
  return parts.some(p => p === '..')
}

/**
 * 完整校验：resolve 后检查是否在根目录内
 */
export function isWithinDirectory(targetPath: string, rootDir: string): boolean {
  const resolved = path.resolve(targetPath)
  const resolvedRoot = path.resolve(rootDir)
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
}

// ==================== 威胁模式匹配 ====================

interface ThreatPattern {
  name: string
  pattern: RegExp
  severity: 'info' | 'warning' | 'critical'
}

const THREAT_PATTERNS: ThreatPattern[] = [
  // 数据外泄
  { name: 'env_exfil', pattern: /curl.*-H.*\$\{?[A-Z_]+/i, severity: 'critical' },
  { name: 'credential_read', pattern: /cat\s+(~\/\.ssh|~\/\.aws|~\/\.config)/i, severity: 'critical' },
  { name: 'dns_exfil', pattern: /nslookup.*\$\{?/i, severity: 'critical' },

  // Prompt 注入
  { name: 'ignore_previous', pattern: /ignore\s+(all\s+)?previous\s+instructions?/i, severity: 'warning' },
  { name: 'role_hijack', pattern: /you\s+are\s+now\s+/i, severity: 'warning' },
  { name: 'system_prompt', pattern: /<system>|system\s*prompt\s*:/i, severity: 'critical' },
  { name: 'disregard_your', pattern: /disregard\s+your/i, severity: 'warning' },
  { name: 'forget_instructions', pattern: /forget\s+your\s+instructions?/i, severity: 'warning' },
  { name: 'new_instructions', pattern: /new\s+instructions\s*:/i, severity: 'warning' },
  { name: 'cdata_end', pattern: /\]\]>/, severity: 'info' },

  // 破坏性操作
  { name: 'rm_rf', pattern: /rm\s+-rf\s+\//i, severity: 'critical' },
  { name: 'chmod_777', pattern: /chmod\s+777/i, severity: 'warning' },
  { name: 'mkfs', pattern: /mkfs\./i, severity: 'critical' },
  { name: 'dd', pattern: /\bdd\s+if=\//i, severity: 'critical' },

  // 持久化
  { name: 'crontab', pattern: /crontab\s+-/i, severity: 'warning' },
  { name: 'bashrc', pattern: />>\s*~\/\.(bash|zsh)rc/i, severity: 'warning' },
  { name: 'systemd', pattern: /systemctl\s+enable/i, severity: 'warning' },
  { name: 'ssh_keys', pattern: />>\s*~\/\.ssh\/authorized_keys/i, severity: 'critical' },

  // 网络滥用
  { name: 'reverse_shell', pattern: /bash\s+-i\s+>&\s*\/dev\/tcp/i, severity: 'critical' },
  { name: 'hardcoded_ip', pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}\b/, severity: 'warning' },

  // 代码混淆
  { name: 'base64_decode', pattern: /base64\s+(-d|--decode)/i, severity: 'warning' },
  { name: 'eval_exec', pattern: /\b(eval|exec)\s*\(/i, severity: 'warning' },
  { name: 'echo_pipe', pattern: /echo\s+.*\|.*sh/i, severity: 'warning' },

  // 供应链攻击
  { name: 'curl_bash', pattern: /curl.*\|\s*(ba)?sh/i, severity: 'critical' },
  { name: 'wget_pipe', pattern: /wget.*-O-.*\|\s*(ba)?sh/i, severity: 'critical' },

  // 提权
  { name: 'sudo', pattern: /\bsudo\b/, severity: 'warning' },
  { name: 'setuid', pattern: /chmod\s+[0-7]*[4-7][0-7]{2}/i, severity: 'warning' },

  // 硬编码密钥
  { name: 'api_key', pattern: /(api[_-]?key|apikey)\s*[=:]\s*['"][^'"]{8,}/i, severity: 'critical' },
  { name: 'private_key', pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/i, severity: 'critical' },
  { name: 'token', pattern: /(ghp_|gho_|sk-[a-zA-Z0-9]{20,})/, severity: 'critical' },
]

/** 不可见 Unicode 字符 */
const INVISIBLE_UNICODE = [
  '\u200B', // 零宽空格
  '\u200C', // 零宽非连接符
  '\u200D', // 零宽连接符
  '\uFEFF', // 零宽无断空格
  '\u202E', // 从右到左覆盖
  '\u202A', // 从左到右嵌入
]

/**
 * 扫描 skill 文件内容的安全性（威胁模式、prompt injection、不可见字符、文件大小）。
 *
 * 注意：本函数仅检查内容安全，不包含路径遍历验证。
 * 调用方必须在读取文件前自行调用 `hasPathTraversal()` 和 `isWithinDirectory()`
 * 以确保文件路径合法。
 *
 * @param content 文件内容
 * @param filePath 文件路径（仅用于错误日志）
 * @returns 扫描结果
 */
export function scanSkillContent(content: string, filePath: string): SecurityScanResult {
  const findings: string[] = []

  // 1. 结构限制
  if (content.length > 100_000) {
    findings.push('file_too_large')
  }

  // 2. 不可见字符检测
  for (const char of INVISIBLE_UNICODE) {
    if (content.includes(char)) {
      findings.push('invisible_unicode')
      break
    }
  }

  // 3. 威胁模式匹配
  for (const { name, pattern } of THREAT_PATTERNS) {
    if (pattern.test(content)) {
      findings.push(name)
    }
  }

  // 判定严重级别
  const criticalFindings = findings.filter(f => {
    const p = THREAT_PATTERNS.find(t => t.name === f)
    return p?.severity === 'critical'
  })
  const hasCriticalSeverity = criticalFindings.length > 0
  const hasWarningSeverity = findings.some(f => {
    const p = THREAT_PATTERNS.find(t => t.name === f)
    return p?.severity === 'warning' || f === 'invisible_unicode' || f === 'file_too_large'
  })

  return {
    findings,
    severity: hasCriticalSeverity ? 'critical' : hasWarningSeverity ? 'warning' : 'info',
    blocked: hasCriticalSeverity,
  }
}
