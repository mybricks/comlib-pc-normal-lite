import prototype from '../../../utils/ai-code/render/mybricks/prototype'

export function buildHooks() {
  return {
    '@switchPageShowType'(params, value) {
      const path = params.focusArea.dataset.desnPage

      prototype.events.emit(path, value)
    }
  }
}
