/**
 * 面板 ID 生成与解析工具
 *
 * 统一管理所有面板 ID 的生成格式，确保 store 和主进程使用一致的标识。
 */

/**
 * 面板 ID 前缀
 */
const PANEL_PREFIX = 'panel-'

/**
 * 生成唯一的面板 ID
 * @returns 格式为 `panel-{timestamp}` 的唯一 ID
 */
export function generatePanelId(): string {
  return `${PANEL_PREFIX}${Date.now()}`
}

/**
 * 判断一个字符串是否是有效的面板 ID
 * @param id - 待检查的字符串
 * @returns 是否是有效的面板 ID
 */
export function isValidPanelId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(PANEL_PREFIX)
}
