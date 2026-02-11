# 简介
轻量日期库，可搭配antd使用。

## 如何使用
```jsx
import react from 'react';
import { DatePicker } from 'antd';
import dayjs from 'dayjs';

export function () {
  return (<>
    <DatePicker
      value={dayjs()}
      picker="month" // 月份选择器
    />
  </>)
}
```