declare module "*.less" {
  const resource: { [key: string]: string };
  export = resource;
}

declare module "*.css" {
  const resource: { [key: string]: string };
  export = resource;
}

interface RuntimeParams<T> {
  /** 环境注入 */
  env: Env;

  /** 组件的配置数据 */
  data: T;

  /** 组件的输入 */
  inputs: Inputs;

  /** 组件的输出 */
  outputs: Outputs;

  /** 插槽 */
  slots?: Record<string, Slot>;

  /** 日志插件 */
  logger?: Logger;

  /** 用户输入的组件名称 */
  title?: string;

  /** 组件的外部样式 */
  readonly style?: React.CSSProperties;
}

interface EditorResult<T> {
  data: T;
  focusArea: any;
  output: any;
  input: any;
  slot?: any;
  diagram?: any;
}

interface Data {
  [key: string]: any;
}

interface Env {
  preview?: {};
  edit?: {};
  runtime?: any;
  i18n?: (text: string) => string;
  [x: string]: any;
}

interface Inputs {
  [key: string]: (fn: (val: any, relOutputs?: any) => void) => void;
}

interface Outputs {
  [key: string]: (val?: any) => void;
}

interface Slot {
  render: (props?: any) => React.ReactNode;
  [key: string]: any;
}

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}
