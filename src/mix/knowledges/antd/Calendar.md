# Calendar

## API

通用属性参考：[通用属性](/docs/react/common-props)

| 参数 | 说明 | 类型 | 默认值 | 版本 |
| --- | --- | --- | --- | --- |
| cellRender | 自定义单元格的内容 | function(current: dayjs, info: { prefixCls: string, originNode: React.ReactElement, today: dayjs, range?: 'start' \| 'end', type: PanelMode, locale?: Locale, subType?: 'hour' \| 'minute' \| 'second' \| 'meridiem' }) => React.ReactNode | - | 5.4.0 |
| dateFullCellRender | 自定义渲染日期单元格，返回内容覆盖单元格，>= 5.4.0 请用 `fullCellRender` | function(date: Dayjs): ReactNode | - | < 5.4.0 |
| fullCellRender | 自定义单元格的内容 | function(current: dayjs, info: { prefixCls: string, originNode: React.ReactElement, today: dayjs, range?: 'start' \| 'end', type: PanelMode, locale?: Locale, subType?: 'hour' \| 'minute' \| 'second' \| 'meridiem' }) => React.ReactNode | - | 5.4.0 |
| defaultValue | 默认展示的日期 | [dayjs](https://day.js.org/) | - |  |
| disabledDate | 不可选择的日期，参数为当前 `value`，注意使用时[不要直接修改](https://github.com/ant-design/ant-design/issues/30987) | (currentDate: Dayjs) => boolean | - |  |
| fullscreen | 是否全屏显示 | boolean | true |  |
| headerRender | 自定义头部内容 | function(object:{value: Dayjs, type: string, onChange: f(), onTypeChange: f()}) | - |  |
| locale | 国际化配置 | object | [(默认配置)](https://github.com/ant-design/ant-design/blob/master/components/date-picker/locale/example.json) |  |
| mode | 初始模式 | `month` \| `year` | `month` |  |
| validRange | 设置可以显示的日期 | \[[dayjs](https://day.js.org/), [dayjs](https://day.js.org/)] | - |  |
| value | 展示日期 | [dayjs](https://day.js.org/) | - |  |
| onChange | 日期变化回调 | function(date: Dayjs) | - |  |
| onPanelChange | 日期面板变化回调 | function(date: Dayjs, mode: string) | - |  |
| onSelect | 选择日期回调，包含来源信息 | function(date: Dayjs, info: { source: 'year' \| 'month' \| 'date' \| 'customize' }) | - | `info`: 5.6.0 |

## FAQ

### 如何在 Calendar 中使用自定义日期库

参考 [使用自定义日期库](/docs/react/use-custom-date-library#calendar)。

### 如何给日期类组件配置国际化？

参考 [如何给日期类组件配置国际化](/components/date-picker-cn#%E5%9B%BD%E9%99%85%E5%8C%96%E9%85%8D%E7%BD%AE)。

### 为什么时间类组件的国际化 locale 设置不生效？

参考 FAQ [为什么时间类组件的国际化 locale 设置不生效？](/docs/react/faq#为什么时间类组件的国际化-locale-设置不生效)。

## 最佳实践

### 最佳实践-日历的基础使用
要点：
- 引用*Calendar*
- 使用*dayjs*类型来设置和获取value

```jsx file="runtime.jsx"
imoprt react from 'react';
import { Calendar } from 'antd';
import dayjs from 'dayjs';

export default comRef(({ data }) => {
  return (
    <Calendar
      defaultValue={dayjs()}
    />
  );
}, {
  type: 'main',
  title: '日历的基础使用',
});
```