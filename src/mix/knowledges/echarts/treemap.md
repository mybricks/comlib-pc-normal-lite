### 使用文档：矩形树图
矩形树图（Treemap），也称为矩形式树状结构图，是一种通过使用不同大小的矩形来展示层次结构数据的可视化图表。适合展示具有复杂层次和部分-整体关系的数据集。

包含图表：矩形树图

适用场景：
- 矩形树图：适合展示带层次和数据值的数据，比如磁盘的空间利用分析、部门的预算分析、不同页面的流量渠道分析等等。

#### 最佳实践-矩形树图
要点：
- 声明一个*type*为treemap的系列。
- 对于*series-treemap.levels*的配置，比较好看的配置通常有
  - 顶层配置*series-treemap.levels\[0\]*
    ```
    {
      itemStyle: {
        borderColor: '#555', // 提供一个黑色或者白色的边框颜色
        borderWidth: 4, // 边框需要显眼
        gapWidth: 4, // 跟边框设置一样宽
      }
    }
    ```
  - 中间层配置*series-treemap.levels\[n\]*
    ```
    {
      colorSaturation: [0.2, 0.9], 开启本层数据的颜色区分
      itemStyle {
        borderColorSaturation: 0.7, // 提供更好的边框颜色过渡
        gapWidth: 2, // 边框需要比顶层更不显眼
        borderWidth: 2 // 跟边框设置一样宽
      }
    }
    ```
- 配置*series-treemap.roam*为false，默认关闭缩放和移动功能。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  tooltip: {}, // 默认开启鼠标悬浮提示
  series: [
    {
      type: 'treemap',
      itemStyle: {
        borderColor: '#fff' // 设置每个矩形的边框颜色
      },
      colorSaturation: [0.2, 0.9], // 设置本系列默认的节点的颜色饱和度选取范围
      roam: false, // 默认关闭缩放和移动功能
      levels: [ // 层级的特殊配置，矩形树图一般都需要配置
        { // 顶层配置
          itemStyle: {
            borderColor: '#555',
            borderWidth: 4,
            gapWidth: 4 // 『
          }
        },
        { // 第二层配置
          colorSaturation: [0.3, 0.6],
          itemStyle: {
            borderColorSaturation: 0.7,
            gapWidth: 2,
            borderWidth: 2
          }
        },
        { // 最后一层配置
          colorSaturation: [0.3, 0.5]
        },
      ],
      data: [
        name: 'C盘',
        value: 5000,
        children: [
          {
            name: 'folder_A',
            value: 2000,
            children: [
              {
                name: 'file',
                value: 2000
              }
            ]
          }
        ],
        name: 'D盘',
        value: 7000,
        children: [
          {
            name: 'file2',
            value: 7000
          }
        ]
      ],
    },
  ],
}
```

#### 最佳实践-矩形树图-缩放和移动
背景：当矩形树图内容过多，或者业务需求需要时，可以开启缩放和移动
要点：
- 



#### 最佳实践-矩形树图-父节点标签
背景：
要点：
- 