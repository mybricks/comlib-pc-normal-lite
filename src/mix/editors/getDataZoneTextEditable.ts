import context from '../context'

const getDataZoneTextEditable = () => {
  let oriText = null

  return {
    '[data-zone-text-editable]': {
      '@dblclick': {
        type: 'text',
        value: {
          get(params) {
            const { focusArea } = params
            const text = focusArea.ele.innerText
            oriText = text
            return text
          },
          set(params, value) {
            if (oriText === null || !value.trim()) {
              // 不允许空字符
              return
            }
            const { id, data, focusArea } = params
            try {
              const loc = JSON.parse(focusArea.dataset.loc)
              const fileName = loc.files.jsx
              const file = data.files.find((file) => file.fileName === fileName)
              const source = decodeURIComponent(file.source)
              const before = source.slice(loc.jsx.start, loc.jsx.end)
              const after = source.slice(loc.jsx.start, loc.tag.end) + source.slice(loc.tag.end, loc.jsx.end).replace(oriText, value)
              const newCode = source.replace(before, after)
              context.updateFile(id, { fileName, content: newCode, type: '' })
              oriText = value
            } catch (e) {
              console.error('[data-zone-text-editable]: set', e)
            }
          }
        }
      },
      items: [
        {
          type: 'text',
          title:'修改内容',
          value: {
            get(params) {
              const { focusArea } = params
              const text = focusArea.ele.innerText
              oriText = text
              return text
            },
            set(params, value) {
              if (oriText === null || !value.trim()) {
                // 不允许空字符
                return
              }
              const { id, data, focusArea } = params
              try {
                const loc = JSON.parse(focusArea.dataset.loc)
                const fileName = loc.files.jsx
                const file = data.files.find((file) => file.fileName === fileName)
                const source = decodeURIComponent(file.source)
                const before = source.slice(loc.jsx.start, loc.jsx.end)
                const after = source.slice(loc.jsx.start, loc.tag.end) + source.slice(loc.tag.end, loc.jsx.end).replace(oriText, value)
                const newCode = source.replace(before, after)
                context.updateFile(id, { fileName, content: newCode, type: '' })
                oriText = value
              } catch (e) {
                console.error('[data-zone-text-editable]: set', e)
              }
            }
          }
        }
      ]
    }
  }
}

export { getDataZoneTextEditable }
