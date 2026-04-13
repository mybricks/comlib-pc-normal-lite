import context from '../context'

const item =  {
  type: 'textarea',
  title:'修改内容',
  value: {
    get(params) {
      const { focusArea } = params
      const text = focusArea.ele.innerText
      return text
    },
    set(params, value) {
      if (!value.trim()) {
        // 不允许空字符
        return
      }
      const { id, data, focusArea } = params
      try {
        const loc = JSON.parse(focusArea.dataset.loc)
        const fileName = loc.files.jsx
        const file = data.files.find((file) => file.fileName === fileName)
        const source = decodeURIComponent(file.source)
        const textloc = JSON.parse(focusArea.dataset.zoneTextEditable)
        const nextValue = value.split("\n").join("<br/>")
        const before = source.slice(loc.jsx.start, loc.jsx.end)
        const after = source.slice(loc.jsx.start, loc.tag.end) + source.slice(loc.tag.end, loc.jsx.end).replace(source.slice(textloc.jsx.start, textloc.jsx.end).trim(), nextValue)
        const newCode = source.replace(before, after)
        context.updateFile(id, { fileName, content: newCode, type: '' })
      } catch (e) {
        console.error('[data-zone-text-editable]: set', e)
      }
    }
  }
}

const getDataZoneTextEditable = () => {
  return {
    '[data-zone-text-editable]': {
      '@dblclick': item,
      items: [item]
    }
  }
}

export { getDataZoneTextEditable }