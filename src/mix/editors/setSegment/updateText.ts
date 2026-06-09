import context from '../../context'
import { undoRedoManager } from '../undoRedo'

const updateText = (options) => {
  console.log('@updateText', options)
  const { fromEle, content } = options
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
    console.log("这里没法直接修改了, 走ai调用")
  }
}

export default updateText
