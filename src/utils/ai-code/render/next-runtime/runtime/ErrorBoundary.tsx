import { Component, ReactNode, ErrorInfo } from 'react'

import type { OnRuntimeError } from '../types'

interface ErrorBoundaryProps {
  children: ReactNode
  onError: OnRuntimeError
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
    onError(error, errorInfo)
  }

  render(): ReactNode {
    const { hasError } = this.state
    const { children } = this.props

    if (hasError) {
      return null
    }

    return children
  }
}

export default ErrorBoundary
