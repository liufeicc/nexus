/**
 * 危险命令审批系统
 *
 * 核心功能：危险模式检测 + 会话/永久审批。
 */

import { stripAnsi } from './ansi-strip'

// ==================== 命令规范化 ====================

/**
 * 规范化命令，防止绕过检测
 * 1. 清除 ANSI 转义（防止颜色代码混淆）
 * 2. 清除 null 字节
 * 3. Unicode 规范化（NFKC，防止全角字符混淆）
 */
function normalizeCommand(command: string): string {
  let cmd = stripAnsi(command)
  cmd = cmd.replace(/\x00/g, '')
  try {
    cmd = cmd.normalize('NFKC')
  } catch {
    // NFKC 不可用时跳过
  }
  return cmd
}

// ==================== 危险模式检测 ====================

/**
 * 危险命令模式列表（30+ 条正则 + 描述）
 * 覆盖：删除操作、权限修改、磁盘/文件系统、SQL 破坏、系统配置覆写、
 *       Shell 注入、敏感路径写入、自杀防护、Git 破坏性操作
 */
const DANGEROUS_PATTERNS: Array<[RegExp, string]> = [
  // --- 删除操作 ---
  [/rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s/, '递归强制删除文件'],
  [/rm\s+-rf\s+\/\s/, '删除根目录'],
  [/rm\s+-rf\s+\/\*/, '删除根目录下所有内容'],
  [/rm\s+-rf\s+~/, '删除用户家目录'],
  [/find\s+.*-delete/, 'find 删除文件'],
  [/xargs\s+rm\s/, 'xargs 批量删除'],
  [/shred\s+/, '安全擦除文件'],

  // --- 权限修改 ---
  [/chmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?777\s/, '设置完全开放权限 (777)'],
  [/chmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?666\s/, '设置读写开放权限 (666)'],
  [/chmod\s+-R\s+/, '递归修改权限'],

  // --- 磁盘/文件系统破坏 ---
  [/mkfs/, '格式化文件系统'],
  [/dd\s+if=\/dev\/zero/, '用零覆盖磁盘'],
  [/>?\s*\/dev\/sd/, '写入块设备'],

  // --- SQL 破坏 ---
  [/drop\s+table\s/, '删除数据库表'],
  [/drop\s+database\s/, '删除数据库'],
  [/delete\s+from\s+\w+\s*;?\s*$/im, '无条件删除表中所有行'],
  [/truncate\s+table\s/i, '截断表'],

  // --- 系统配置覆写 ---
  [/>?\s*\/etc\//, '覆写 /etc/ 系统配置文件'],
  [/tee\s+.*\/etc\//, 'tee 写入 /etc/'],
  [/sed\s+-i.*\/etc\//, 'sed 原地修改 /etc/'],

  // --- 服务/进程终止 ---
  [/systemctl\s+(stop|disable|mask)\s/, '停止/禁用系统服务'],
  [/kill\s+-9\s+-1/, '向所有进程发送 SIGKILL'],
  [/pkill\s+-9\s/, '强制杀死进程'],

  // --- Shell 注入 ---
  [/(bash|sh|zsh)\s+-c\s+['"]/i, '通过 shell -c 执行动态命令'],
  [/(python|python3|perl|ruby|node)\s+(-c|-e)\s/i, '通过解释器 -c/-e 执行代码'],
  [/(curl|wget)\s+.*\|\s*(bash|sh|zsh)/i, '从网络下载并执行脚本'],

  // --- 敏感路径 ---
  [/\$HOME\/\.ssh\//, '操作 SSH 密钥目录'],
  [/\/\.ssh\/authorized_keys/, '修改 SSH 授权密钥'],
  [/\.env\s*=/, '修改 .env 配置文件'],

  // --- 自杀防护 ---
  [/(pkill|killall)\s+(nexus|gateway)/i, '杀死 Nexus 或网关进程'],
  [/kill\s+\$\(pgrep\s+(nexus|gateway)\)/i, '杀死 Nexus 或网关进程'],

  // --- Git 破坏性操作 ---
  [/git\s+reset\s+--hard/, 'Git 强制重置'],
  [/git\s+push\s+--force/, 'Git 强制推送'],
  [/git\s+push\s+-f\s/, 'Git 强制推送 (-f)'],
  [/git\s+clean\s+-f/, 'Git 强制清理未跟踪文件'],
  [/git\s+branch\s+-D\s/, 'Git 强制删除分支'],

  // --- Fork bomb ---
  [/:\(\)\s*\{\s*:\|:&\s*\}\s*;?\s*:/, 'Fork bomb'],
]

/**
 * 检测命令是否危险
 *
 * @param command - 要检测的命令
 * @returns [是否危险, 描述]
 */
function detectDangerousCommand(command: string): [boolean, string | null] {
  const normalized = normalizeCommand(command).toLowerCase()
  for (const [pattern, description] of DANGEROUS_PATTERNS) {
    pattern.lastIndex = 0 // 重置正则状态
    if (pattern.test(normalized)) {
      return [true, description]
    }
  }
  return [false, null]
}

// ==================== 审批状态管理 ====================

/** 会话级批准：sessionKey -> patternKey 集合 */
const sessionApproved = new Map<string, Set<string>>()

/** 永久批准：patternKey 集合 */
const permanentApproved = new Set<string>()

/** YOLO 模式旁路 */
const sessionYolo = new Set<string>()

/**
 * 审批动作类型
 */
export type ApprovalAction = 'approve' | 'approve_session' | 'approve_permanent' | 'yolo' | 'reject'

/**
 * 异步审批回调函数类型。
 * 当检测到危险命令且处于交互模式时调用，
 * 通过 IPC 向渲染进程发送审批请求，等待用户选择后返回操作类型。
 */
export type ApprovalCallback = (
  command: string,
  description: string,
  sessionKey: string,
) => Promise<ApprovalAction>

let approvalCallback: ApprovalCallback | null = null

/**
 * 交互式审批开关（默认 true）。
 * 由 AIAgent 初始化时根据数据库配置设置。
 */
let interactiveMode = true

/**
 * 设置异步审批回调函数。
 * 由 agent-service.ts 在启动时注册，用于触发 IPC 审批流程。
 */
export function setApprovalCallback(cb: ApprovalCallback | null): void {
  approvalCallback = cb
}

/**
 * 设置交互式审批开关
 */
export function setInteractiveMode(enabled: boolean): void {
  interactiveMode = enabled
}

/**
 * 检查模式是否已批准
 */
function isApproved(sessionKey: string, patternKey: string): boolean {
  if (sessionYolo.has(sessionKey)) return true
  if (permanentApproved.has(patternKey)) return true
  const approved = sessionApproved.get(sessionKey)
  return approved ? approved.has(patternKey) : false
}

/**
 * 会话级批准（本次会话有效）
 */
function approveSession(sessionKey: string, patternKey: string): void {
  if (!sessionApproved.has(sessionKey)) {
    sessionApproved.set(sessionKey, new Set())
  }
  sessionApproved.get(sessionKey)!.add(patternKey)
}

/**
 * 永久批准（持久到进程生命周期）
 */
function approvePermanent(patternKey: string): void {
  permanentApproved.add(patternKey)
}

/**
 * 启用 YOLO 模式（跳过所有检查）
 */
function enableSessionYolo(sessionKey: string): void {
  sessionYolo.add(sessionKey)
}

/**
 * 清理会话状态
 */
function clearSession(sessionKey: string): void {
  sessionApproved.delete(sessionKey)
  sessionYolo.delete(sessionKey)
}

// ==================== 审批结果类型 ====================

/**
 * 审批结果
 */
export interface ApprovalResult {
  approved: boolean
  blocked: boolean
  message: string
  patternKey?: string
  description?: string
}

// ==================== 主入口 ====================

/**
 * 检查危险命令并处理审批（异步交互式版本）
 *
 * 流程：
 * 1. YOLO 模式 → 直接放行
 * 2. 检测是否危险 → 不危险则放行
 * 3. 已批准 → 放行
 * 4. 非交互环境 → 放行（不阻塞，仅记录警告）
 * 5. 交互式环境 + 有回调 → 通过 IPC 触发用户审批
 * 6. 交互式环境 + 无回调 → 拒绝（降级到旧行为）
 *
 * @param command - 要执行的命令
 * @param sessionKey - 会话标识
 * @returns 审批结果 Promise
 */
export async function checkDangerousCommand(
  command: string,
  sessionKey: string = 'default'
): Promise<ApprovalResult> {
  // 1. YOLO 模式
  if (sessionYolo.has(sessionKey)) {
    return { approved: true, blocked: false, message: 'YOLO 模式：跳过危险命令检查' }
  }

  // 2. 检测
  const [isDangerous, description] = detectDangerousCommand(command)
  if (!isDangerous || !description) {
    return { approved: true, blocked: false, message: '命令安全检查通过' }
  }

  const patternKey = description

  // 3. 已批准
  if (isApproved(sessionKey, patternKey)) {
    return { approved: true, blocked: false, message: `命令已批准：${description}`, patternKey, description }
  }

  // 4. 非交互环境放行（不阻塞智能体，仅记录警告）
  if (!interactiveMode) {
    return {
      approved: true,
      blocked: false,
      message: `⚠️ 命令被标记为危险（${description}），但在非交互模式下已放行。请确认命令安全性。`,
      patternKey,
      description,
    }
  }

  // 5. 交互式环境 + 有回调 → IPC 审批
  if (approvalCallback) {
    const action = await approvalCallback(command, description, sessionKey)
    switch (action) {
      case 'approve':
        return { approved: true, blocked: false, message: `命令已批准：${description}`, patternKey, description }
      case 'approve_session':
        approveSession(sessionKey, patternKey)
        return { approved: true, blocked: false, message: `命令已批准（本次会话有效）：${description}`, patternKey, description }
      case 'approve_permanent':
        approvePermanent(patternKey)
        return { approved: true, blocked: false, message: `命令已永久批准：${description}`, patternKey, description }
      case 'yolo':
        enableSessionYolo(sessionKey)
        return { approved: true, blocked: false, message: '已启用 YOLO 模式，后续命令不再检查', patternKey, description }
      case 'reject':
      default:
        return { approved: false, blocked: true, message: `命令被拒绝：${description}`, patternKey, description }
    }
  }

  // 6. 交互式环境 + 无回调 → 拒绝（降级到旧行为）
  return {
    approved: false,
    blocked: true,
    message: `命令被拒绝：${description}。Nexus 桌面版暂不支持交互式审批，请使用安全命令或在代码中移除该拦截规则。`,
    patternKey,
    description,
  }
}
