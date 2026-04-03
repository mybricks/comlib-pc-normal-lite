# dom-to-json — 架构说明

> 将 MyBricks 画布的 Shadow DOM 转换为 Figma 插件可消费的 JSON 格式。

---

## 目录结构

```
dom-to-json/
  README.md          ← 本文档
  index.js           ← 公共 API 入口，domToMybricksJson（含 walk）+ exports
  dom-helpers.js     ← DOM / Shadow DOM 底层工具、坐标系
  css-parsers.js     ← CSS 字符串解析（渐变、阴影、颜色、SVG）
  style-builder.js   ← CSS 样式 → Figma JSON（buildStyleJSON、字体）
  layout-utils.js    ← Auto Layout 间距 / margin 逻辑
  node-builder.js    ← 节点类型推断、文本内容、伪元素
  image-inline.js    ← 异步图片内联（base64）
```

---

## 分层依赖关系

```
index.js  （Public API）
  ├── image-inline.js
  ├── node-builder.js
  │     ├── style-builder.js
  │     │     ├── css-parsers.js
  │     │     └── dom-helpers.js
  │     ├── css-parsers.js
  │     └── dom-helpers.js
  ├── layout-utils.js
  │     └── dom-helpers.js
  └── style-builder.js
        ├── css-parsers.js
        └── dom-helpers.js
```

**规则：下层文件不依赖上层，依赖关系单向。**

---

## 各层职责

### `dom-helpers.js` — 第 1 层（无外部依赖）

DOM 底层工具，所有其他模块都可能用到。

| 函数 | 说明 |
|------|------|
| `getGeoviewScaleAndOrigin` | 读取 `_geoview-wrapper_` 的 scale 与原点，建立设计稿坐标系 |
| `getDesignRect` | 元素 `DOMRect` → 设计稿坐标矩形（除以 scale，减原点） |
| `hasClassPrefix` | 判断元素是否有任意 class 以指定前缀开头 |
| `simpleSelectorMatches` | 简单 CSS 选择器（.class / #id / tag）匹配 |
| `getMatchedSelectorsForElement` | 在 cssRuleMap 里收集匹配当前元素的选择器列表 |
| `getDeclaredStyleForElement` | 合并 cssRuleMap 中匹配元素的声明样式 |
| `getFrameTitleFromElement` | 从 `boardTitle-` 下 `tt-` 子节点取画布标题 |
| `emptyRoot` | 返回空的导出结构（保证 parser 不报 "missing page object"） |
| `findArtboardIdFromElement` | 向上查找 class 以 `artboard-` 开头的祖先元素 id |
| `getShadowHost` | 获取 Shadow DOM 宿主元素 |
| `resolveFrameRoot` | 由 `frameId` 在 ShadowRoot 内定位画布 body 根节点 |
| `getCssRulesBySelector` | 从 `<style id="...">` 构建 `selector → cssText` 映射 |

---

### `css-parsers.js` — 第 2 层

CSS 字符串 → 结构化数据，纯转换，不读 DOM 样式表。

| 函数 | 说明 |
|------|------|
| `cssColorToRgba` | CSS 颜色字符串 → `rgba(r, g, b, a)` 格式 |
| `cssColorToHex` | CSS 颜色字符串 → `#rrggbb` 十六进制 |
| `parseLinearGradientFromBgImage` | `linear-gradient(...)` → Figma GRADIENT_LINEAR 结构 |
| `parseRadialGradientFromBgImage` | `radial-gradient(...)` → Figma GRADIENT_RADIAL 结构 |
| `parseBoxShadow` | `box-shadow` 字符串 → 阴影数组（仅外阴影） |
| `parseBorderShorthand` | `border` 简写 → `{ width, style, color }` |
| `parseGridTemplateColumnsCount` | `grid-template-columns` → 列数 |
| `parseTransformRotation` | `transform` 字符串 → 旋转角度（度） |
| `parseUrlFromBgImage` | `background-image` → 提取 url 字符串 |
| `normalizeSvgPathForFigma` | SVG path `d` 属性规范化（命令与数字间加空格） |
| `serializeSvgElement` | SVG 元素序列化为字符串，替换 currentColor 和 width/height |

---

### `style-builder.js` — 第 3 层

CSS 样式 → Figma JSON 风格对象，是体积最大的功能块。

| 函数 | 说明 |
|------|------|
| `parseFontFamilyStack` | `font-family` 字符串 → 字体名数组 |
| `resolveFontFamilyFromStack` | 从字体栈中选出可用的实体字体名（跳过系统泛名） |
| `getGlobalFont` | 从画布根元素推断「全局默认字体」，减少节点重复输出 |
| `buildInlineTextStyle` | 为行内/子文本节点构建 style 对象（相对父坐标） |
| `buildStyleJSON` | **核心**：`computed + cssRuleMap + 几何 → Figma style JSON`（布局、填充、描边、阴影等全量映射） |

---

### `layout-utils.js` — 第 3 层

Auto Layout 的间距 / margin 处理，只操作 JSON 节点对象，不读 DOM。

| 函数 | 说明 |
|------|------|
| `getM` | 读取节点 style 某一侧的 margin 数值 |
| `pruneChildMarginsAfterGapMerge` | gap 合并后按规则删除子节点 margin，避免间距重复 |
| `anyChildHasMargin` | 判断子节点列表中是否有负 margin（用于降级绝对布局） |
| `childrenHaveUniformMargin` | 判断子节点主轴 margin 是否一致 |
| `applyUniformMarginAsGap` | 将均匀的子节点 margin 转为父级 `itemSpacing` |
| `ensureItemSpacingFromPositions` | 根据子节点坐标反推 `itemSpacing`（无 margin 时兜底） |

