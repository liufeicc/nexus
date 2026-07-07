/**
 * 通用 React Error Boundary 组件
 *
 * 捕获子组件树中的 JavaScript 错误，
 * 显示友好的错误信息而不是白屏。
 */

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { t } from '../../i18n'

interface Props {
  children: ReactNode
  /** 错误发生时显示的标题 */
  errorTitle?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, errorInfo.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-title">
            {this.props.errorTitle ?? t('errorBoundary.renderError')}
          </div>
          <div className="error-boundary-message">
            {(this.state.error?.message ?? t('errorBoundary.unknownError')).slice(0, 200)}
          </div>
          <button
            className="btn btn-small"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            {t('errorBoundary.retry')}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
