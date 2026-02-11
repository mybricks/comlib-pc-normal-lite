### 使用文档-通用代码结构
场景：所有图表的基础框架。
要点：
- UI结构为外部套一个div，用于配置边框/背景色等CSS样式，其中*宽高限制使用100%*，图表组件宽高也尽量使用*100%*，除非用户主动提出需求，或者设计稿标注，则可以使用固定尺寸。
- 在UI结构中，尽可能不再添加 dom 元素，如有文案和图形需求可以优先使用*graphic*。
- 添加*comRef*的引用和使用。

#### 最佳实践
```jsx file="runtime.jsx"
import ReactECharts from 'echarts-for-react';
import { useMemo } from 'react';
import { comRef } from 'mybricks';
import css from 'style.less';

export default comRef(({ data }) => {
  const option = useMemo(() => {
    return {
      //...省略其它图表配置
    }
  }, [data.dataSource])

  return (
    <div className={css.chart} style={{ width: '100%', height: '100%' }}>
      <ReactECharts
        option={option}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}, {
  type: 'main',
  title: '图表的基础使用',
})
```

### 使用文档-支持动态数据/动态配置项
场景：图表需要支持通过输入项传入动态数据/配置，或者是通过编辑项传入的配置。
要点：
- 使用*useMemo*接收各输入项传入的值，并将值赋值给响应式对象。
- 在使用响应式对象的时候，如果在hook中使用了，必须要添加到依赖项中。

#### 最佳实践
```jsx file="runtime.jsx"
import ReactECharts from 'echarts-for-react';
import { useMemo } from 'react';
import css from 'style.less';

export default ({ data }) => {

  // 声明输入项的接收函数
  useMemo(() => {
    // 通过输入项修改的数据务必通过修改data数据模型上的引用来实现
    inputs['dataSource']?.((recevieData) => {
      // 类型一：替换所有数据
      data.dataSource = recevieData

      // 类型二：添加数据
      data.dataSource = data.dataSource.concat(recevieData)
    })
  }, [])

  const option = useMemo(() => {
    return {
      //...省略其它图表配置
      title: data.title // 接收从编辑项传过来的标题
    }
  }, [data.dataSource, data.title]) // 将使用到的变量引用添加到hooks的依赖项中

  return (
    <div className={css.chart} style={{ width: '100%', height: '100%' }}>
      <ReactECharts
        option={option}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
```

### 使用文档-图表支持事件
场景：图表需要通过监听事件向外部抛出数据。

#### 最佳实践-基本使用
```jsx file="runtime.jsx"
import ReactECharts from 'echarts-for-react';
import { useMemo, useCallback } from 'react';
import css from 'style.less';

export default ({ data }) => {
  const option = useMemo(() => {
    return {
      //...省略其它图表配置
    }
  }, [data.dataSource])

  // 定义图表Ready的回调，常用来获取echarts实例
  const onChartReady = useCallback((echarts) => {
    console.log('echarts is ready', echarts);
  }, [])

  // 定义图表点击事件的回调
  const onChartClick = useCallback((param, echarts) => {
    console.log(param, echarts);
  }, [])

  return (
    <ReactECharts
      option={option}
      onChartReady={onChartReady}
      onEvents={{
        'click': onChartClick,
      }}
    />
  )
}
```

### 最佳实践-使用鼠标事件
场景：在需要监听鼠标事件时，包括 'click'、 'dblclick'、 'mousedown'、 'mousemove'、 'mouseup'、 'mouseover'、 'mouseout'、 'globalout'、 'contextmenu' 事件，可以参考此案例。


