# @antv/g6

@antv/g6 是一款图可视化引擎，支持绘制复杂的关系图、流程图、拓扑图等。

## 如何引用

```jsx
import G6 from '@antv/g6'
```

## 注意事项

- 在 React 组件中通过 `useRef` 持有容器 DOM，在 `useEffect` 中初始化图实例
- 图实例必须在组件卸载时调用 `graph.destroy()` 释放资源
- 容器尺寸建议使用 `width: '100%'`，高度给定固定值