---

### `node-builder.js` — 第 4 层

节点类型推断、文本内容提取、伪元素处理。

| 函数 | 说明 |
|------|------|
| `inferNodeType` | 根据标签与 computed style 推断 `text / frame / image / component` |
| `shouldSetTextAlignVerticalCenterForAbsoluteTextLeaf` | 绝对定位文本叶子是否需要设 `textAlignVertical: CENTER` |
| `shouldMergeTextAndBrChildren` | 是否将子节点中文本与 `<br>` 合并为一段导出 |
| `mergeTextAndBrChildNodesContent` | 合并文本与 `<br>` 为带换行的字符串 |
| `getElementContentsTextBlockRect` | 测量元素内文本块整体包围矩形 |
| `getTextNodeRect` | 测量单个文本节点的包围矩形 |
| `shouldMarkWidthConstrainedForEdgeWhitespace` | 是否因两侧空白标记为宽度受容器约束 |
| `applyWidthConstrainedForFigmaEdgeWhitespace` | 设置 `widthConstrained` 等字段适配 Figma |
| `applyTextOverflowEllipsisExport` | 处理 `text-overflow: ellipsis` 相关导出字段 |
| `normalizeTextExportPreserveTrailing` | 规范化导出文本的空白与换行策略 |
| `getTextContent` | 获取元素用于导出的文本内容（含合并策略） |
| `getTextWithActualLineBreaksForElement` | 按 DOM 实际断行插入 `\n` |
| `isShowingPlaceholder` | 判断 `input / textarea` 是否正在显示 placeholder |
| `getPseudoTextNode` | 将含文本的 `::before / ::after` 伪元素导出为子节点 |
| `getPseudoShapeNode` | 将含背景色 / border 的伪元素导出为矩形子节点 |

---

### `image-inline.js` — 第 4 层（异步）

异步图片内联，不参与主流程 `walk`，仅在「带图片导出」时调用。

| 函数 | 说明 |
|------|------|
| `fetchImageAsBase64DataUrl` | fetch 远程图片并转为 base64 data URL（SVG 先光栅化为 PNG） |
| `inlineImageFillsInTree` | 递归遍历 JSON 节点树，将所有图片 URL 内联为 base64 |

---

### `index.js` — 第 5 层（公共 API）

对外暴露的入口函数，包含核心遍历逻辑 `walk`。

> `walk` 作为 `domToMybricksJson` 的**内部闭包**保留，因其依赖外层的
> `geo / cssRuleMap / globalFont` 等上下文变量，提取为独立函数收益有限。

| 函数 | 说明 |
|------|------|
| `domToMybricksJson(frameId, styleTagId, _rootElOverride?)` | **主入口**：从 Shadow DOM 画布帧导出完整 JSON，内含 `walk` 遍历 |
| `elementToMybricksJson(el, styleTagId?)` | 对任意 DOM 元素直接导出（薄包装，委托给 `domToMybricksJson`） |
| `comToMybricksJson(comId)` | 按组件 id 导出：向上找 artboard → 调用 `domToMybricksJson` |
| `domToMybricksJsonWithInlineImages(frameId, styleTagId?)` | 同 `domToMybricksJson`，但图片异步内联为 base64（返回 Promise） |
| `comToMybricksJsonWithInlineImages(comId)` | 同 `comToMybricksJson`，带图片内联 |
| `elementToMybricksJsonWithInlineImages(el, styleTagId?)` | 同 `elementToMybricksJson`，带图片内联 |

---

## 新增功能时的检查清单

1. **inferNodeType**：新 HTML 元素会给它什么 type？这个 type 在 Figma 中能否承载其所有视觉属性（`TextNode` 不支持 `strokes`）？
2. **buildStyleJSON**：新属性的读取是否经过「声明值可用性检查」（含 `var(` / `calc(` 的值必须降级到 `computed`）？
3. **walk 子树处理**：新节点类型是否有子节点需要递归，伪元素是否需要额外处理？
4. **Figma 约束**：`layoutSizingHorizontal=FIXED` 时 `layoutAlign` 无法设为 `CENTER`；Auto Layout 子节点设 `x/y` 会触发隐式 `ABSOLUTE` positioning。

---

## 已知 Figma API 约束

| 约束 | 影响 | 当前处理方式 |
|------|------|------|
| `layoutSizingHorizontal=FIXED` 时 `layoutAlign` 不接受 `CENTER` | 固定宽度子节点无法单独居中 | 检测到几何居中后，改为设置父容器 `counterAxisAlignItems=CENTER`（仅当所有兄弟节点均为全宽时） |
| Auto Layout 子节点设 `x/y` 触发隐式 `ABSOLUTE` | `layoutAlign` 等流式属性失效 | `layout.ts` 中对非 absolute 子节点跳过 `x/y` 赋值 |
| `strokeAlign=INSIDE` 被子节点填充覆盖 | border 某边消失 | 统一设为 `strokeAlign=OUTSIDE` |
| TextNode 不支持 `strokes` | 有 border 的文本元素边框丢失 | 有 border 的叶子节点强制升级为 `frame` 类型 |
