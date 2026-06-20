/**
 * 浏览器工具
 *
 * 智能体操控浏览器的工具。当 Nexus 连接到浏览器面板时，
 * 智能体可以通过此工具执行导航、点击、输入、滚动、截图等操作。
 * 用户在浏览器面板中实时看到操作效果。
 */

import { ToolDefinition, ToolResult } from '../../../core/types/agent'
import { NexusConnectionManager } from '../../services/nexus-connection-manager'
import { BrowserViewService } from '../../services/browser-view.service'

const browserService = () => BrowserViewService.getInstance()
const nexusManager = () => NexusConnectionManager.getInstance()

export const browserTool: ToolDefinition = {
  name: 'browser',
  description:
    'Control the connected browser panel. Actions: navigate, click, type, scroll, screenshot, getPageContent, getPageStructure, getElementInfo, wait, goBack, goForward, reload. Requires Nexus connection to a browser panel.\n\n'
    + 'IMPORTANT: For single-page applications (SPA) like Vue/React/Angular apps, ALWAYS prefer UI interaction over URL navigation. Use getPageStructure first to discover available clickable elements, then use their CSS selectors to click them. The navigate action may not work reliably with SPA routing.\n\n'
    + 'IMPORTANT: If a click or type action fails 2+ times with the same intent, STOP retrying the same selector. Instead: (1) call getPageStructure to re-examine available elements, (2) use screenshot to see the current visual state, (3) try a different selector strategy such as aria-label, role attributes, or positional selectors. Avoid CSS module hashed class names — they are unstable.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'navigate', 'click', 'type', 'scroll', 'screenshot',
          'getPageContent', 'getPageStructure', 'getElementInfo',
          'wait', 'goBack', 'goForward', 'reload',
        ],
        description: 'The browser action to perform',
      },
      url: {
        type: 'string',
        description: 'URL to navigate to (for "navigate" action)',
      },
      selector: {
        type: 'string',
        description: 'CSS selector for target element (for "click", "type", "getElementInfo" actions)',
      },
      text: {
        type: 'string',
        description: 'Text to type into an input element (for "type" action)',
      },
      direction: {
        type: 'string',
        enum: ['up', 'down', 'left', 'right'],
        description: 'Scroll direction (for "scroll" action)',
      },
      amount: {
        type: 'number',
        description: 'Scroll amount in pixels (for "scroll" action, default 300)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (for "wait" action, default 10000)',
      },
    },
    required: ['action'],
  },
  checkFn: async () => {
    return nexusManager().isBrowserConnected()
  },
  handler: async (args: Record<string, any>): Promise<ToolResult> => {
    const connection = nexusManager().getBrowserConnection()
    if (!connection) {
      return {
        success: false,
        output: 'Error: Nexus is not connected to a browser panel.',
        data: { error: 'no_browser_connection' },
      }
    }

    const { browserId, tabId } = connection
    if (!browserId || !tabId) {
      return {
        success: false,
        output: 'Error: Browser connection is incomplete.',
        data: { error: 'incomplete_connection' },
      }
    }

    const bs = browserService()
    const action = args.action as string

    try {
      switch (action) {
        case 'navigate': {
          if (!args.url) {
            return { success: false, output: 'Error: "url" parameter is required for navigate action.', data: {} }
          }
          await bs.navigate(browserId, tabId, args.url)
          const title = bs.getTitle(browserId, tabId)
          return {
            success: true,
            output: `Navigated to: ${args.url}\nPage title: ${title}`,
            data: { url: args.url, title },
          }
        }

        case 'click': {
          if (!args.selector) {
            return { success: false, output: 'Error: "selector" parameter is required for click action.', data: {} }
          }
          const result = await bs.clickElement(browserId, tabId, args.selector)
          let output = result.message
          if (!result.success) {
            output += '\n\nTIP: If this action has failed multiple times, try: (1) use getPageStructure to find correct selectors, (2) use screenshot to see the current visual state, (3) prefer aria-label, role, or tag-based selectors over CSS module hashed class names.'
          }
          return {
            success: result.success,
            output,
            data: { selector: args.selector },
          }
        }

        case 'type': {
          if (!args.selector || !args.text) {
            return { success: false, output: 'Error: "selector" and "text" parameters are required for type action.', data: {} }
          }
          const result = await bs.typeText(browserId, tabId, args.selector, args.text)
          return {
            success: result.success,
            output: result.message,
            data: { selector: args.selector, textLength: args.text.length },
          }
        }

        case 'scroll': {
          const direction = args.direction || 'down'
          const amount = args.amount || 300
          const result = await bs.scrollPage(browserId, tabId, direction, amount)
          return {
            success: result.success,
            output: result.message,
            data: { direction, amount },
          }
        }

        case 'screenshot': {
          const dataUrl = await bs.capturePage(browserId, tabId)
          if (!dataUrl) {
            return {
              success: false,
              output: 'Screenshot failed: tab not available or capture returned empty.',
              data: {},
            }
          }
          const preview = dataUrl.slice(0, 100) + '...(base64 image data)'
          return {
            success: true,
            output: `Screenshot captured. Data URL preview: ${preview}`,
            data: { imageData: dataUrl },
          }
        }

        case 'getPageContent': {
          const result = await bs.getPageContent(browserId, tabId)
          return {
            success: result.success,
            output: result.success ? result.content : result.message,
            data: {},
          }
        }

        case 'getPageStructure': {
          const result = await bs.getPageStructure(browserId, tabId)
          return {
            success: result.success,
            output: result.success ? result.structure : result.message,
            data: {},
          }
        }

        case 'getElementInfo': {
          if (!args.selector) {
            return { success: false, output: 'Error: "selector" parameter is required for getElementInfo action.', data: {} }
          }
          const result = await bs.getElementInfo(browserId, tabId, args.selector)
          return {
            success: result.success,
            output: result.success ? result.info : result.message,
            data: { selector: args.selector },
          }
        }

        case 'wait': {
          const timeout = args.timeout || 10000
          const result = await bs.waitForPage(browserId, tabId, timeout)
          return {
            success: result.success,
            output: result.message,
            data: { timeout },
          }
        }

        case 'goBack': {
          bs.goBack(browserId, tabId)
          return { success: true, output: 'Navigated back', data: {} }
        }

        case 'goForward': {
          bs.goForward(browserId, tabId)
          return { success: true, output: 'Navigated forward', data: {} }
        }

        case 'reload': {
          bs.reload(browserId, tabId)
          return { success: true, output: 'Page reloaded', data: {} }
        }

        default:
          return {
            success: false,
            output: `Error: Unknown browser action "${action}". Supported actions: navigate, click, type, scroll, screenshot, getPageContent, getPageStructure, getElementInfo, wait, goBack, goForward, reload.`,
            data: { error: 'unknown_action' },
          }
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Browser action "${action}" failed: ${error.message}`,
        data: { error: error.message },
      }
    }
  },
}
