declare module '*.less' {
  const resource: { [key: string]: string };
  export default resource;
}

declare module '*.md' {
  const content: string;
  export default content;
}

declare module '*.svg' {
  const resource: any;
  export = resource;
}

interface Env {
  [x: string]: any;
}
interface RuntimeParams<T> {
  /** 组件ID **/
  id: string;
  name: string;
  data: T;
  env: Env;
  _env: any;
  style: any;
  slots: {
    [key: string]: {
      render: (props?: {
        wrap?: any;
        inputValues?: any;
        key?: number | string;
        style?: React.CSSProperties;
        outputs?: { [key: string]: Function };
        title?: string;
      }) => React.ReactNode;
      inputs: any;
      [key: string]: any;
    };
  };
  inputs: any;
  outputs: any;
  _inputs: any;
  _outputs: any;
  logger: any;
  createPortal: any;
  /** 父容器插槽 **/
  parentSlot: any;
  title?: string;
  onError: (params: Error | string) => null;
}

interface EditorResult<T> {
  id: string;
  name: string;
  data: T;
  focusArea: any;
  output: any;
  input: any;
  inputs: any;
  outputs: any;
  slot: any;
  diagram: any;
  style: React.CSSProperties;
  catelog: any;
  slots?: any;
  env: Env;
  setAutoRun: (auto?: boolean) => void;
  isAutoRun: () => boolean;
  setDesc: (desc?: string) => void;
  /** 获取子组件data，引擎 v1.2.69 **/
  getChildByName: (name: string) => any;
  removePermission: (id: string) => void;
}

interface UpgradeParams<T> {
  id: string;
  data: T;
  output: any;
  input: any;
  slot: any;
  style: any;
  setAutoRun: (auto?: boolean) => void;
  isAutoRun: () => boolean;
  setDeclaredStyle: (
    selector: string | string[],
    style: React.CSSProperties,
    global?,
    withParentComId?: boolean
  ) => void;
  getDeclaredStyle: (selector: string) => { selector: string; css: React.CSSProperties };
  removeDeclaredStyle: (selector: string) => void;
  config: {
    get: (id: string) => ConfigInstance;
  };
  children: any;
  /**
   * 注册权限信息
   * @param options 权限相关信息
   * @returns 注册后的权限ID
   */
  registerPermission: (options: { code: string; title: string }) => { id: string };
}

type ConfigInstance = {
  id: string;
  title: string;
  schema: Record<string, any>;
  connectionCount: number;
  setBinding: (binding: string) => void;
  setSchema: (schema: Record<string, any>) => void;
  setTitle: (title: string) => void;
  remove: () => void;
};

declare interface Window {
  Babel: any;
  less: any; // Less 编译器，CDN 加载
  myTinymce: any; // Tinymce
  jstt: any;
  MYBRICKS_AICOM_THEME_VARIABLES?: any;
  _render_comp_start_view_: any;
  _sandbox_: any
}
