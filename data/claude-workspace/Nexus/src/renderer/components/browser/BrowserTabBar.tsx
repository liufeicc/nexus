/**
 * 浏览器标签条组件
 *
 * 渲染在地址栏上方，显示浏览器面板内的多个标签页。
 * 每个标签显示 favicon + 标题 + 关闭按钮，支持切换和新建。
 */

import React, { useCallback } from 'react'
import { useI18n } from '../../i18n'
import type { BrowserTab } from '@core/types'

interface BrowserTabBarProps {
  /** 浏览器面板 ID */
  panelId: string
  /** 所有标签列表 */
  tabs: BrowserTab[]
  /** 当前活动的标签 ID */
  activeTabId: string | null
  /** 切换标签 */
  onSwitchTab: (tabId: string) => void
  /** 关闭标签 */
  onCloseTab: (tabId: string) => void
  /** 新建标签 */
  onNewTab: () => void
  /** 是否处于 Nexus 锁定状态 */
  locked?: boolean
}

/**
 * 浏览器标签条组件
 */
export const BrowserTabBar: React.FC<BrowserTabBarProps> = ({
  panelId,
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onNewTab,
  locked = false,
}) => {
  const { t } = useI18n()

  /**
   * 关闭按钮点击：阻止冒泡，防止触发标签切换
   */
  const handleTabClose = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    onCloseTab(tabId)
  }, [onCloseTab])

  return (
    <div className={`browser-tab-bar${locked ? ' locked' : ''}`}>
      {/* 标签列表 */}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            className={`browser-tab${isActive ? ' active' : ''}`}
            onClick={() => !locked && onSwitchTab(tab.id)}
            title={tab.url}
          >
            {/* favicon */}
            {tab.favicon ? (
              <img
                src={tab.favicon}
                className="browser-tab-favicon"
                alt=""
              />
            ) : (
              <svg className="browser-tab-favicon-placeholder" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            )}

            {/* 标题 — 如果 tab.title 是未翻译的 i18n key，用 t() 正确翻译 */}
            <span className="browser-tab-title">
              {(() => {
                const rawTitle = tab.title
                if (!rawTitle) {
                  return tab.isLoading ? t('browser.loading') : t('browser.newTab')
                }
                // 检测是否为未翻译的 i18n key
                if (rawTitle.includes('.') && !rawTitle.includes(' ') && rawTitle.length < 40) {
                  return tab.isLoading ? t('browser.loading') : t('browser.newTab')
                }
                // 已翻译的真实标题
                return rawTitle
              })()}
            </span>

            {/* 关闭按钮 — 锁定时不显示 */}
            {!locked && (
              <span
                className="browser-tab-close"
                onClick={(e) => handleTabClose(e, tab.id)}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </span>
            )}
          </div>
        )
      })}

      {/* 新建标签按钮 — 锁定时不显示 */}
      {!locked && (
        <div
          className="browser-tab-new"
          onClick={onNewTab}
          title={t('browser.newTab')}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
        </div>
      )}
    </div>
  )
}

export default BrowserTabBar
