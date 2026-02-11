### 使用文档：漏斗图

漏斗图通常用于展示数据的层级关系和变化趋势。由多个梯形或矩形层叠组成。

包含图表：漏斗图

#### 最佳实践-漏斗图
要点：
- 声明一个*type*为funnel的系列。
- 配置系列*series-funnel.sort*属性，配置数据排序以决定漏斗的方向，可以取 'ascending'，'descending'，'none'。
- 配置系列*series-funnel.gap*属性为2，配置数据图形的间距，使漏斗图更好看。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  tooltip: {}, // 漏斗图一般默认使用空对象
  legend: {
    data: ['Show', 'Click', 'Visit', 'Inquiry', 'Order'],
  },
  series: [
    {
      type: 'funnel',
      sort: 'descending', // 数据排序，可以取 'ascending'，'descending'，'none'（表示按 data 顺序），漏斗图一般需要从大到小排序
      gap: 2, // 数据图形间距
      label: { // 开启标签显示
        show: true,
        position: 'outside',
      },
      data: [
        { value: 60, name: 'Visit' },
        { value: 40, name: 'Inquiry' },
        { value: 20, name: 'Order' },
        { value: 80, name: 'Click' },
        { value: 100, name: 'Show' },
      ],
    },
  ],
}
```