```jsx file="runtime.jsx"
import ReactECharts from 'echarts-for-react';
import { useMemo, useCallback } from 'react';
import css from 'style.less';

// 鼠标事件的参数
type EventParams = {
  // 当前点击的图形元素所属的组件名称，
  // 其值如 'series'、'markLine'、'markPoint'、'timeLine' 等。
  componentType: string;
  // 系列类型。值可能为：'line'、'bar'、'pie' 等。当 componentType 为 'series' 时有意义。
  seriesType: string;
  // 系列在传入的 option.series 中的 index。当 componentType 为 'series' 时有意义。
  seriesIndex: number;
  // 系列名称。当 componentType 为 'series' 时有意义。
  seriesName: string;
  // 数据名，类目名
  name: string;
  // 数据在传入的 data 数组中的 index
  dataIndex: number;
  // 传入的原始数据项
  data: Object;
  // sankey、graph 等图表同时含有 nodeData 和 edgeData 两种 data，
  // dataType 的值会是 'node' 或者 'edge'，表示当前点击在 node 还是 edge 上。
  // 其他大部分图表中只有一种 data，dataType 无意义。
  dataType: string;
  // 传入的数据值
  value: number | Array;
  // 数据图形的颜色。当 componentType 为 'series' 时有意义。
  color: string;
};

export default ({ data }) => {
  const option = useMemo(() => {
    return {
      //...省略其它图表配置
    }
  }, [data.dataSource])

  // 定义图表Ready的回调，常用来获取echarts实例
  const onChartReady = useCallback((echarts) => {
    console.log('echarts is ready', echarts);
  }, [])

  // 定义图表点击事件的回调
  const onMouseClick = useCallback((params: EventParams) => {
    // 区分鼠标点击到了哪里
    if (params.componentType === 'markPoint') {
      // 点击到了 markPoint 上
      if (params.seriesIndex === 5) {
        // 点击到了 index 为 5 的 series 的 markPoint 上。
      }
    } else if (params.componentType === 'series') {
      if (params.seriesType === 'graph') {
        if (params.dataType === 'edge') {
          // 点击到了 graph 的 edge（边）上。
        } else {
          // 点击到了 graph 的 node（节点）上。
        }
      }
    }
  }, [])

  // 定义图表contextmenu事件的回调
  const onChartContextmenu = useCallback((params: EventParams) => {

  }, [])

  return (
    <ReactECharts
      option={option}
      onChartReady={onChartReady}
      onEvents={{
        'click': onMouseClick,
        'contextmenu': onChartContextmenu
      }}
    />
  )
}
```

### 使用文档-配置基础调色盘
场景：配置图表的调色盘颜色列表。如果系列没有设置颜色，则会依次循环从该列表中取颜色作为系列颜色

#### 最佳实践
```jsx file="runtime.jsx"
import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'
import css from 'style.less'

export default ({ data }) => {
  const option = useMemo(() => {
    return {
      // 省略配置
      xAxis: {
        type: 'category',
        data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      },
      yAxis: {
        type: 'value',
      },
      color: ['#5470C6', '#EE6666'], // 声明调色盘颜色列表
      series: [
        {
          data: [150, 230, 224, 218, 135, 147, 260],
          type: 'line',
        },
        {
          data: [150, 230, 224, 218, 135, 147, 260],
          type: 'line',
        },
      ],
    }
  }, [data.dataSource])

  return (
    <div className={css.chart} style={{ width: '100%', height: '100%' }}>
      <ReactECharts option={option} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
```

### 使用文档-渐变色的配置
场景：需要线性渐变和径向渐变的场景

```
const color = [
  new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    {
      offset: 0,
      color: 'rgb(128, 255, 165)'
    },
    {
      offset: 1,
      color: 'rgb(1, 191, 236)'
    }
  ]), // 线性渐变，前四个参数分别是 x0, y0, x2, y2, 两个offset表示范围从 0 - 1
  '#fac858' // 普通单色
]
```

### 使用文档-在部分系列中使用标记
场景：在系列中绘制标记，比如遇到如下场景
- 需要绘制一条额外的提示/辅助线条，比如平均值参考线、极值参考线、最小值参考线等，可以支持在任意点中绘制一条直线以及展示文本
- 需要绘制一个额外的提示/辅助区域，可以支持在任意区间绘制一个矩形用于辅助提示
- 需要绘制一个额外的提示/标记点，可以强调任意一个已绘制的点

关联属性：
- option.series.[n].markPoint
- option.series.[n].markArea
- option.series.[n].markLine

注意：无论是 markPoint、markArea 还是 markLine，都必须配置在一个系列的内部使用。

#### 最佳实践-使用 markArea 绘制辅助区

