export default {
  ':root'({ data }) {
    return {};
  },
  prompts: {
    summary: '折线图，用于展示数据随时间或其他连续变量变化趋势的图表组件',
    usage: `折线图，用于展示数据随时间或其他连续变量变化趋势的图表组件。

# 组件类型
- 基础折线图（default）：单条折线，展示单一数据序列
- 多折线图（more）：多条折线，通过分组字段展示多个数据序列的对比
- 阶梯折线图（step）：阶梯状折线，适合展示离散变化的数据

# data定义
\`\`\` typescript
interface Data {
  /** 图表高度 */
  height: number;
  /** 图表配置 */
  config: {
    /** x轴对应的数据字段名，默认 'year' */
    xField: string;
    /** y轴对应的数据字段名，默认 'value' */
    yField: string;
    /** 分组字段名，用于多折线图，默认 'category' */
    seriesField?: string;
    /** 是否平滑曲线 */
    smooth?: boolean;
    /** 阶梯折线类型，如 'vh'、'hv' */
    stepType?: string;
    /** x轴配置 */
    xAxis?: object;
    /** y轴配置 */
    yAxis?: object;
    /** 图例配置 */
    legend?: {
      position?: 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    };
    /** 内边距 */
    padding?: 'auto' | number | number[];
    /** 是否显示数据标签 */
    label?: boolean | object;
  };
  /** 图表子类型：default-基础折线图, more-多折线图, step-阶梯折线图 */
  subType?: 'default' | 'more' | 'step';
  /** 是否显示空状态 */
  useEmpty?: boolean;
  /** 空状态文本 */
  emptyText?: string;
}
\`\`\`

# 输入数据格式
\`\`\` typescript
// 基础折线图数据格式
interface BasicData {
  [xField]: string;  // x轴字段，如 year: '1991'
  [yField]: number;  // y轴字段，如 value: 3
}

// 多折线图数据格式（需要分组字段）
interface MultiLineData {
  [xField]: string;       // x轴字段
  [yField]: number;       // y轴字段
  [seriesField]: string;  // 分组字段，如 category: 'Liquid fuel'
}
\`\`\`

# 数据示例
\`\`\` json
// 基础折线图
[
  { "year": "1991", "value": 3 },
  { "year": "1992", "value": 4 },
  { "year": "1993", "value": 3.5 }
]

// 多折线图
[
  { "year": "1991", "value": 3, "category": "类型A" },
  { "year": "1991", "value": 5, "category": "类型B" },
  { "year": "1992", "value": 4, "category": "类型A" },
  { "year": "1992", "value": 6, "category": "类型B" }
]
\`\`\`

# slots插槽
无

# 注意
- 折线图适合展示连续数据的变化趋势
- 多折线图需要配置 seriesField 分组字段
- 数据中的字段名需要与 xField、yField、seriesField 配置保持一致
- 平滑曲线（smooth）不适用于阶梯折线图
`
  }
};
