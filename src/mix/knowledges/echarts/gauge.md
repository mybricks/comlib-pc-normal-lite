### 使用文档：仪表盘
仪表盘是一种将多个数据视图（如图表、指针、数字显示器等）集成在一起的界面，用于实时或者近实时地监控和展示关键性能指标（KPIs）。它类似于汽车仪表盘，能够让用户快速了解当前的状态和性能。

包含图表：仪表盘、得分环

#### 最佳实践-仪表盘
要点：
- 声明一个*type*为gauge的系列。
- 配置系列*series-gauge.startAngle*属性和*series-gauge.endAngle*属性，配置起始角度和结束角度，决定仪表盘的起点和终点。
- 配置系列*series-gauge.progress*的属性，默认开启进度条，让图表更好看。
- 配置系列*series-gauge.detail.valueAnimation*的属性为true，默认开启标签数字动画，让图表更好看。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  series: [
    {
      type: 'gauge',
      startAngle: 180, // 起始角度
      endAngle: 0, // 结束角度
      splitNumber: 10, // 仪表盘刻度的分割段数，默认为10
      progress: { // 进度条配置，一般情况下开启
        show: true, // 展示当前进度
        roundCap: true // 是否在两端显示成圆形
      },
      data: [
        { value: 80, name: 'score' },
      ],
      detail: {
        valueAnimation: true, // 开启标签的数字动画
      }
    },
  ],
}
```

#### 最佳实践-仪表盘-分别配置不同阶段的颜色
要点：
- 添加*series-gauge.axisLine*配置，价格坐标轴配置为三段不同的颜色。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  series: [
    {
      type: 'gauge',
      startAngle: 180, // 起始角度
      endAngle: 0, // 结束角度
      splitNumber: 10, // 仪表盘刻度的分割段数，默认为10
      progress: { // 进度条配置，一般情况下开启
        show: true, // 展示当前进度
        roundCap: true // 是否在两端显示成圆形
      },
      data: [
        { value: 80, name: 'score' },
      ],
      detail: {
        valueAnimation: true, // 开启标签的数字动画
      },
      axisLine: { // 开启坐标轴配置
        lineStyle: { // 配置线为三段不同的颜色
          width: 16,
          color: [
            [0.3, '#67e0e3'],
            [0.7, '#37a2da'],
            [1, '#fd666d']
          ]
        }
      }
    },
  ],
}
```