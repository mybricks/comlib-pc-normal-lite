# dnd-kit
> 这是一个轻量、高性能、易于使用并且可扩展的基于React的拖放工具包。

> 所有的拖拽、拖放相关需求都要使用以下提供的类库，各类库都列出了提供的api和其能力，禁止使用原生html的拖拽能力。

## @dnd-kit/core
> 核心库，提供构建拖放能力时必要的核心模块。

- DndContext：它是 React Context Provider，拖放容器，所有可拖放的组件都必须确保嵌套在 DndContext 下。
- useDraggable：它是 React Hooks，可以将 DOM 节点转变为可在拖放容器上拾取、移动和放置的可拖动源。
- useDroppable：它是 React Hooks，可以将 DOM 节点设置为可拖放元素的可拖放区域。


## @dnd-kit/modifiers
> 修饰符预设，允许动态地修改传感器检测到的运动坐标，可以单独或组合使用。

- createSnapModifier：创建一个snap modifier（吸附修饰符），它可以使得拖拽元素在拖动过程中吸附到特定的点或线上。例如，可以用于网格布局中，使得拖拽元素吸附到网格线上。
- restrictToHorizontalAxis：限制只能在水平轴（X轴）移动，禁止垂直轴（Y轴）移动。
- restrictToVerticalAxis：限制只能在垂直轴（Y轴）移动，禁止水平轴（X轴）移动。
- restrictToParentElement：限制只能在其父元素内部移动，禁止超出父元素边界。
- restrictToFirstScrollableAncestor：限制拖拽元素只能在第一个可滚动的祖先元素内移动。如果拖拽元素接近祖先元素的边界，祖先元素会滚动，而不是让拖拽元素超出边界。
- restrictToWindowEdges：限制拖拽元素只能在视口（window）的边缘内移动，防止拖拽元素移出视口范围。
- snapCenterToCursor：拖拽元素在拖动时，控制中心点吸附到鼠标光标的中心。这可以用于精确控制拖拽元素的位置，使其更容易对齐。


## @dnd-kit/sortable
> 用于构建可排序的拖放列表，当拖放的同时需要排序能力时，必须同时使用这个库来共同实现。

- SortableContext：它是 React Context Provider，用于管理可排序列表的状态和行为。它提供了必要的上下文信息，使得列表中的元素可以被排序。
- useSortable：它是 React Hooks，用于将 DOM 节点转变为可排序的元素。它允许元素在列表中被拖动时改变其顺序，并且处理排序逻辑，如拖动开始、拖动结束以及元素位置的更新。

## @dnd-kit/utilities


