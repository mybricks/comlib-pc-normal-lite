import myContext from '../context'

export default (params: any, stop: any) => {
  const page = params.focusArea.ele.closest('[data-zone-title]');
  const src = page?.getAttribute('data-zone-title');
  myContext.refresh.events.emit('refreshTarget', {
    src
  })
}