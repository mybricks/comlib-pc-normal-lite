### 使用文档：折线图
折线图是用折线将各个数据点标志连接起来的图表，用于展现数据的变化趋势。

包含图表：折线图、面积图、多折线图、堆叠折线图、堆叠面积图，阶梯折线图。

适用场景：
- 折线图：适合展示随X轴变化Y轴变化的趋势
- 面积图：在折线图的基础上，添加areaStyle面积区域
- 多折线图：在折线图的基础上，绘制多个系列的折线数据来做系列的对比
- 多面积图：在面积图的基础上，绘制多个系列的面积数据来做系列的对比
- 堆叠折线图：在多折线图的基础上，启用堆叠功能
- 堆叠面积图：在多面积图的基础上，启动堆叠功能

#### 最佳实践-折线图
要点：
- 折线图一般把*tooltip.trigger*设置为axis，鼠标悬浮时，用十字准星来展示具体数据的提示效果。

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
      data: [150, 230, 224, 218, 135, 147, 260],
      type: 'line',
    },
  ],
}
```

#### 最佳实践-面积图
要点：
- 面积图一般把*showSymbol*设置为false，不展示具体的点。
- 开启*areaStyle*设置。
- 把*tooltip.trigger*设置为axis，用十字准星来展示具体数据的提示效果。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  tooltip: {
    trigger: 'axis'
  },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
  yAxis: {
    type: 'value',
  },
  series: [
    {
      data: [820, 932, 901, 934, 1290, 1330, 1320],
      type: 'line',
      showSymbol: false,
      areaStyle: {}, // 绘制面积
    },
  ],
}
```

#### 最佳实践-构建好看的渐变色面积图
面积图好看的要点在于*areaStyle*配置渐变，但是*itemStyle*配置纯色。

要点：
- 给面积*areaStyle*设置一个渐变色，并且设置*showSymbol*为false，取消点的展示。
- 给线*itemStyle*选择一个相近的纯色，保证图例和鼠标悬浮都是纯色。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  series: [
    {
      data: [820, 932, 901, 934, 1290, 1330, 1320],
      type: 'line',
      showSymbol: false,
      itemStyle: {
        color: '#4facfe'
      }
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 1, 0, 0, [ // 这是从上往下渐变
          { offset: 0, color: '#4facfe' },
          { offset: 1, color: '#00f2fe' }
        ])
      }, // 绘制面积
    },
  ],
}
```
