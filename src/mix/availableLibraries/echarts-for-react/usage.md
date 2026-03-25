# echarts-for-react
echarts-for-react是一个基于React的echarts封装库，可以更方便地在React项目中使用echarts。
- 依赖库：echatrs的5.x版本

## echarts-for-react注意事项
1、在配置图表的style属性时，尽量使用*100%*，除非用户主动提出需求，或者设计稿标注，则可以使用固定尺寸。

## echarts-for-react示例
```jsx
import react from 'react';
import ReactECharts from 'echarts-for-react';

export function () {
  return (<>
    <ReactECharts option={{}} />
  </>)
}
```
