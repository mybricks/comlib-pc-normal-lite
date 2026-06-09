import context from '../../context'
import { undoRedoManager } from '../undoRedo'

const updateText = (options) => {
  const { fromEle, content } = options
  if (!content.trim()) {
    // 不允许空字符
    return
  }
  let zoneTextEditable = fromEle.dataset['zoneTextEditable']

  if (zoneTextEditable) {
    // 如果有 data-zone-text-editable 属性，可以直接改代码
    zoneTextEditable = JSON.parse(zoneTextEditable)
    const loc = JSON.parse(fromEle.dataset.loc)
    const fileName = loc.files.jsx
    const source = decodeURIComponent(
      context.component!.params.data.files.find((file) => {
        return file.fileName === fileName
      })
      .source
    )
    const newCode = source.slice(0, zoneTextEditable.jsx.start) + 
      content.split("\n").join("<br/>") +
      source.slice(zoneTextEditable.jsx.end)

    undoRedoManager.execute({
      execute() {
        context.updateFile({fileName, content: newCode, type: ''})
        context.saveManualVersion([fileName])
      },
      undo() {
        context.updateFile({fileName, content: source, type: ''})
        context.saveManualVersion([fileName])
      },
    })
  } else {
    const message = `将当前聚焦元素的文字内容修改为 "${content}"` + 
      ""
      // "\n当前聚焦元素的文字内容来自变量，请修改对应变量的值，但不要改变代码结构"

    const componentId = context.component!.params.id
    ;(window as any)._sandbox_?.helpers?.sendToAgent?.(componentId, { message })
  }
}

export default updateText
