import context from '../context'
import { undoRedoManager } from './undoRedo'

export default function () {
  return {
    '@updateSegment'(ctx: any, type: string, options: any) {
      console.log('@setSegment', {ctx, type, options})
      if (type === 'changeOrder') {
        const { fromEle, toEle, type } = options

        if (fromEle === toEle) {
          // 相对自己移动
          return
        }

        // 位置信息接口：记录 JSX 片段的字符偏移、标签结束位置、代码行号、关联文件路径及类名
        interface Loc {
          jsx: {
            start: number,
            end: number
          },
          tag: {
            end: number
          },
          codeLine: {
            start: number,
            end: number
          },
          files: {
            jsx: string
            less: string
          },
          cn: string[]
        }

        // 解析拖拽源元素的位置信息
        const from: { ele: HTMLElement; loc: Loc; } = {
          ele: fromEle,
          loc: JSON.parse(fromEle.dataset.loc),
        }

        // 解析拖拽目标元素的位置信息
        const to: { ele: HTMLElement; loc: Loc; } = {
          ele: toEle,
          loc: JSON.parse(toEle.dataset.loc),
        }

        // 获取 JSX 文件路径（以 from 元素为准）
        const jsxPath = from.loc.files.jsx

        if (!jsxPath) return

        // 从组件参数中查找对应的 JSX 源文件
        const aiComParams = context.component?.params
        const jsxFile = aiComParams?.data?.files?.find(
          (f: { fileName: string; source: string }) => f.fileName === jsxPath
        )
        if (!jsxFile) return

        // 解码源码字符串
        const source: string = decodeURIComponent(jsxFile.source)

        // 根据 data-loc 中的字符偏移量提取两个 JSX 片段
        const fromStart = from.loc.jsx.start
        const fromEnd = from.loc.jsx.end
        const toStart = to.loc.jsx.start
        const toEnd = to.loc.jsx.end
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
            context.updateFile({ fileName: jsxPath, content: newSource, type: undefined })
            context.saveManualVersion([jsxPath])
          },
          undo() {
            context.updateFile({ fileName: jsxPath, content: source, type: undefined })
            context.saveManualVersion([jsxPath])
          },
        })
      }
    }
  }
}