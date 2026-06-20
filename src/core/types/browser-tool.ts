/**
 * 浏览器工具类型定义
 */

/**
 * 浏览器工具支持的操作类型
 */
export type BrowserAction =
  | 'navigate'       // 导航到 URL
  | 'click'          // 点击页面元素
  | 'type'           // 在输入框输入文本
  | 'scroll'         // 滚动页面
  | 'screenshot'     // 截取页面截图
  | 'getPageContent' // 获取页面可见文本内容
  | 'getPageStructure' // 获取页面关键元素结构
  | 'getElementInfo' // 获取指定元素信息
  | 'wait'           // 等待页面加载完成
  | 'goBack'         // 后退
  | 'goForward'      // 前进
  | 'reload'         // 刷新页面

/**
 * 浏览器工具调用参数
 */
export interface BrowserToolArgs {
  /** 操作类型 */
  action: BrowserAction
  /** URL（navigate 操作时使用） */
  url?: string
  /** CSS 选择器（click / type / getElementInfo 操作时使用） */
  selector?: string
  /** 输入文本（type 操作时使用） */
  text?: string
  /** 滚动方向：'up' | 'down' | 'left' | 'right'（scroll 操作时使用） */
  direction?: 'up' | 'down' | 'left' | 'right'
  /** 滚动像素量（scroll 操作时使用） */
  amount?: number
  /** 超时时间（毫秒）（wait 操作时使用） */
  timeout?: number
}
