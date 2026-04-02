import React, { Component } from 'react';
import context from '../../../../../mix/context';

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
    console.log('erirs', error, errorInfo)
    this.setState({ errorInfo });
    // 添加运行时错误到统一错误列表
    const { data, onError } = this.props as any;
    if (data) {
      if (!data._errors) data._errors = [];
      // const errorMessage = error?.toString ? error.toString() : (errorInfo ? errorInfo.componentStack : '未知运行时错误');
      // 如果错误来自 eval（runRender 抛出的富化错误），携带 fileName
      // const fileName: string | undefined = (error as any)?.fileName;

      // 移除旧的运行时错误，写入本次错误
      // data._errors = [
      //   ...data._errors.filter((err: any) => err.type !== 'runtime'),
      //   {
      //     message: errorMessage,
      //     type: 'runtime',
      //     ...(fileName ? { file: fileName } : {}),
      //   }
      // ];

      context.getAiComEvents(this.props.comId).emit("runtimeError", error)

      console.log('捕获到运行时错误:', {
        error,
        errorInfo
      });
    }
    onError?.();
  }

  componentDidMount() {
    // 组件成功挂载（本次渲染无错），清除旧的 runtime 错误。
    // 此钩子在 componentDidCatch 之前执行，不会误清本次新写入的错误。
    // const { data } = this.props as any;
    // if (data?._errors?.length) {
    //   data._errors = data._errors.filter((err: any) => err.type !== 'runtime');
    // }
  }

  componentDidUpdate(prevProps, prevState) {
    // 从错误状态恢复（重新渲染修复了 bug），清除 runtime 错误
    if (prevState.hasError && !this.state.hasError) {
      // const { data } = this.props as any;
      // if (data?._errors?.length) {
      //   data._errors = data._errors.filter((err: any) => err.type !== 'runtime');
      // }
    }
  }

  render() {
    if (this.state.hasError) {
      const { data, renderRuntimeError, comId } = this.props as any;
      // 取出当前 runtime 错误列表供视图展示
      const runtimeErrors = data?._errors?.filter((e: any) => e.type === 'runtime') ?? [];
      const firstError = runtimeErrors[0];
      const title = '组件运行时错误';
      const desc = firstError?.message ?? (
        (this.state.error as any)?.toString
          ? (this.state.error as any).toString()
          : ((this.state.errorInfo as any)?.componentStack ?? '未知运行时错误')
      );

      if (renderRuntimeError) {
        return renderRuntimeError({ title, desc, errors: runtimeErrors, comId });
      }
      // 兜底：直接渲染文本
      return <div style={{ color: 'red', padding: 8 }}>{desc}</div>;
    }

    // @ts-ignore
    return this.props.children;
  }
}

export default ErrorBoundary;
