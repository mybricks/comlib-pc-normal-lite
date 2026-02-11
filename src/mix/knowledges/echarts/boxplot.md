### 使用文档：盒须图
盒须图（Box Plot），也称为箱形图或箱线图，是一种用于展示数据分散情况的统计图。

包含图表：盒须图、箱形图、箱线图

#### 最佳实践-盒须图
要点：
- 声明一个*type*为boxplot的系列。
- 将*yAxis.splitLine.show*设置为true，展示y轴坐标轴背景的分割线。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  tooltip: {}, // 盒须图一般默认使用空对象
  xAxis: {
    type: "category",
    data: ["A", "B", "C", "D", "E"],
  },
  yAxis: {
    type: "value",
    splitArea: {
      show: true
    }
  },
  series: [
    {
      name: "boxplot",
      type: "boxplot", // 设置为盒须图
      data: [
        [655, 850, 940, 980, 1070],
        [760, 800, 845, 885, 960],
        [780, 840, 855, 880, 940],
        [720, 767.5, 815, 865, 920],
        [740, 807.5, 810, 870, 950]
      ]
    }
  ],
}
```