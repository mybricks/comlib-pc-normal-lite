# 简介
Ant Design 官方图标库，与 antd 配套使用。

## 如何引用
引用需要遵循此按需引用的方式
```javascript
import { SmileOutlined, HomeFilled } from '@ant-design/icons'
```

## 何时使用
- 与 antd 组件搭配时优先使用（如 Button 的 icon、Input 的 prefix/suffix）
- 需要通用线性/填充图标时使用

## 注意事项
- **只能使用允许列表中的图标名**，不要自行组合或推测图标名（如 `StarFilledOutlined` 并不存在）
- 动态渲染 icon 时，必须加存在性守卫，防止运行时报错：
  ```jsx
  // ✅ 正确：先判断存在再渲染
  import * as Icons from '@ant-design/icons'
  const IconComp = Icons[iconName];
  if (!IconComp) return null;
  return <IconComp />;
  
  // ❌ 错误：直接渲染可能不存在的图标
  return <Icons[iconName] />;
  ```
