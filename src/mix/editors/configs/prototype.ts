import prototype from '../../../utils/ai-code/render/mybricks/prototype'

export function buildHooks() {
  return {
    '@switchPageShowType'(params, value) {
      try {
        const path = params.focusArea.ele.getAttribute('data-desn-page')

        prototype.events.emit(path, {
          id: path,
          type: 'id',
          value
        })
      } catch (e) {
        console.error('@switchPageShowType:catch', e)
      }
    }
  }
}