```jsx file="runtime.jsx"
import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'
import css from 'style.less'

export default ({ data }) => {
  const option = useMemo(() => {
    return {
      // 省略配置
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, i) => `${i}:00`),
      },
      series: [
        {
          type: 'line',
          data: [10, 20, 30, 60, 56, 56, 56, ...],
          markArea: { // 使用 markArea 展示一天内最佳的跑步时间
            itemStyle: {
              color: ['rgba(255, 173, 177, 0.4)', 'rgba(173, 155, 255, 0.4)'] // 设置两个不同的颜色，上午最佳跑步时间颜色为半透明红色，晚上最佳跑步时间颜色为半透明蓝色
            },
            data: [
              [
                {
                  name: '上午最佳跑步时间',
                  xAxis: '8:00' // 要匹配 X 轴数据类型
                },
                {
                  xAxis: '10:00' // 要匹配 X 轴数据类型
                }
              ],
              [
                {
                  name: '晚上最佳跑步时间',
                  xAxis: '17:00' // 要匹配 X 轴数据类型
                },
                {
                  xAxis: '21:00' // 要匹配 X 轴数据类型
                }
              ]
            ]
          }
        },
      ],
    }
  }, [data.dataSource])

  return (
    <div className={css.chart} style={{ width: '100%', height: '100%' }}>
      <ReactECharts option={option} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
```

#### 最佳实践-使用 markPoint 绘制辅助点

```jsx file="runtime.jsx"
import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'
import css from 'style.less'

export default ({ data }) => {
  const option = useMemo(() => {
    return {
      // 省略配置
      xAxis: {
        type: 'category',
        data: [1, 2, 3, 4, 5, 6, 7],
      },
      series: [
        {
          type: 'line',
          data: [], // 系列数据
          markPoint: { // markPoint 是一类 serie 系列的子属性之一
            data: [
              { name: '最小', type: 'min' }, // 类型一：使用一个点强调展示最小值，为当前系列数据的最小值
              { name: '最大', type: 'max' }, // 类型二：使用一个点强调展示最大值，为当前系列数据的最大值
              { name: '平均', type: 'average' }, // 类型三：使用一个点强调展示平均值，为当前系列数据的平均值
              { name: '某个坐标', coord: [5, 20] }, // 类型四：绘制某个坐标的值
            ],
          },
        },
      ],
    }
  }, [data.dataSource])

  return (
    <div className={css.chart} style={{ width: '100%', height: '100%' }}>
      <ReactECharts option={option} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
```

#### 最佳实践-使用 markLine 绘制辅助参考线
```jsx file="runtime.jsx"
import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'
import css from 'style.less'

export default ({ data }) => {
  const option = useMemo(() => {
    return {
      // 省略配置
      xAxis: {
        type: 'category',
        data: [1, 2, 3, 4, 5, 6, 7],
      },
      series: [
        {
          type: 'line',
          data: [], // 系列数据
          markLine: { // markLine 是一类 serie 系列的子属性之一
            data: [
              {
                type: 'average', // type=average时是平均数
                name: '平均值',
                label: {
                  show: true,
                  formatter: '平均值：{c}',
                  position: 'insideEndTop', 设置标签在线的结束点上方，不容易遮挡信息
                },
              }, // 类型一：绘制一个平均值参考线，并且展示格式化其展示信息
              {
                name: 'Y 轴值为 100 的水平线',
                yAxis: 100,
              }, // 类型二：绘制 Y值为 100 的水平线
              [
                {
                  name: '两个坐标之间的标线',
                  coord: [10, 20],
                }, // 起点
                {
                  coord: [20, 30],
                }, // 终点
              ], // 类型三：绘制两个坐标之间的参考线
            ],
          },
        },
      ],
    }
  }, [data.dataSource])

  return (
    <div className={css.chart} style={{ width: '100%', height: '100%' }}>
      <ReactECharts option={option} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
```

### 使用文档-图形元素 graphic 的使用
graphic 是原生图形元素组件。可以支持的图形元素包括：
image, text, circle, sector, ring, polygon, polyline, rect, line, bezierCurve, arc, group。

> 注意： 一般来说，我们优先使用标记来实现功能

#### 最佳实践-元素相对定位

