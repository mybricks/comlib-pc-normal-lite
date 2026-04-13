import React, { Component, ReactNode, ErrorInfo } from 'react'

import type { OnRuntimeError } from '../types'

interface ErrorBoundaryProps {
  children: ReactNode
  onError: OnRuntimeError
  // /** 自定义错误回退UI */
  // fallback?: ReactNode | ((error: Error, errorInfo: ErrorInfo) => ReactNode)
  // /** 错误回调函数 */
  // onError?: (error: Error, errorInfo: ErrorInfo) => void
  // /** 是否在开发环境打印错误 */
  // logErrors?: boolean
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * React 错误边界组件
 * 用于捕获子组件树中的 JavaScript 错误，记录错误并显示备用 UI
 * 
 * @example
 * ```tsx
 * <ErrorBoundary fallback={<div>出错了</div>}>
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  // /**
  //  * 当子组件抛出错误时调用
  //  * 返回新的 state 来显示降级 UI
  //  */
  // static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
  //   return {
  //     hasError: true,
  //     error
  //   }
  // }

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

    // 开发环境下打印错误
    // if (logErrors && process.env.NODE_ENV === 'development') {
    //   console.error('ErrorBoundary caught an error:', error)
    //   console.error('Error Info:', errorInfo)
    // }

    // // 更新错误信息到 state
    // this.setState({
    //   errorInfo
    // })

    // // 调用外部错误处理回调
    // onError?.(error, errorInfo)
  }

  /**
   * 重置错误状态
   */
  // resetError = (): void => {
  //   this.setState({
  //     hasError: false,
  //     error: null,
  //     errorInfo: null
  //   })
  // }

  /**
   * 渲染默认错误UI
   */
  // renderDefaultFallback(): ReactNode {
  //   const { error, errorInfo } = this.state

  //   return (
  //     <div
  //       style={{
  //         padding: '20px',
  //         margin: '20px',
  //         border: '2px solid #ff4d4f',
  //         borderRadius: '8px',
  //         backgroundColor: '#fff2f0'
  //       }}
  //     >
  //       <h2 style={{ color: '#cf1322', margin: '0 0 16px 0' }}>
  //         ⚠️ 组件渲染出错
  //       </h2>
  //       <details style={{ whiteSpace: 'pre-wrap', fontSize: '14px' }}>
  //         <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>
  //           错误详情
  //         </summary>
  //         <div style={{ color: '#595959', marginTop: '8px' }}>
  //           <strong>错误信息：</strong>
  //           <pre style={{ color: '#cf1322' }}>{error?.toString()}</pre>
  //         </div>
  //         {errorInfo && (
  //           <div style={{ color: '#595959', marginTop: '8px' }}>
  //             <strong>组件栈：</strong>
  //             <pre>{errorInfo.componentStack}</pre>
  //           </div>
  //         )}
  //       </details>
  //       <button
  //         onClick={this.resetError}
  //         style={{
  //           marginTop: '16px',
  //           padding: '8px 16px',
  //           backgroundColor: '#1890ff',
  //           color: 'white',
  //           border: 'none',
  //           borderRadius: '4px',
  //           cursor: 'pointer'
  //         }}
  //       >
  //         重试
  //       </button>
  //     </div>
  //   )
  // }

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