# 简介
- 建议使用的日期库：dayjs

## 如何引用
引用antd需要遵循此按需引用的方式
```jsx
import { Button, Image } from 'antd'
```

## 何时使用
antd组件我们分为三类：
1. 基础组件：比如图片(Image)、图标(Icon)、按钮(Button)、文本(Typography)，必须优先使用；
2. 必要组件：比如表单(Form)、标签页(Tabs)、导航菜单(Menu)、表格(Table)、进度条(Progress)、步骤条(Steps)等，可以大大减少代码开发成本，按需使用；
3. 便利性组件：比如列表(List)、卡片(Card)这类组件开发并不复杂，但是会降低样式的自由度，不推荐使用，仅在用户强制使用时选用。