```jsx file="runtime.jsx"
import ReactECharts from 'echarts-for-react'
import { useMemo, useCallback } from 'react'
import css from 'style.less'

export default ({ data }) => {
  const option = useMemo(() => {
    return {
      //...省略其它图表配置
      graphic: [
        {
          // 将图片定位到最下方的中间：
          type: 'text',
          left: 'center', // 水平定位到中间
          bottom: '10%', // 定位到距离下边界 10% 处
          style: {
            text: '我是位于图表中心的文本',
          },
        },
        {
          // 将图片定位到最下方的中间：
          type: 'text',
          left: 'center', // 水平定位到中间
          bottom: '10%', // 定位到距离下边界 10% 处
          style: {
            text: '我是位于图表中心的文本',
          },
        },
        {
          // 将旋转过的 group 整体定位右下角：
          type: 'group',
          right: 0, // 定位到右下角
          bottom: 0, // 定位到右下角
          rotation: Math.PI / 4,
          children: [
            {
              type: 'rect',
              left: 'center', // 相对父元素居中
              top: 'middle', // 相对父元素居中
              shape: {
                width: 190,
                height: 90,
              },
              style: {
                fill: '#fff',
                stroke: '#999',
                lineWidth: 2,
                shadowBlur: 8,
                shadowOffsetX: 3,
                shadowOffsetY: 3,
                shadowColor: 'rgba(0,0,0,0.3)',
              },
            },
            {
              type: 'text',
              left: 'center', // 相对父元素居中
              top: 'middle', // 相对父元素居中
              style: {
                fill: '#777',
                text: ['This is text', '这是一段文字', 'Print some text'].join(
                  '\n'
                ),
                font: '14px Microsoft YaHei',
              },
            },
          ],
        },
      ],
    }
  }, [data.dataSource])

  return <ReactECharts option={option} />
}
```


### 使用文档-提示框组件 tooltip 的使用
提示框组件 tooltip 一般用于鼠标悬浮/点击时展示对应图形的信息。

#### 最佳实践-打开tooltip
```jsx file="runtime.jsx"
option = {
  // 省略配置
  tooltip: {} // 设置为空对象，默认开启
}
```

#### 最佳实践-使用formatter来定制tooltip
背景：支持使用formatter对提示框组件进行格式化/样式的定制。

1. formatter为字符串模板形式
模板变量有 {a}, {b}，{c}，{d}，{e}，分别表示系列名，数据名，数据值等。 在 trigger 为 'axis' 的时候，会有多个系列的数据，此时可以通过 {a0}, {a1}, {a2} 这种后面加索引的方式表示系列的索引。 不同图表类型下的 {a}，{b}，{c}，{d} 含义不一样。 其中变量{a}, {b}, {c}, {d}在不同图表类型下代表数据含义为：

折线（区域）图、柱状（条形）图、K线图 : {a}（系列名称），{b}（类目值），{c}（数值）, {d}（无）

散点图（气泡）图 : {a}（系列名称），{b}（数据名称），{c}（数值数组）, {d}（无）

地图 : {a}（系列名称），{b}（区域名称），{c}（合并数值）, {d}（无）

饼图、仪表盘、漏斗图: {a}（系列名称），{b}（数据项名称），{c}（数值）, {d}（百分比）

```jsx file="runtime.jsx"
option = {
  // 省略配置
  tooltip: {
    show: true,
    trigger: 'item', // 数据项图形触发
    triggerOn: 'mousemove', // 仅在鼠标悬浮时展示
    renderMode: 'html', // 使用html模式渲染，定制tooltip时建议使用此方式
    formatter: '{a}<br />{b}: {c}'
  }
}
```

2. formatter为函数形式
回调函数格式：
```
(params: Object|Array, ticket: string, callback: (ticket: string, html: string)) => string | HTMLElement | HTMLElement[]
```
支持返回 HTML 字符串或者创建的 DOM 实例。

当trigger为item的时候，第一个参数 params 是 formatter 需要的数据集。格式如下：
```
{
  componentType: 'series',
  seriesIndex: number, // 系列在传入的 option.series 中的 index
  seriesName: string, // 系列名称
  name: string, // 数据名，类目名
  data: Object, // 传入的原始数据项
}
```
所以格式化可以这么配置
```jsx file="runtime.jsx"
option = {
  // 省略配置
  tooltip: {
    show: true,
    trigger: 'item', // 数据项图形触发
    triggerOn: 'mousemove', // 仅在鼠标悬浮时展示
    renderMode: 'html', // 使用html模式渲染，定制tooltip时建议使用此方式
    formatter: (params) => `${params.name}<br />值: ${params.data.xxx}` // params.data为传入的原始数据项
  }
}
```