/**
 * 应用面板共享命令工具（Linux/Windows 后端共用）
 *
 * 两个后端的启动命令（exec）都是"归一化整串"语义：
 * - Linux：.desktop 的 Exec 剥离字段码后的整串；
 * - Windows：.lnk 的 TargetPath + Arguments 拼串（目标含空格带引号）。
 * 白名单比对（isExecAllowed）与启动分词（splitExec）作用在同一字符串上。
 */

/**
 * 引号感知的命令分词（review 0.6.11 I-3）：
 * .desktop 的 Exec / .lnk 的拼串可能含带空格的引号参数（如 sh -c "foo bar"、
 * "C:\Program Files\App\app.exe" --flag），直接按空白切分会把参数拆碎，
 * 导致程序启动失败或行为异常。
 * 实现逻辑：逐字符扫描，用 quote 记录当前所处的引号类型（null=引号外）：
 * - 引号内：空白保留为同一 token 的内容，遇到同类型引号则闭合（引号本身剥离）；
 * - 引号外：遇引号进入引号态并标记 token 已开始（空引号 "" 产出空串 token）；
 *   遇空白则结束当前 token；其余字符累积。
 * 不支持反斜杠转义（freedesktop 规范中极少见；Windows 路径分隔符恰为反斜杠，
 * 若按转义处理会破坏路径，故两种平台都不启用转义语义）。
 */
export function splitExec(exec: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let started = false // 当前 token 是否已开始累积（空引号也算开始）
  let quote: string | null = null
  for (const ch of exec) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (started) { tokens.push(cur); cur = ''; started = false }
      continue
    }
    cur += ch
    started = true
  }
  if (started) tokens.push(cur)
  return tokens
}
