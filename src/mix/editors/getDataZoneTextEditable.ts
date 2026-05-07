import context from '../context'

const item = {
  type: 'textarea',
  title: '文案',
  options: {
    autoSize: {minRows: 7}
  },
  value: {
    get(params) {
      const {data, focusArea} = params
      try {
        const loc = JSON.parse(focusArea.dataset.loc)
        const fileName = loc.files.jsx
        const file = data.files.find((file) => file.fileName === fileName)
        const source = decodeURIComponent(file.source)
        const textloc = JSON.parse(focusArea.dataset.zoneTextEditable)
        const text = source.slice(textloc.jsx.start, textloc.jsx.end)
        return text
          .replace(/<br\s*\/?>/gi, '\uE000')    // 1. 用占位符标记 <br/>
          .replace(/\s+/g, ' ')                 // 2. 空白符折叠为单个空格
          .replace(/ ?\uE000 ?/g, '\n')         // 3. 恢复为换行，移除br前后的空格
          .trim()                               // 4. 移除首尾空白
      } catch (e) {
        // console.error('[data-zone-text-editable]: set', e)
      }
      return focusArea.ele.innerText
    },
    set(params, value) {
      if (!value.trim()) {
        // 不允许空字符
        return
      }
      const {id, data, focusArea} = params
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
        context.updateFile(id, {fileName, content: newCode, type: ''})
        context.saveManualVersion(id, [fileName])
      } catch (e) {
        // console.error('[data-zone-text-editable]: set', e)
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

export {getDataZoneTextEditable}