import context from '../context'
import { undoRedoManager } from './undoRedo'
import { applyStyleToLessFile } from './styleProxy'

/**
 * buildAIReorderPrompt 的参数接口
 */
interface AIReorderOptions {
  /** 当前 JSX 文件的源码内容 */
  source: string
  /** JSX 文件名，AI 读文件时需要 */
  fileName: string
  from: {
    fileName: string
    jsx: { start: number; end: number }
    isMap: boolean,
    codeLine: { start: number; end: number }
    /** from 节点所在的 .map() 表达式整体的代码行范围（isMap=true 时存在） */
    mapCallLine?: { start: number; end: number }
  }
  to: {
    fileName: string
    jsx: { start: number; end: number }
    isMap: boolean,
    codeLine: { start: number; end: number }
    /** to 节点所在的 .map() 表达式整体的代码行范围（isMap=true 时存在） */
    mapCallLine?: { start: number; end: number }
  }
  /** 拖拽方向：放到目标节点之前还是之后 */
  direction: 'before' | 'after'
  /** from 节点在 map 兄弟列表中的 0-based 下标，-1 表示不在 map 内 */
  fromMapIndex: number
  /** to 节点在 map 兄弟列表中的 0-based 下标，-1 表示不在 map 内 */
  toMapIndex: number
  /** map 渲染的节点总数 */
  mapTotal: number
}

/**
 * 从源码字符串中按行号（1-based，闭区间）提取子字符串
 */
function extractLines(source: string, startLine: number, endLine: number): string {
  const lines = source.split('\n')
  return lines.slice(startLine - 1, endLine).join('\n')
}

/**
 * 为 map 渲染节点的拖拽排序组装 AI 提示词
 *
 * 场景分类：
 *   A. from=map内，to=map内  → 操作数据数组，交换两个元素的位置
 *   B. from=map外，to=map内  → AI 自行决策：插入数组 或 移到 map 块外侧
 *   C. from=map内，to=map外  → 从数组提取一项为静态节点
 */
function buildAIReorderPrompt({
  source,
  fileName,
  from,
  to,
  direction,
  fromMapIndex,
  toMapIndex,
  mapTotal,
}: AIReorderOptions): string {
  const fromSnippet = source.slice(from.jsx.start, from.jsx.end)
  const toSnippet = source.slice(to.jsx.start, to.jsx.end)
  const directionWord = direction === 'before' ? '之前' : '之后'

  // ── 场景 A：两者都在 .map() 回调中，调整数据数组元素顺序 ─────────────────
  if (from.isMap && to.isMap) {
    const mapCallSection = from.mapCallLine
      ? `\n所在 .map() 表达式（第 ${from.mapCallLine.start}~${from.mapCallLine.end} 行）：\n\`\`\`jsx\n${extractLines(source, from.mapCallLine.start, from.mapCallLine.end)}\n\`\`\`\n`
      : ''
    return `用户在 UI 上进行了拖拽操作。

文件：${fileName}

## 操作说明

UI 上将 .map() 列表中第 ${fromMapIndex} 项对应的节点（共 ${mapTotal} 项），
移动到第 ${toMapIndex} 项的${directionWord}。
${mapCallSection}
from 节点 JSX 片段（第 ${from.codeLine.start}~${from.codeLine.end} 行）：
\`\`\`jsx
${fromSnippet}
\`\`\`

to 节点 JSX 片段（第 ${to.codeLine.start}~${to.codeLine.end} 行）：
\`\`\`jsx
${toSnippet}
\`\`\`

## 要求

1. 请读取文件 ${fileName}，找到该 .map() 调用的数据数组定义
2. 数据数组可能定义在当前文件或其他关联文件（如 setup.ts）中，请自行查找
3. 将数组第 ${fromMapIndex} 项移动到第 ${toMapIndex} 项的${directionWord}
4. **不需要修改 JSX 模板结构，只修改数据数组**
5. 先说明你找到的数据数组位于哪个文件哪里，再输出修改代码`
  }

  // ── 场景 B：from 在 map 外，to 在 map 内 ──────────────────────────────────
  if (!from.isMap && to.isMap) {
    const mapCallSection = to.mapCallLine
      ? `\nto 节点所在 .map() 表达式（第 ${to.mapCallLine.start}~${to.mapCallLine.end} 行）：\n\`\`\`jsx\n${extractLines(source, to.mapCallLine.start, to.mapCallLine.end)}\n\`\`\`\n`
      : ''
    return `用户在 UI 上进行了拖拽操作，将一个静态 JSX 节点拖到了 .map() 渲染列表中。

文件：${fileName}

## 操作说明

将静态节点（from）放到 .map() 列表第 ${toMapIndex} 项的${directionWord}
（该 map 共 ${mapTotal} 项，目标是第 ${toMapIndex} 项）
${mapCallSection}
from 节点（静态，不在 map 中，第 ${from.codeLine.start}~${from.codeLine.end} 行）：
\`\`\`jsx
${fromSnippet}
\`\`\`

to 节点（map 内第 ${toMapIndex} 项，第 ${to.codeLine.start}~${to.codeLine.end} 行）：
\`\`\`jsx
${toSnippet}
\`\`\`

## 要求

**请先声明你的处理方案**，选择以下之一并说明理由：
- 方案1：将 from 对应的数据项插入到数组第 ${toMapIndex} 项的${directionWord}，并从 JSX 中移除原静态节点
- 方案2：将 from 静态节点整体移到 .map() 表达式块的${directionWord}，不修改数组

然后输出修改代码`
  }

  // ── 场景 C：from 在 map 内，to 在 map 外 ──────────────────────────────────
  const mapCallSection = from.mapCallLine
    ? `\nfrom 节点所在 .map() 表达式（第 ${from.mapCallLine.start}~${from.mapCallLine.end} 行）：\n\`\`\`jsx\n${extractLines(source, from.mapCallLine.start, from.mapCallLine.end)}\n\`\`\`\n`
    : ''
  return `用户在 UI 上进行了拖拽操作，将 .map() 列表中的一个节点拖到了外部静态位置。

文件：${fileName}

## 操作说明

将 map 数组第 ${fromMapIndex} 项（共 ${mapTotal} 项），
提取为静态节点放到 to 节点的${directionWord}
${mapCallSection}
from 节点（map 内第 ${fromMapIndex} 项，第 ${from.codeLine.start}~${from.codeLine.end} 行）：
\`\`\`jsx
${fromSnippet}
\`\`\`

to 节点（静态，第 ${to.codeLine.start}~${to.codeLine.end} 行）：
\`\`\`jsx
${toSnippet}
\`\`\`

## 要求

**请先声明你的处理方案**：
- 你将从数组第 ${fromMapIndex} 项提取哪些属性值作为静态节点的 props
- 删除数组该项后，若数组为空如何处理 .map() 表达式

然后输出修改代码`
}

