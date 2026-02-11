### 使用文档：柱状图
包含图表：柱状图、条形图、分组柱状图、堆叠柱状图、堆叠条形图。

适用场景：
- 柱状图：适合展示随X轴变化Y轴变化的趋势
- 分组柱状图：适合展示多组数据对比的情况
- 堆叠柱状图：适合展示多组数据在X轴维度上的占比情况
- 堆叠条形图：适合展示多组数据在Y轴维度上的占比情况


#### 最佳实践-柱状图
要点：
- 声明一个*type*为bar的系列。
- 一般把*tooltip.trigger*设置为axis，鼠标悬浮时，用十字准星来展示具体数据的提示效果。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  tooltip: {
    trigger: 'axis'
  },
  xAxis: {
    type: 'category',
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
  yAxis: {
    type: 'value',
  },
  series: [
    {
      type: 'bar',
      data: [150, 230, 224, 218, 135, 147, 260],
    },
  ],
}
```

#### 最佳实践-柱状图-设置柱子背景和标签
要点：
- 将系列的*showBackground*设置为true，展示柱子的背景。
- 将系列的*label*配置项配置好，用于展示标签提示。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  tooltip: {
    trigger: 'axis'
  },
  xAxis: {
    type: 'category',
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
  yAxis: {
    type: 'value',
  },
  series: [
    {
      type: 'bar',
      data: [150, 230, 224, 218, 135, 147, 260],
      showBackground: true, // 展示柱子的背景
      label: { // 展示此系列的标签
        show: true,
        formatter: '{b}'
      },
    },
  ],
}
```

#### 最佳实践-柱状图-绘制参考线
要点：
- 在需要绘制参考线的系列中添加*markLine.data*属性，配置参考线的具体信息。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  tooltip: {
    trigger: 'axis'
  },
  xAxis: {
    type: 'category',
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
  yAxis: {
    type: 'value',
  },
  series: [
    {
      type: 'bar',
      data: [150, 230, 224, 218, 135, 147, 260],
      markLine: { // 添加平均值参考线
        data: {
          type: 'average', // type=average时是平均数
          name: '平均值',
          label: {
            show: true,
            formatter: '平均值：{c}',
            position: 'insideEndTop', 设置在参考线的结束点上方，不容易遮挡信息
          },
        }
      }
    },
  ],
}
```