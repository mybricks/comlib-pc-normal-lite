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
