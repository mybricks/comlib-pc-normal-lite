### 使用文档：桑基图
桑基图（Sankey Diagram）是一种特殊的流图（可以看作是有向无环图），它通过宽度不等的箭头直观地展示了不同节点之间的流动量和转移关系。

包含图表：桑基图

各类桑基图的适用场景：
- 桑基图：常适合展示具有流向关系的数据，如能源流向、成本分配、用户行为路径等


#### 最佳实践-桑基图

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  tooltip: {}, // 开启默认的鼠标悬浮效果
  series: [
    {
      type: 'sankey',
      orient: 'horizontal', // 桑基图中节点的布局方向，可以是水平的从左往右，也可以是垂直的从上往下，对应的参数值分别是 horizontal, vertical。
      draggable: false, // 桑吉图中节点拖拽的交互，一般我们设置为false不开启
      emphasis: {
        focus: 'adjacency'
      },
      data: [
        {
          name: 'a'
        },
        {
          name: 'b'
        },
        {
          name: 'a1'
        },
        {
          name: 'b1'
        },
        {
          name: 'c'
        },
        {
          name: 'c1'
        }
      ],
      links: [ // 节点间的边。注意: 桑基图理论上只支持有向无环图（DAG, Directed Acyclic Graph），所以请确保输入的边是无环的。
        {
          source: 'b',
          target: 'b1',
          value: 8
        },
        {
          source: 'a',
          target: 'b1',
          value: 3
        },
        {
          source: 'b1',
          target: 'c1',
          value: 1
        },
        {
          source: 'b1',
          target: 'c',
          value: 2
        }
      ]
    }
  ],
}
```