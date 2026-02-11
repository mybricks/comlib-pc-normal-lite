### 使用文档：雷达图
雷达图主要用于表现多变量的数据，例如球员的各个属性分析。

包含图表：雷达图、圆形雷达图。

#### 特有属性
- option.radar
  只适用于雷达图的坐标系配置
- option.radar.shape 默认值=polygon
  雷达图绘制类型，支持 'polygon' 和 'circle'
- option.radar.indicator
  雷达图的指示器，用来指定雷达图中的多个变量（类比到笛卡尔坐标系的X轴），如下示例。
  ```javascript
  indicator: [
    { name: '销售（sales）', max: 6500 },
    { name: '管理（Administration）', max: 16000, color: 'red' }, // 标签设置为红色
    { name: '信息技术（Information Techology）', max: 30000 },
    { name: '客服（Customer Support）', max: 38000 },
    { name: '研发（Development）', max: 52000 },
    { name: '市场（Marketing）', max: 25000 },
  ]
  ```
#### 最佳实践-雷达图
要点：
- 声明一个*type*为radar的系列。
- 配置*radar*属性，配置*radar.indicator*用于展示不同维度指示器及其顶点配置。
- 配置*radar*属性，配置*radar.shape*用于展示多边形还是圆形的雷达图，默认使用 polygon 多边形。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  tooltip: {}, // 雷达图一般默认使用空对象
  radar: {
    shape: 'polygon',
    indicator: [ // 绘制雷达图不同维度的指示器，并且设置其最大值
      { name: 'Sales', max: 6500 },
      { name: 'Administration', max: 16000 },
      { name: 'Information Technology', max: 30000 },
      { name: 'Customer Support', max: 38000 },
      { name: 'Development', max: 52000 },
      { name: 'Marketing', max: 25000 },
    ],
  },
  series: [
    {
      name: 'Budget vs spending',
      type: 'radar',
      data: [ // 两条对比数据
        {
          value: [4200, 3000, 20000, 35000, 50000, 18000],
          name: 'Allocated Budget',
        }
      ],
    },
  ],
}
```


#### 最佳实践-雷达图-不同维度数据的对比
要点：
- 在雷达图中，多个维度数据的对比，我们直接在原有系列上的data属性上添加即可。

```jsx file="runtime.jsx"
// 仅声明配置项代码
option = {
  // 省略配置
  tooltip: {}, // 雷达图一般默认使用空对象
  radar: {
    shape: 'polygon',
    indicator: [ // 绘制雷达图不同维度的指示器，并且设置其最大值
      { name: 'Sales', max: 6500 },
      { name: 'Administration', max: 16000 },
      { name: 'Information Technology', max: 30000 },
      { name: 'Customer Support', max: 38000 },
      { name: 'Development', max: 52000 },
      { name: 'Marketing', max: 25000 },
    ],
  },
  series: [
    {
      name: 'Budget vs spending',
      type: 'radar',
      data: [ // 两条对比数据
        {
          value: [4200, 3000, 20000, 35000, 50000, 18000], // 对比数据A
          name: 'Allocated Budget',
        },
        {
          value: [5000, 14000, 28000, 26000, 42000, 21000], // 对比数据B
          name: 'Actual Spending',
        },
      ],
    },
  ],
}
```