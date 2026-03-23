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

## 示例

```jsx
import { useRef, useEffect } from 'react';
import G6 from '@antv/g6';

export default function () {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const graph = new G6.Graph({
      container: containerRef.current,
      width: containerRef.current.offsetWidth,
      height: 400,
      data: {
        nodes: [
          { id: 'node1', data: { label: '节点1' } },
          { id: 'node2', data: { label: '节点2' } },
        ],
        edges: [
          { id: 'edge1', source: 'node1', target: 'node2' },
        ],
      },
      node: {
        style: {
          labelText: (d) => d.data.label,
        },
      },
    });

    graph.render();

    return () => {
      graph.destroy();
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: 400 }} />;
}
```

## 常用配置项

| 配置项 | 说明 | 类型 |
|--------|------|------|
| container | 容器 DOM 元素或 ID | HTMLElement \| string |
| width | 画布宽度 | number |
| height | 画布高度 | number |
| data | 图数据（nodes + edges） | GraphData |
| layout | 布局配置，如 force、dagre、circular 等 | LayoutOptions |
| node | 节点样式配置 | NodeOptions |
| edge | 边样式配置 | EdgeOptions |

## 常用布局

```js
// 力导向布局
layout: { type: 'force', linkDistance: 100 }

// 层次布局（DAG）
layout: { type: 'dagre', rankdir: 'LR', nodesep: 20, ranksep: 50 }

// 圆形布局
layout: { type: 'circular', radius: 200 }
```
