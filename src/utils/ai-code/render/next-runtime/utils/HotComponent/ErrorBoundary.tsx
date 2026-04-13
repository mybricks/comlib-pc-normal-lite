import React, { Component, ReactNode, ErrorInfo } from 'react'

// [TODO] 后续热更新时再使用

interface ErrorBoundaryProps {
  /** 子组件 */
  children: ReactNode
  // /** 自定义错误回退UI */
  // fallback?: ReactNode | ((error: Error, errorInfo: ErrorInfo) => ReactNode)
  // /** 错误回调函数 */
  // onError?: (error: Error, errorInfo: ErrorInfo) => void
  // /** 是否在开发环境打印错误 */
  // logErrors?: boolean
}

interface ErrorBoundaryState {
  count: number
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * 报错两次再向上抛出错误
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      count: 0,
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  /**
   * 当子组件抛出错误时调用
   * 返回新的 state 来显示降级 UI
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    console.error('[getDerivedStateFromError]', error)
    return {
      hasError: true,
      error
    }
  }

  /**
   * 捕获错误信息并进行错误上报
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[componentDidCatch]', {error, errorInfo, state: this.state})
    // const { onError, logErrors = true } = this.props

    // 开发环境下打印错误
    // if (logErrors && process.env.NODE_ENV === 'development') {
    //   console.error('ErrorBoundary caught an error:', error)
    //   console.error('Error Info:', errorInfo)
    // }

    // 更新错误信息到 state
    // this.setState({
    //   errorInfo
    // })

    // 调用外部错误处理回调
    // onError?.(error, errorInfo)
  }

  /**
   * 重置错误状态
   */
  resetError = (): void => {
    console.log('[resetError]')
    this.setState({
      count: this.state.count + 1,
      hasError: false,
      error: null,
      errorInfo: null
    })
  }

  // /**
  //  * 渲染默认错误UI
  //  */
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
    const { hasError, error, errorInfo, count } = this.state
    const { children } = this.props

    // [TODO] 需要接收外部参数来刷新报错次数

    // fallback

    if (hasError) {
      if (count === 0) {
        this.resetError()
      }
      return null
      // // 如果提供了自定义 fallback
      // if (fallback) {
      //   // fallback 是函数，传入错误信息
      //   if (typeof fallback === 'function') {
      //     return fallback(error!, errorInfo!)
      //   }
      //   // fallback 是 ReactNode
      //   return fallback
      // }

      // // 使用默认错误UI
      // return this.renderDefaultFallback()
    }

    return children
  }
}

export default ErrorBoundary