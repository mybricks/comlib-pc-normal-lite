### 使用文档：散点图
散点（气泡）图。直角坐标系上的散点图可以用来展现数据的 x，y 之间的关系，如果数据项有多个维度，其它维度的值可以通过不同大小的 symbol 展现成气泡图，也可以用颜色来表现。这些可以配合 visualMap 组件完成

包含图表：散点图、气泡图、涟漪散点图、涟漪气泡图

各类散点图的适用场景：
- 散点图：一般为固定点大小的图，适合展示二维数据的信息
- 气泡图：在散点图的基础上，还可以再通过不同大小的 symbol 来展示第三个维度的数据

#### 最佳实践-散点图
要点：
- 声明一个*type*为scatter的系列。
- 将*series-scatter.symbolSize*设置为固定大小，例如20，保证不同的点大小一致。
- 将*xAxis.splitLine.show*和*yAxis.splitLine.show*设置为true，展示x和y轴坐标轴背景的分割线。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  tooltip: {}, // 开启默认的鼠标悬浮效果
  xAxis: {
    splitLine: { 
      show: true // 开启坐标轴背景的分割线，
    }
  },
  yAxis: {
    splitLine: { 
      show: true // 开启坐标轴背景的分割线，
    }
  },
  series: [{
    type: 'scatter',
    symbolSize: 20, // 散点图使用固定大小
    data: [
      ['一月', 2],
      ['二月', 6],
      ['三月', 9],
      ['四月', 10]
    ],
  }]
}
```

#### 最佳实践-散点图-多系列对比
背景：绘制多个不同维度的散点图，做对比展示。

要点：
- 在*series*中添加多个系列数据，可用于不同维度数据的对比。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  tooltip: {}, // 开启默认的鼠标悬浮效果
  xAxis: {
    splitLine: { 
      show: true // 开启坐标轴背景的分割线，
    }
  },
  yAxis: {
    splitLine: { 
      show: true // 开启坐标轴背景的分割线，
    }
  },
  series: [
    {
      name: 'A',
      type: 'scatter', // 维度A
      symbolSize: 20, // 散点图使用固定大小
      data: [
        ['一月', 2],
        ['二月', 6],
        ['三月', 9],
        ['四月', 10]
      ],
    },
    {
      name: 'B',
      type: 'scatter', // 维度B
      symbolSize: 20, // 散点图使用固定大小
      data: [
        ['一月', 5],
        ['二月', 6],
        ['三月', 7],
        ['四月', 8]
      ],
    }
  ]
}
```

#### 最佳实践-气泡图

要点：
- 声明一个*type*为scatter的系列。
- 将*series-scatter.symbolSize*设置为动态函数，根据数值来决定展示多大的点。
- 将*xAxis.splitLine.show*和*yAxis.splitLine.shwo*设置为true，展示x和y轴坐标轴北京的分割线。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  tooltip: {}, // 开启默认的鼠标悬浮效果
  xAxis: {
    splitLine: { 
      show: true // 开启坐标轴背景的分割线，
    }
  },
  yAxis: {
    splitLine: { 
      show: true // 开启坐标轴背景的分割线，
    }
  },
  series: [{
    type: 'scatter',
    symbolSize: function (data) { // 气泡图的点大小是动态的，由第三个维度的数值决定
      return Math.sqrt(data[2]);
    },
    data: [
      ['一月', 2],
      ['二月', 6],
      ['三月', 9],
      ['四月', 10]
    ],
  }]
}
```