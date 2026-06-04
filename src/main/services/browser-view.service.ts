/**
 * BrowserView 服务
 *
 * 管理 Electron WebContentsView 实例的生命周期：
 * - 每个浏览器面板包含多个标签，每个标签对应一个独立的 WebContentsView
 * - 同面板内标签间共享 session（面板独立的 session 分区）
 * - 不同面板间 session 完全隔离，互不影响
 * - 支持创建标签、移除标签、切换活动标签
 * - 监听导航、标题更新等事件，事件携带 tabId 用于区分来源
 */

import { WebContentsView, BrowserWindow, session } from 'electron'
import { IPC_CHANNELS } from '../../core/constants/ipc-channels'
import { normalizeUrl } from '../../core/utils/url'
import type { BrowserAction } from '../../core/types/browser-tool'

/**
 * 单个标签的 View 信息
 */
interface TabView {
  view: WebContentsView
  tabId: string
  /** 清理函数集合，用于移除事件监听器 */
  cleanup: Array<() => void>
  // ===== Nexus 锁定相关 =====
  /** 是否处于锁定状态 */
  locked: boolean
  /** insertCSS 返回的 key，用于解锁时移除注入的 CSS */
  lockCssKey: string | null
  /** before-input-event 键盘拦截处理器引用，用于解锁时移除 */
  lockInputHandler: ((event: Electron.Event, input: Electron.Input) => void) | null
  /** did-navigate 重新注入处理器清理函数集合 */
  lockNavHandlers: Array<() => void>
}

/**
 * 浏览器面板实例
 * 一个面板包含多个标签（WebContentsView）
 */
interface BrowserInstance {
  browserId: string
  window: BrowserWindow
  views: Map<string, TabView> // tabId -> TabView
  activeTabId: string | null // 当前显示的标签
  session: Electron.Session // 面板独立的 session 分区
}

/**
 * BrowserView 服务（单例）
 */
export class BrowserViewService {
  private static instance: BrowserViewService | null = null