/**
 * 只支持同级拖拽，无法拖到parent外
 */
export default function () {
  return {
    '@updateSegment'(ctx: any, type: string, options: any) {
      // console.log('@updateSegment', {ctx, type, options})
      if (type === 'changeOrder') {
        const { fromEle, toEle, type } = options
        // console.log('[options]', options)
        if (fromEle === toEle) {
          // 相对自己移动
          return
        }

        // 位置信息接口：记录 JSX 片段的字符偏移、标签结束位置、代码行号、关联文件路径及类名

        let from: any = {
          isMap: !!fromEle.dataset['zoneIsmap']
        }
        let to: any = {
          isMap: !!toEle.dataset['zoneIsmap']
        }

        if (!from.isMap) {
          if (fromEle.parentElement.dataset['customComWrapper']) {
            from = JSON.parse(fromEle.parentElement.dataset['customComWrapper'])
          } else {
            const loc = JSON.parse(fromEle.dataset['loc'])
            from = {
              fileName: loc.files.jsx,
              jsx: loc.jsx,
              isMap: !!fromEle.dataset['zoneIsmap']
            }
          }
        } else {
          const loc = JSON.parse(fromEle.dataset['loc'])
          from = {
            fileName: loc.files.jsx,
            jsx: loc.jsx,
            isMap: true,
            codeLine: loc.codeLine,
            mapCallLine: loc.mapCall ?? undefined
          }
        }

        if (!to.isMap) {
          if (toEle.parentElement.dataset['customComWrapper']) {
            to = JSON.parse(toEle.parentElement.dataset['customComWrapper'])
          } else {
            const loc = JSON.parse(toEle.dataset['loc'])
            to = {
              fileName: loc.files.jsx,
              jsx: loc.jsx,
              isMap: !!toEle.dataset['zoneIsmap']
            }
          }
        } else {
          const loc = JSON.parse(toEle.dataset['loc'])
          to = {
            fileName: loc.files.jsx,
            jsx: loc.jsx,
            isMap: true,
            codeLine: loc.codeLine,
            mapCallLine: loc.mapCall ?? undefined
          }
        }

        const { fileName } = from

        if (!fileName) return

        // 任意一方是 map 渲染节点，走 AI 修改
        if (from.isMap || to.isMap) {
          const aiComParams = context.component?.params
          const jsxFile = aiComParams?.data?.files?.find(
            (f: { fileName: string; source: string }) => f.fileName === from.fileName
          )
          if (!jsxFile) return

          const source: string = decodeURIComponent(jsxFile.source)

          /**
           * 自定义组件外层会被 wrapCustomComponentPlugin 额外套一层
           *   div[data-custom-com-wrapper] { display: contents }
           * 所以 fromEle / toEle 的实际 DOM 层级可能是：
           *
           *   mapContainer
           *     ├── div[data-custom-com-wrapper]   ← 自定义组件的外层 wrapper
           *     │     └── <CustomComp>[data-zone-ismap]   ← fromEle / toEle
           *     └── ...
           *
           * 也可能是原生标签直接挂在 mapContainer 下：
           *
           *   mapContainer
           *     ├── div[data-zone-ismap]   ← fromEle / toEle
           *     └── ...
           *
           * 为了统一处理，将 fromEle / toEle "提升"到 mapContainer 的直接子节点层级：
           * 若其直接父节点是 wrapper div，则用父节点代替自身作为"slot"元素。
           */
          const getSlotEle = (ele: HTMLElement): HTMLElement =>
            ele.parentElement?.dataset['customComWrapper'] ? ele.parentElement : ele

          const fromSlot = getSlotEle(fromEle)
          const toSlot   = getSlotEle(toEle)

          // 以 fromSlot 的父节点作为 map 容器
          const mapParent = fromSlot.parentElement
          const allMapSiblings = Array.from(mapParent?.children ?? [])
          const fromMapIndex = from.isMap ? allMapSiblings.indexOf(fromSlot) : -1
          const toMapIndex = to.isMap   ? allMapSiblings.indexOf(toSlot)   : -1
          const mapTotal = allMapSiblings.length

          const message = buildAIReorderPrompt({
            source,
            fileName: from.fileName,
            from,
            to,
            direction: type as 'before' | 'after',
            fromMapIndex,
            toMapIndex,
            mapTotal,
          })

          // console.log("[message]", message)

          const componentId = aiComParams?.model?.runtime?.id ?? aiComParams?.id
          ;(window as any)._sandbox_?.helpers?.sendToAgent?.(componentId, { message })
          return
        }

        // 从组件参数中查找对应的 JSX 源文件
        const aiComParams = context.component?.params
        const jsxFile = aiComParams?.data?.files?.find(
          (f: { fileName: string; source: string }) => f.fileName === fileName
        )
        if (!jsxFile) return

        // 解码源码字符串
        const source: string = decodeURIComponent(jsxFile.source)
        const fromStart = from.jsx.start
        const fromEnd = from.jsx.end
        const toStart = to.jsx.start
        const toEnd = to.jsx.end
        let newSource

        if (type === 'before') {
          if (fromStart < toStart) {
            // 移动到之前
            newSource = 
              source.slice(0, fromStart) + 
              source.slice(fromEnd, toStart) + 
              source.slice(fromStart, fromEnd) + 
              source.slice(toStart)
          } else {
            newSource = 
              source.slice(0, toStart) + 
              source.slice(fromStart, fromEnd) + 
              source.slice(toStart, fromStart) +
              source.slice(fromEnd)
          }
        } else {
          // 移动到之后
          if (fromStart > toStart) {
            // 目前不会触发这个逻辑
            newSource = 
              source.slice(0, toEnd) + 
              source.slice(fromStart, fromEnd) + 
              source.slice(toEnd, fromStart) +
              source.slice(fromEnd)
          } else {
            newSource = 
              source.slice(0, fromStart) + 
              source.slice(fromEnd, toEnd) +
              source.slice(fromStart, fromEnd) + 
              source.slice(toEnd)
          }
        }

        // 通过 undoRedoManager 提交变更，支持撤销/重做
        undoRedoManager.execute({
          execute() {
            context.updateFile({ fileName, content: newSource, type: undefined })
            context.saveManualVersion([fileName])
          },
          undo() {
            context.updateFile({ fileName, content: source, type: undefined })
            context.saveManualVersion([fileName])
          },
        })
      } else if (type === 'setPosition') {
        const { fromEle, top, left, right, bottom } = options

        // 过滤掉 undefined 的属性，只保留有值的 top/left/right/bottom
        const style: Record<string, number> = {}
        if (top !== undefined) style['top'] = top
        if (left !== undefined) style['left'] = left
        if (right !== undefined) style['right'] = right
        if (bottom !== undefined) style['bottom'] = bottom

        if (Object.keys(style).length === 0) return

        // 复用 styleProxy 的分流逻辑：有 static style-info → 改 tsx，否则 → 改 less
        // 传入 no-op ctx（applyStyleToLessFile 末尾会调用 ctx.css.remove，此处无预览 CSS）
        const noopCtx = { css: { remove: () => {} } }
        applyStyleToLessFile(noopCtx, fromEle as HTMLElement, style, false)
      }
    }
  }
}