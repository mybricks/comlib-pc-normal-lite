import React, { Component } from 'react';
import css from './index.less';

interface ErrorInfo {
  title: string,
  desc?: string
}

const ErrorTip = ({ title, desc }: ErrorInfo) => {
  return <div className={css.error}>
    <div className={css.title}>{title}</div>
    <div className={css.desc}>{desc}</div>
  </div>
}

class ErrorBoundary extends Component<any, any> {
  constructor(props) {
    super(props);
  }

  state = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.log(11111)
    this.setState({ errorInfo });
    // 添加运行时错误到统一错误列表
    const { data } = this.props as any;
    if (data) {
      if (!data._errors) data._errors = [];
      const errorMessage = error?.toString ? error.toString() : (errorInfo ? errorInfo.componentStack : '未知运行时错误');
      // 移除旧的运行时错误（没有 file 字段的），替换引用触发 useMemo 重新计算
      data._errors = [
        ...data._errors.filter(err => err.file),
        {
          message: errorMessage,
          type: 'runtime'
        }
      ];
    }
  }

  componentDidMount() {
    // 组件成功挂载，清除之前的运行时错误
    const { data } = this.props as any;
    if (data && data._errors.length) {
      data._errors = data._errors.filter(err => err.file);
    }
  }

  componentDidUpdate(prevProps, prevState) {
    // 如果从错误状态恢复（比如重新渲染修复了bug），清除运行时错误
    if (prevState.hasError && !this.state.hasError) {
      const { data } = this.props as any;
      if (data && data._errors.length) {
        data._errors = data._errors.filter(err => err.file);
      }
    }
    // 如果props变化导致组件成功渲染，也清除运行时错误
    if (!this.state.hasError && prevProps !== this.props) {
      const { data } = this.props as any;
      if (data && data._errors.length) {
        data._errors = data._errors.filter(err => err.file);
      }
    }
  }

  render() {
    // @ts-ignore
    const errorTip = this.state?.error?.toString ? this.state.error.toString() : (this.state.errorInfo ? this.state.errorInfo.componentStack : null);
  

    console.log('errorTip', errorTip);
    if (errorTip) {
      return <ErrorTip title={'组件渲染错误'} desc={errorTip} />
    }

    // @ts-ignore
    return this.props.children; 
  }
}

export default ErrorBoundary