  /** 活跃的浏览器面板实例 */
  private browsers = new Map<string, BrowserInstance>()

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): BrowserViewService {
    if (!BrowserViewService.instance) {
      BrowserViewService.instance = new BrowserViewService()
    }
    return BrowserViewService.instance
  }

  // ==================== 面板级操作 ====================

  /**
   * 创建浏览器面板实例（不含任何 View）
   * @param browserId - 面板唯一标识符
   * @param window - 主窗口引用
   */
  createBrowserPanel(browserId: string, window: BrowserWindow): void {
    // 如果已存在，先销毁
    const existing = this.browsers.get(browserId)
    if (existing) {
      this.destroyBrowserPanel(browserId)
    }

    // 为每个面板创建独立的 session 分区，实现面板间隔离
    const panelSession = session.fromPartition(`persist:browser-${browserId}`)

    this.browsers.set(browserId, {
      browserId,
      window,
      views: new Map(),
      activeTabId: null,
      session: panelSession,
    })
  }

  /**
   * 获取浏览器面板实例
   */
  getBrowser(browserId: string): BrowserInstance | undefined {
    return this.browsers.get(browserId)
  }

  /**
   * 获取指定面板当前活动标签 ID
   * 用于智能体浏览器工具：始终操作用户正在查看的标签
   */
  getActiveTabId(browserId: string): string | null {
    const instance = this.browsers.get(browserId)
    return instance?.activeTabId ?? null
  }

  /**
   * 销毁整个浏览器面板及其所有标签
   */
  destroyBrowserPanel(browserId: string): void {
    const instance = this.browsers.get(browserId)
    if (!instance) {
      return
    }

    // 移除所有 View
    for (const tabView of instance.views.values()) {
      try {
        instance.window.contentView.removeChildView(tabView.view)
      } catch {
        // 可能已被移除
      }
      tabView.view.webContents.stop()
      tabView.view.webContents.close()
    }

    this.browsers.delete(browserId)
  }

  // ==================== 标签级操作 ====================

  /**
   * 在浏览器面板中创建一个新标签（WebContentsView）
   * @param browserId - 面板 ID
   * @param tabId - 标签唯一 ID
   * @param bounds - View 在窗口中的位置和大小
   */
  createTab(
    browserId: string,
    tabId: string,
    bounds?: { x: number; y: number; width: number; height: number }
  ): void {
    const instance = this.browsers.get(browserId)
    if (!instance) {
      throw new Error(`浏览器面板不存在: ${browserId}`)
    }

    // 如果该 tabId 已存在，先移除
    if (instance.views.has(tabId)) {
      this.removeTab(browserId, tabId)
    }

    // 设置默认 bounds
    const finalBounds = bounds || (() => {
      const contentBounds = instance.window.getContentBounds()
      return { x: 0, y: 0, width: contentBounds.width, height: contentBounds.height }
    })()

    // 使用面板独立的 session 分区，同面板内标签间共享，不同面板间完全隔离
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        session: instance.session,
      },
    })

    view.setBounds(finalBounds)

    // 如果是第一个标签，设为活动标签并添加到窗口
    if (instance.activeTabId === null) {
      instance.activeTabId = tabId
      instance.window.contentView.addChildView(view)
    }
    // 否则只创建不显示（隐藏状态）

    // 收集事件监听器的清理函数
    const cleanup: Array<() => void> = []

    // 监听导航事件
    const onDidStartNavigation = (_event: Electron.Event, url: string) => {
      instance.window.webContents.send(IPC_CHANNELS.BROWSER_NAVIGATING, { browserId, tabId, url })
    }
    view.webContents.on('did-start-navigation', onDidStartNavigation)
    cleanup.push(() => view.webContents.removeListener('did-start-navigation', onDidStartNavigation))

    const onDidNavigate = (_event: Electron.Event, url: string) => {
      instance.window.webContents.send(IPC_CHANNELS.BROWSER_DID_NAVIGATE, { browserId, tabId, url })
    }
    view.webContents.on('did-navigate', onDidNavigate)
    cleanup.push(() => view.webContents.removeListener('did-navigate', onDidNavigate))

    const onDidNavigateInPage = (_event: Electron.Event, url: string) => {
      instance.window.webContents.send(IPC_CHANNELS.BROWSER_DID_NAVIGATE_IN_PAGE, { browserId, tabId, url })
    }
    view.webContents.on('did-navigate-in-page', onDidNavigateInPage)
    cleanup.push(() => view.webContents.removeListener('did-navigate-in-page', onDidNavigateInPage))

    const onPageTitleUpdated = (_event: Electron.Event, title: string) => {
      instance.window.webContents.send(IPC_CHANNELS.BROWSER_PAGE_TITLE_UPDATED, { browserId, tabId, title })
    }
    view.webContents.on('page-title-updated', onPageTitleUpdated)
    cleanup.push(() => view.webContents.removeListener('page-title-updated', onPageTitleUpdated))

    const onPageFaviconUpdated = (_event: Electron.Event, favicons: string[]) => {
      instance.window.webContents.send(IPC_CHANNELS.BROWSER_PAGE_FAVICON_UPDATED, { browserId, tabId, favicons })
    }
    view.webContents.on('page-favicon-updated', onPageFaviconUpdated)
    cleanup.push(() => view.webContents.removeListener('page-favicon-updated', onPageFaviconUpdated))

    // 监听右键菜单事件，转发坐标给渲染进程（锁定时跳过）
    const onContextMenu = (_event: Electron.Event, params: Electron.ContextMenuParams) => {
      const tv = instance.views.get(tabId)
      if (tv?.locked) return  // 锁定时不发送右键菜单事件
      const viewBounds = view.getBounds()
      instance.window.webContents.send(IPC_CHANNELS.BROWSER_CONTEXT_MENU, {
        browserId,
        tabId,
        x: Math.round(viewBounds.x + params.x),
        y: Math.round(viewBounds.y + params.y),
      })
    }
    view.webContents.on('context-menu', onContextMenu)
    cleanup.push(() => view.webContents.removeListener('context-menu', onContextMenu))

    // 拦截 window.open() 请求，改为在当前面板内新建标签
    view.webContents.setWindowOpenHandler((details) => {
      return this.handleWindowOpen(instance, tabId, details)
    })

    instance.views.set(tabId, {
      view, tabId, cleanup,
      locked: false, lockCssKey: null, lockInputHandler: null, lockNavHandlers: []
    })
  }

  /**
   * 移除指定标签
   * @param browserId - 面板 ID
   * @param tabId - 标签 ID
   */
  removeTab(browserId: string, tabId: string): void {
    const instance = this.browsers.get(browserId)
    if (!instance) {
      return
    }

    const tabView = instance.views.get(tabId)
    if (!tabView) {
      return
    }

    // 如果是活动标签，先隐藏它
    if (instance.activeTabId === tabId) {
      try {
        instance.window.contentView.removeChildView(tabView.view)
      } catch {
        // 可能已被移除
      }
    }

    // 显式移除所有事件监听器，防止 webContents.close() 前产生泄漏
    for (const fn of tabView.cleanup) {
      fn()
    }

    tabView.view.webContents.stop()
    tabView.view.webContents.close()
    instance.views.delete(tabId)

    // 如果活动标签被移除，需要重新指定
    if (instance.activeTabId === tabId) {
      instance.activeTabId = instance.views.size > 0 ? Array.from(instance.views.keys())[0] : null
      // 如果有剩余标签，显示新的活动标签
      if (instance.activeTabId) {
        const newActive = instance.views.get(instance.activeTabId)
        if (newActive) {
          instance.window.contentView.addChildView(newActive.view)
        }
      }
    }

  }

  /**
   * 切换活动标签
   * @param browserId - 面板 ID
   * @param tabId - 要切换到的标签 ID
   */
  setActiveTab(browserId: string, tabId: string): void {
    const instance = this.browsers.get(browserId)
    if (!instance) {
      throw new Error(`浏览器面板不存在: ${browserId}`)
    }

    if (!instance.views.has(tabId)) {
      throw new Error(`标签不存在: ${browserId} / ${tabId}`)
    }

    if (instance.activeTabId === tabId) {
      return // 已经是活动标签
    }

    // 隐藏当前活动 View
    const oldTab = instance.activeTabId ? instance.views.get(instance.activeTabId) : null
    if (oldTab) {
      try {
        instance.window.contentView.removeChildView(oldTab.view)
      } catch {
        // 可能已被移除
      }
    }

    // 显示新标签 View
    const newTab = instance.views.get(tabId)!
    instance.window.contentView.addChildView(newTab.view)
    instance.activeTabId = tabId
  }

  // ==================== 导航操作 ====================

  /**
   * 导航到指定 URL
   */
  async navigate(browserId: string, tabId: string, url: string): Promise<void> {
    if (!this.isTabAlive(browserId, tabId)) return
    const tabView = this.getTabView(browserId, tabId)

    const targetUrl = normalizeUrl(url)
    if (!targetUrl) return

    await tabView.view.webContents.loadURL(targetUrl)
  }

  /**
   * 后退
   */
  goBack(browserId: string, tabId: string): void {
    if (!this.isTabAlive(browserId, tabId)) return
    const tabView = this.getTabView(browserId, tabId)
    if (tabView.view.webContents.canGoBack()) {
      tabView.view.webContents.goBack()
    }
  }

  /**
   * 前进
   */
  goForward(browserId: string, tabId: string): void {
    if (!this.isTabAlive(browserId, tabId)) return
    const tabView = this.getTabView(browserId, tabId)
    if (tabView.view.webContents.canGoForward()) {
      tabView.view.webContents.goForward()
    }
  }

  reload(browserId: string, tabId: string): void {
    if (!this.isTabAlive(browserId, tabId)) return
    const tabView = this.getTabView(browserId, tabId)
    tabView.view.webContents.reload()
  }

  stop(browserId: string, tabId: string): void {
    if (!this.isTabAlive(browserId, tabId)) return
    const tabView = this.getTabView(browserId, tabId)
    tabView.view.webContents.stop()
  }

  getUrl(browserId: string, tabId: string): string {
    if (!this.isTabAlive(browserId, tabId)) return ''
    const tabView = this.getTabView(browserId, tabId)
    return tabView.view.webContents.getURL()
  }

  getTitle(browserId: string, tabId: string): string {
    if (!this.isTabAlive(browserId, tabId)) return ''
    const tabView = this.getTabView(browserId, tabId)
    return tabView.view.webContents.getTitle()
  }

  /**
   * 是否可以后退
   */
  canGoBack(browserId: string, tabId: string): boolean {
    if (!this.isTabAlive(browserId, tabId)) return false
    return this.tryGetTabView(browserId, tabId)!.view.webContents.canGoBack()
  }

  /**
   * 是否可以前进
   */
  canGoForward(browserId: string, tabId: string): boolean {
    if (!this.isTabAlive(browserId, tabId)) return false
    return this.tryGetTabView(browserId, tabId)!.view.webContents.canGoForward()
  }

  // ==================== 智能体浏览器操控 ====================

  /**
   * 点击页面元素
   * @param browserId - 面板 ID
   * @param tabId - 标签 ID
   * @param selector - CSS 选择器
   */
  async clickElement(browserId: string, tabId: string, selector: string): Promise<{ success: boolean; message: string }> {
    if (!this.isTabAlive(browserId, tabId)) return { success: false, message: '标签不存在或已销毁' }
    const tabView = this.getTabView(browserId, tabId)
    try {
      // 转义 selector 中的单引号和反斜杠，防止注入
      const safeSelector = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      const result = await tabView.view.webContents.executeJavaScript(`
        (function() {
          try {
            const el = document.querySelector('${safeSelector}');
            if (!el) return { success: false, message: '未找到匹配的元素: ${safeSelector}' };
            // 确保元素可见
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || rect.width === 0 || rect.height === 0) {
              return { success: false, message: '元素不可见: ${safeSelector}' };
            }
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return new Promise(function(resolve) {
              setTimeout(function() {
                el.click();
                resolve({ success: true, message: '已点击元素: ' + (el.textContent ? el.textContent.trim().slice(0, 50) : el.tagName) });
              }, 100);
            });
          } catch(e) {
            return { success: false, message: '选择器语法错误: ' + e.message };
          }
        })()
      `)
      return result
    } catch (error: any) {
      return { success: false, message: `点击失败: ${error.message}` }
    }
  }

  /**
   * 在输入框输入文本
   * @param browserId - 面板 ID
   * @param tabId - 标签 ID
   * @param selector - CSS 选择器
   * @param text - 要输入的文本
   */
  async typeText(browserId: string, tabId: string, selector: string, text: string): Promise<{ success: boolean; message: string }> {
    if (!this.isTabAlive(browserId, tabId)) return { success: false, message: '标签不存在或已销毁' }
    const tabView = this.getTabView(browserId, tabId)
    try {
      // 使用 JSON.stringify 安全转义，防止 XSS 注入
      const selectorJson = JSON.stringify(selector)
      const textJson = JSON.stringify(text)
      const result = await tabView.view.webContents.executeJavaScript(`
        (function() {
          const el = document.querySelector(${selectorJson});
          if (!el) return { success: false, message: '未找到匹配的输入元素: ' + ${selectorJson} };
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus();
          el.value = ${textJson};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, message: '已在元素中输入: ' + ${textJson}.slice(0, 50) };
        })()
      `)
      return result
    } catch (error: any) {
      return { success: false, message: `输入失败: ${error.message}` }
    }
  }

  /**
   * 滚动页面
   * @param browserId - 面板 ID
   * @param tabId - 标签 ID
   * @param direction - 滚动方向
   * @param amount - 滚动像素量，默认 300
   */
  async scrollPage(
    browserId: string,
    tabId: string,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number = 300
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isTabAlive(browserId, tabId)) return { success: false, message: '标签不存在或已销毁' }
    const tabView = this.getTabView(browserId, tabId)
    try {
      const scrollAmount = direction === 'down' || direction === 'right' ? amount : -amount
      const scrollFn = direction === 'left' || direction === 'right' ? 'scrollByX' : 'scrollBy'
      const result = await tabView.view.webContents.executeJavaScript(`
        (function() {
          window.scrollBy(0, ${scrollAmount});
          return { success: true, message: '已${direction === 'up' ? '上' : direction === 'down' ? '下' : direction === 'left' ? '左' : '右'}滚动 ${amount}px' };
        })()
      `)
      return result
    } catch (error: any) {
      return { success: false, message: `滚动失败: ${error.message}` }
    }
  }

  /**
   * 获取页面可见文本内容
   * @param browserId - 面板 ID
   * @param tabId - 标签 ID
   */
  async getPageContent(browserId: string, tabId: string): Promise<{ success: boolean; content: string; message: string }> {
    if (!this.isTabAlive(browserId, tabId)) return { success: false, content: '', message: '标签不存在或已销毁' }
    const tabView = this.getTabView(browserId, tabId)
    try {
      const content = await tabView.view.webContents.executeJavaScript(`
        (function() {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: function(node) {
              const parent = node.parentElement;
              if (!parent) return NodeFilter.FILTER_REJECT;
              const style = window.getComputedStyle(parent);
              if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            }
          });
          const texts = [];
          let node;
          while (node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (text && text.length > 0) {
              texts.push(text);
            }
          }
          return texts.join('\\n').slice(0, 20000);
        })()
      `)
      return { success: true, content, message: '已获取页面内容' }
    } catch (error: any) {
      return { success: false, content: '', message: `获取内容失败: ${error.message}` }
    }
  }

  /**
   * 获取页面关键元素结构（交互元素和标题）
   * @param browserId - 面板 ID
   * @param tabId - 标签 ID
   */
  async getPageStructure(browserId: string, tabId: string): Promise<{ success: boolean; structure: string; message: string }> {
    if (!this.isTabAlive(browserId, tabId)) return { success: false, structure: '', message: '标签不存在或已销毁' }
    const tabView = this.getTabView(browserId, tabId)
    try {
      const structure = await tabView.view.webContents.executeJavaScript(`
        (function() {
          const elements = document.querySelectorAll('a, button, input, textarea, select, h1, h2, h3');
          const items = [];
          elements.forEach((el, i) => {
            if (i > 200) return;
            const tag = el.tagName.toLowerCase();
            const text = (el.textContent || '').trim().slice(0, 80);
            const id = el.id ? '#' + el.id : '';
            const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
            const rect = el.getBoundingClientRect();
            const visible = rect.width > 0 && rect.height > 0;
            if (visible) {
              items.push('[' + (i + 1) + '] ' + tag + id + cls + ' - "' + text + '"');
            }
          });
          return items.join('\\n');
        })()
      `)
      return { success: true, structure, message: '已获取页面结构' }
    } catch (error: any) {
      return { success: false, structure: '', message: `获取结构失败: ${error.message}` }
    }
  }

  /**
   * 获取指定元素信息
   * @param browserId - 面板 ID
   * @param tabId - 标签 ID
   * @param selector - CSS 选择器
   */
  async getElementInfo(browserId: string, tabId: string, selector: string): Promise<{ success: boolean; info: string; message: string }> {
    if (!this.isTabAlive(browserId, tabId)) return { success: false, info: '', message: '标签不存在或已销毁' }
    const tabView = this.getTabView(browserId, tabId)
    try {
      const safeSelector = selector.replace(/'/g, "\\'")
      const info = await tabView.view.webContents.executeJavaScript(`
        (function() {
          const el = document.querySelector('${safeSelector}');
          if (!el) return { success: false, info: '', message: '未找到匹配的元素: ${safeSelector}' };
          const rect = el.getBoundingClientRect();
          const attrs = {};
          for (const attr of el.attributes) {
            attrs[attr.name] = attr.value;
          }
          const result = {
            tag: el.tagName.toLowerCase(),
            id: el.id,
            className: el.className,
            text: (el.textContent || '').trim().slice(0, 200),
            visible: rect.width > 0 && rect.height > 0,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
            attributes: attrs,
          };
          return { success: true, info: JSON.stringify(result, null, 2), message: '已获取元素信息' };
        })()
      `)
      return info
    } catch (error: any) {
      return { success: false, info: '', message: `获取元素信息失败: ${error.message}` }
    }
  }

  /**
   * 等待页面加载完成
   * @param browserId - 面板 ID
   * @param tabId - 标签 ID
   * @param timeout - 超时时间（毫秒），默认 10000
   */
  async waitForPage(browserId: string, tabId: string, timeout: number = 10000): Promise<{ success: boolean; message: string }> {
    if (!this.isTabAlive(browserId, tabId)) return { success: false, message: '标签不存在或已销毁' }
    const tabView = this.getTabView(browserId, tabId)
    try {
      const result = await tabView.view.webContents.executeJavaScript(`
        (function() {
          return new Promise((resolve) => {
            if (document.readyState === 'complete') {
              resolve({ success: true, message: '页面已加载完成' });
              return;
            }
            const timer = setTimeout(() => {
              resolve({ success: true, message: '等待超时，但页面可能仍在加载' });
            }, ${timeout});
            window.addEventListener('load', () => {
              clearTimeout(timer);
              resolve({ success: true, message: '页面加载完成' });
            });
          });
        })()
      `)
      return result
    } catch (error: any) {
      return { success: false, message: `等待页面加载失败: ${error.message}` }
    }
  }

  // ==================== Nexus 锁定 ====================

  /**
   * 注入到 WebContentsView 的 CSS（禁用所有用户交互）
   * - pointer-events: none 阻止命中测试（快速拦截层）
   * - user-select: none 阻止文本选择
   * - -webkit-user-drag: none 阻止拖拽
   *
   * 注意：不使用 html::after 全屏遮罩，避免高 z-index 弹窗渲染异常。
   * 交互拦截由 LOCK_JS（window 捕获阶段）和 before-input-event 负责。
   */
  private static readonly LOCK_CSS = `
*, *::before, *::after {
  pointer-events: none !important;
  user-select: none !important;
  -webkit-user-drag: none !important;
}
`

  /**
   * 注入到 WebContentsView 的 JS（在 window 捕获阶段拦截所有事件）
   * 覆盖 iframe、Shadow DOM 等 CSS 无法完全覆盖的场景
   */
  private static readonly LOCK_JS = `
(function() {
  if (window.__nexusLocked) return;
  window.__nexusLocked = true;
  var handler = function(e) {
    if (!window.__nexusLocked) return;
    e.stopPropagation();
    e.preventDefault();
  };
  var events = [
    'mousedown','mouseup','click','dblclick','contextmenu',
    'keydown','keyup','keypress',
    'touchstart','touchend','touchmove',
    'pointerdown','pointerup','wheel'
  ];
  for (var i = 0; i < events.length; i++) {
    window.addEventListener(events[i], handler, { capture: true });
  }
})();
`

  /**
   * 锁定标签：注入 CSS + JS 阻止所有用户交互
   * 智能体通过 API 操作不受影响
   *
   * 三层防护：
   * 1. insertCSS — pointer-events:none（CSS 层命中测试拦截）
   * 2. executeJavaScript — window 捕获阶段事件拦截（覆盖 iframe/Shadow DOM）
   * 3. before-input-event — webContents 级别键盘拦截
   */
  async lockTab(browserId: string, tabId: string): Promise<void> {
    if (!this.isTabAlive(browserId, tabId)) return
    const tabView = this.getTabView(browserId, tabId)
    if (tabView.locked) return

    tabView.locked = true

    // 第1层：注入 CSS
    try {
      tabView.lockCssKey = await tabView.view.webContents.insertCSS(BrowserViewService.LOCK_CSS)
    } catch {
      // 页面可能正在加载，忽略
    }

    // 第2层：注入 JS 事件拦截
    try {
      await tabView.view.webContents.executeJavaScript(BrowserViewService.LOCK_JS)
    } catch {
      // 忽略
    }

    // 第3层：before-input-event 键盘拦截
    const inputHandler = (event: Electron.Event) => {
      if (tabView.locked) event.preventDefault()
    }
    tabView.view.webContents.on('before-input-event', inputHandler)
    tabView.lockInputHandler = inputHandler

    // 注册 did-navigate 重新注入（整页导航会清除 insertCSS 和 JS）
    const reInject = () => {
      if (!tabView.locked) return
      // 重新注入 CSS
      tabView.view.webContents.insertCSS(BrowserViewService.LOCK_CSS)
        .then(key => { tabView.lockCssKey = key })
        .catch(() => {})
      // 重新注入 JS
      tabView.view.webContents.executeJavaScript(BrowserViewService.LOCK_JS)
        .catch(() => {})
    }

    const onNavigate = () => reInject()
    const onNavigateInPage = () => reInject()
    tabView.view.webContents.on('did-navigate', onNavigate)
    tabView.view.webContents.on('did-navigate-in-page', onNavigateInPage)

    // 保存清理函数
    tabView.lockNavHandlers = [
      () => tabView.view.webContents.removeListener('did-navigate', onNavigate),
      () => tabView.view.webContents.removeListener('did-navigate-in-page', onNavigateInPage),
    ]
  }

  /**
   * 解锁标签：移除注入的 CSS/JS 和事件拦截器
   */
  unlockTab(browserId: string, tabId: string): void {
    if (!this.isTabAlive(browserId, tabId)) return
    const tabView = this.getTabView(browserId, tabId)
    if (!tabView.locked) return

    tabView.locked = false

    // 移除 CSS
    if (tabView.lockCssKey) {
      try {
        tabView.view.webContents.removeInsertedCSS(tabView.lockCssKey)
      } catch {
        // 可能页面已卸载
      }
      tabView.lockCssKey = null
    }

    // 关闭 JS 拦截标志
    tabView.view.webContents.executeJavaScript('window.__nexusLocked = false')
      .catch(() => {})

    // 移除 before-input-event 处理器
    if (tabView.lockInputHandler) {
      tabView.view.webContents.removeListener('before-input-event', tabView.lockInputHandler)
      tabView.lockInputHandler = null
    }

    // 移除 did-navigate 重新注入处理器
    for (const cleanup of tabView.lockNavHandlers) {
      cleanup()
    }
    tabView.lockNavHandlers = []
  }

  // ==================== 布局和快照 ====================

  /**
   * 更新指定标签的 bounds
   */
  setBounds(browserId: string, tabId: string, bounds: { x: number; y: number; width: number; height: number }): void {
    const instance = this.browsers.get(browserId)
    if (!instance) {
      return
    }

    // 更新所有标签的 bounds（保持一致）
    for (const tabView of instance.views.values()) {
      tabView.view.setBounds(bounds)
    }
  }

  /**
   * 截取指定标签的快照
   *
   * 修复：
   * 1. 截图前检查 bounds，为 0 时先恢复再截图（否则 capturePage 可能永不 resolve）
   * 2. 加 60 秒超时保护，防止卡死
   */
  async capturePage(browserId: string, tabId: string): Promise<string> {
    if (!this.isTabAlive(browserId, tabId)) return ''
    const tabView = this.getTabView(browserId, tabId)

    // 检查当前 bounds，若为 0（被隐藏），先恢复再截图
    const currentBounds = tabView.view.getBounds()
    let restoredBounds: { x: number; y: number; width: number; height: number } | null = null
    if (currentBounds.width === 0 || currentBounds.height === 0) {
      const instance = this.browsers.get(browserId)
      if (instance) {
        const windowBounds = instance.window.getContentBounds()
        restoredBounds = {
          x: 0,
          y: 0,
          width: windowBounds.width,
          height: windowBounds.height,
        }
        tabView.view.setBounds(restoredBounds)
      }
    }

    try {
      // 60 秒超时保护
      const nativeImage = await Promise.race([
        tabView.view.webContents.capturePage(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('capturePage 超时（60秒）')), 60000)
        ),
      ])
      return nativeImage.toDataURL()
    } finally {
      // 截图完成后，如果之前恢复了 bounds，重新隐藏（设回 0）
      if (restoredBounds) {
        tabView.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      }
    }
  }

  /**
   * 清理所有浏览器面板
   */
  dispose(): void {
    const browserIds = Array.from(this.browsers.keys())
    for (const id of browserIds) {
      this.destroyBrowserPanel(id)
    }
    this.browsers.clear()
  }

  /**
   * 获取活跃面板数量（调试用）
   */
  getActiveCount(): number {
    return this.browsers.size
  }

  /**
   * 获取指定面板的标签数量（调试用）
   */
  getTabCount(browserId: string): number {
    const instance = this.browsers.get(browserId)
    return instance ? instance.views.size : 0
  }

  // ==================== 内部方法 ====================

  /**
   * 处理 window.open() 拦截：在当前面板内创建新标签并导航
   * @param instance - 浏览器面板实例
   * @param sourceTabId - 发起 window.open 的源标签 ID
   * @param details - 窗口打开详情
   */
  private handleWindowOpen(
    instance: BrowserInstance,
    sourceTabId: string,
    details: Electron.HandlerDetails
  ): { action: 'deny' } {
    const newTabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // 先在主进程创建新标签的 View（隐藏状态）
    const contentBounds = instance.window.getContentBounds()
    this.createTab(instance.browserId, newTabId, {
      x: 0, y: 0,
      width: contentBounds.width,
      height: contentBounds.height,
    })

    // 导航到目标 URL
    const newTabView = instance.views.get(newTabId)
    if (newTabView) {
      newTabView.view.webContents.loadURL(details.url).catch(err => {
        console.error('[BrowserViewService] window.open 导航失败:', err)
      })
    }

    // View 就绪后通知渲染进程注册到 store
    instance.window.webContents.send(IPC_CHANNELS.BROWSER_WINDOW_OPEN, {
      browserId: instance.browserId,
      sourceTabId,
      newTabId,
      url: details.url,
      name: details.frameName || '',
      disposition: details.disposition,
    })

    // foreground-tab、default、new-window 都切换到新标签
    // new-window: window.open() 带 features 参数时产生
    if (
      details.disposition === 'foreground-tab' ||
      details.disposition === 'default' ||
      details.disposition === 'new-window'
    ) {
      this.setActiveTab(instance.browserId, newTabId)
    }

    // 如果源标签处于 Nexus 锁定状态，自动锁定新标签
    const sourceTabView = instance.views.get(sourceTabId)
    if (sourceTabView?.locked) {
      this.lockTab(instance.browserId, newTabId).catch(() => {})
    }

    return { action: 'deny' }
  }

  /**
   * 获取指定标签的 TabView
   */
  private getTabView(browserId: string, tabId: string): TabView {
    const instance = this.browsers.get(browserId)
    if (!instance) {
      throw new Error(`浏览器面板不存在: ${browserId}`)
    }

    const tabView = instance.views.get(tabId)
    if (!tabView) {
      throw new Error(`标签不存在: ${browserId} / ${tabId}`)
    }

    return tabView
  }

  /**
   * 安全获取指定标签的 TabView（面板不存在时返回 null，不抛异常）
   * 用于查询类方法（如 canGoBack/canGoForward），避免启动时序问题导致报错
   */
  private tryGetTabView(browserId: string, tabId: string): TabView | null {
    const instance = this.browsers.get(browserId)
    if (!instance) return null

    return instance.views.get(tabId) || null
  }

  /**
   * 检查标签是否存活（存在且 webContents 未被销毁）
   */
  private isTabAlive(browserId: string, tabId: string): boolean {
    const tabView = this.tryGetTabView(browserId, tabId)
    return tabView !== null && !tabView.view.webContents.isDestroyed()
  }
}
