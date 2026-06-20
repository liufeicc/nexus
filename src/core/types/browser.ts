/**
 * 浏览器标签类型定义
 */

export interface BrowserTab {
  id: string // 标签唯一ID
  url: string // 当前URL
  title: string // 页面标题
  favicon?: string // 页面favicon base64
  isLoading: boolean // 是否加载中
}
