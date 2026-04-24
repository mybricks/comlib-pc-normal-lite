### 在项目、组件、页面内使用主题变量
对于<设计风格与主题变量>，在组件侧，提供了 `useDesignToken` hook。
`useDesignToken` 是一个 React Hook，用于在组件中获取当前主题的设计变量（Design Token），返回的DesignToken包含当前主题所有设计变量的对象。通过该 Hook，组件可以动态适配不同的主题配置，确保视觉风格的一致性。
通常，三方库会提供配置变量的能力，需根据三方库的说明来配置主题变量。

#### 使用方法
```jsx
import { comRef, useDesignToken } from 'mybricks';

export default comRef(() => {
  const token = useDesignToken();

  return token.colorPrimary;
});
```

#### 命名转换规则

CSS 变量与 JavaScript 对象属性遵循 **kebab-case → camelCase** 的自动转换：

| CSS 变量 | Token 属性 |
|----------|-----------|
| `--color-primary` | `colorPrimary` |
| `--color-success` | `colorSuccess` |
| `--border-radius-base` | `borderRadiusBase` |
| `--font-size-lg` | `fontSizeLg` |