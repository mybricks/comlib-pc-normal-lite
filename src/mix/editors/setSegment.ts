import context from '../context'
import { undoRedoManager } from './undoRedo'

/**
 * 只支持同级拖拽，无法拖到parent外
 */
export default function () {
  return {
    '@updateSegment'(ctx: any, type: string, options: any) {
      // console.log('@setSegment', {ctx, type, options})
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

        let from
        let to

        if (fromEle.dataset['customComWrapper']) {
          from = JSON.parse(fromEle.dataset['customComWrapper'])
        } else if (fromEle.parentElement.dataset['customComWrapper']) {
          from = JSON.parse(fromEle.parentElement.dataset['customComWrapper'])
        } else {
          const loc = JSON.parse(fromEle.dataset['loc'])
          from = {
            fileName: loc.files.jsx,
            jsx: loc.jsx
          }
        }

        if (toEle.dataset['customComWrapper']) {
          to = JSON.parse(toEle.dataset['customComWrapper'])
        } else if (toEle.parentElement.dataset['customComWrapper']) {
          to = JSON.parse(toEle.parentElement.dataset['customComWrapper'])
        } else {
          const loc = JSON.parse(toEle.dataset['loc'])
          to = {
            fileName: loc.files.jsx,
            jsx: loc.jsx
          }
        }

        const { fileName } = from

        if (!fileName) return

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
      }
    }
  }
}