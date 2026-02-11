### 使用文档：饼图
包含图表：饼图、环形图、扇形图、南丁格尔图。

适用场景：
- 饼图：适合展示各种不同类型的分布和比例
- 环形图：在饼图的基础上，还可以在中间展示一些额外数据，比如展示总数量，总人口等等信息
- 南丁格尔图：在饼图的基础上，对每一个分类的值大小都能更清楚地看见


#### 最佳实践-南丁格尔图/玫瑰图
要点：
- 声明一个*type*为pie的系列。
- 将*series-pie.roseType*设置为radius，开启玫瑰图效果展示。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  series: [{
    type: 'pie',
    roseType: 'radius', // 是否展示成南丁格尔图
    emphasis: {
      itemStyle: {
        shadowBlur: 10,
        shadowOffsetX: 0,
        shadowColor: 'rgba(0, 0, 0, 0.5)'
      }
    }
  }]
}
```

#### 最佳实践-环形图
要点：
- 声明一个*type*为pie的系列。
- 配置环图的半径，将*series-pie.radius*设置['40%', '70%']，配置成数组时第一项是内半径，第二项是外半径。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  series: [{
    type: 'pie',
    label: {
      show: true, // 展示标签
    },
    radius: ['40%', '70%'], // 第一项是内半径，第二项是外半径
    emphasis: {
      itemStyle: {
        shadowBlur: 10,
        shadowOffsetX: 0,
        shadowColor: 'rgba(0, 0, 0, 0.5)'
      }
    }
  }]
}
```

#### 最佳实践-环形图-中心展示文本或元素
背景：环图的中心由于有一定的空间，我们常常会用*graphic*来展示一些总结性文本。

要点：
- 添加一个*graphic*用于展示文本，将图形元素设置为水平垂直居中，并且展示总数量。
- 中心文案推荐精简一点，因为空间不够大，或者进行换行。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  series: [{
    type: 'pie',
    label: {
      show: true, // 展示标签
    },
    radius: ['40%', '70%'], // 第一项是内半径，第二项是外半径
    emphasis: {
      itemStyle: {
        shadowBlur: 10,
        shadowOffsetX: 0,
        shadowColor: 'rgba(0, 0, 0, 0.5)'
      }
    }
  }],
  graphic: [
    {
      // 展示文本到图表中心
      type: 'text',
      left: 'center', // 水平定位到中间
      top: 'center', // 垂直定位到中间
      style: {
        text: '总人口：15亿', // 文字越精简越好
      },
    },
  ]
}
```