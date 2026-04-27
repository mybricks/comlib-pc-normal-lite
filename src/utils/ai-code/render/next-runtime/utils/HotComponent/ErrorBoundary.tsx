import React, { Component, ReactNode, ErrorInfo } from 'react'

import type { OnRuntimeError, ErrorView } from '../../types'

interface ErrorBoundaryProps {
  children: ReactNode
  onError: (error: Error) => void
  resetKey: number
  ErrorView: ErrorView
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    const { resetKey } = this.props
    const { hasError } = this.state
    
    // 当 resetKey 变化且当前处于错误状态时，重置错误
    if (hasError && prevProps.resetKey !== resetKey) {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null
      })
    }
  }

  /**
   * 捕获错误信息并进行错误上报
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({
      hasError: true,
      error,
      errorInfo
    })
    const { onError } = this.props
    onError(error)
  }

  render(): ReactNode {
    const { hasError, error } = this.state
    const { children, ErrorView } = this.props

    if (hasError) {
      return <ErrorView error={error!}/>
    }

    return children
  }
}

export default ErrorBoundary
