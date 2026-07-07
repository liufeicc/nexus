/**
 * 秘密脱敏工具
 *
 * 用于在工具输出中自动脱敏 API Key、Token、私钥等敏感信息，
 * 防止 AI 智能体将密钥回显到对话历史中。
 */

// ==================== Token 前缀模式 ====================

/**
 * 已知 Token 前缀模式（28 种），编译为一个大正则
 * 覆盖 OpenAI、Anthropic、GitHub、Slack、Google、AWS、Stripe 等
 */
const TOKEN_PREFIX_RE = /(?<![A-Za-z0-9_-])(?:sk-[A-Za-z0-9_-]{10,}|sk-ant-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|sk_live_[A-Za-z0-9]{10,}|rk_live_[A-Za-z0-9]{10,}|SG\.[A-Za-z0-9_-]{10,}|hf_[A-Za-z0-9]{10,}|ya29\.[A-Za-z0-9_-]{10,}|dnp_[A-Za-z0-9]{10,}|nvapi-[A-Za-z0-9]{10,}|gsk_[A-Za-z0-9]{10,}|gmi_[A-Za-z0-9]{10,}|dck_[A-Za-z0-9]{10,}|glc_[A-Za-z0-9]{10,}|geo_[A-Za-z0-9]{10,}|phc_[A-Za-z0-9]{10,}|[a-f0-9]{40}|gho_[A-Za-z0-9]{10,}|glpat-[A-Za-z0-9]{10,}|jtv_[A-Za-z0-9]{10,}|npm_[A-Za-z0-9]{10,}|pypi-[A-Za-z0-9_-]{10,}|key-[A-Za-z0-9]{10,})(?![A-Za-z0-9_-])/g

// ==================== 其他检测模式 ====================

// ENV 赋值：KEY_NAME=value（匹配包含 SECRET/TOKEN/KEY/PASSWORD 的变量名）
const ENV_ASSIGN_RE = /((?:SECRET|TOKEN|API_KEY|PRIVATE_KEY|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*)\s*=\s*(['"]?)(\S+)\2/gi

// JSON 字段："apiKey": "value"
const JSON_FIELD_RE = /("(?:apiKey|api_key|token|secret|password|privateKey|private_key|accessKey|access_key|auth_token)\s*:\s*")([^"]+)(")/gi

// Auth Header：Authorization: Bearer <token>
const AUTH_HEADER_RE = /(Authorization:\s*Bearer\s+)(\S+)/gi

// Telegram Bot Token：123456789:ABCdef...
const TELEGRAM_RE = /(\d{8,}):([-A-Za-z0-9_]{30,})/g

// 私钥块
const PRIVATE_KEY_RE = /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g

// 数据库连接串：postgres://user:pass@host
const DB_CONNSTR_RE = /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis(?:s)?|amqp(?:s)?):\/\/[^:]+:)([^@]+)(@)/gi

// ==================== 掩码策略 ====================

/**
 * 将 Token 掩码为前 6 + ... + 后 4
 */
function maskToken(token: string): string {
  if (token.length < 10) return '***'
  if (token.length < 18) return token.slice(0, 3) + '...'
  return token.slice(0, 6) + '...' + token.slice(-4)
}

// ==================== 主函数 ====================

/**
 * 脱敏文本中的敏感信息
 *
 * @param text - 可能包含敏感信息的文本
 * @returns 脱敏后的文本
 */
export function redactSensitiveText(text: string): string {
  if (!text) return text

  // 1. Token 前缀模式
  text = text.replace(TOKEN_PREFIX_RE, (m) => maskToken(m))

  // 2. ENV 赋值
  text = text.replace(ENV_ASSIGN_RE, (_match, name, quote, value) =>
    `${name}=${quote}${maskToken(value)}${quote}`
  )

  // 3. JSON 字段
  text = text.replace(JSON_FIELD_RE, (_match, key, value, close) =>
    `${key}${maskToken(value)}${close}`
  )

  // 4. Auth Header
  text = text.replace(AUTH_HEADER_RE, (_match, prefix, token) =>
    prefix + maskToken(token)
  )

  // 5. Telegram Token
  text = text.replace(TELEGRAM_RE, (_match, digits, _token) =>
    `${digits}:***`
  )

  // 6. 私钥块
  text = text.replace(PRIVATE_KEY_RE, '[REDACTED PRIVATE KEY]')

  // 7. 数据库连接串
  text = text.replace(DB_CONNSTR_RE, (_match, proto, _password, at) =>
    `${proto}***${at}`
  )

  return text
}
