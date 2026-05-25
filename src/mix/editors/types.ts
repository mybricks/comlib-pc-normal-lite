export interface Props {
  /** 组件数据源 */
  data: any;
  /** 是否为编码模式，该模式下，展示默认选区 */
  isLowCodeMode: boolean;
  /** 组件 id */
  id: string;
  model?: any;
  /** 选区 */
  focusArea: any;
}

export interface Actions {
  getFocusArea: any;
  lock: any;
  notifyChanged: any;
  unlock: any;
}

/** Figma 导入项：selectors 与 parseLess 的 key 一致，value 为样式键值 */
export interface FigmaImportItem {
  selectors: string[];
  value: Record<string, string>;
  /** AL 容器节点的直接子节点 selectors（仅二进制剪贴板路径填充） */
  childSelectors?: string[];
  /** 附加元数据（用于同步阶段决策） */
  meta?: {
    dimension?: {
      sizingHorizontal?: string;
      sizingVertical?: string;
      sourceSize?: {
        x?: number;
        y?: number;
      };
      hasAutoLayout?: boolean;
      stackMode?: string;
    };
  };
}

export interface FigmaComponentPatch {
  selector: string;
  component: string;
  props: Record<string, string | boolean | number>;
  meta?: {
    componentKey?: string;
    variantName?: string;
    /** 兼容字段：来自 Figma 锚点 [mbid:*] 的定位 JSON 字符串（不代表 TSX 中存在 data-loc） */
    syncId?: string;
    /** JSX 相对路径，例如 pages/OperationWorkbench/index.tsx */
    fileJsx?: string;
    /** JSX 开标签起始字符偏移 */
    jsxStart?: number;
    /** JSX 开标签结束字符偏移（可选） */
    jsxEnd?: number;
    /** JSX 所在代码行（可选） */
    codeLineStart?: number;
    /** 同 selector + component 下第几个实例（0-based），仅历史兜底 */
    instanceNth?: number;
  };
}
