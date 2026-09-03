import context from '../../../mix/context'

export default (params: any, stop: any) => {
  const events = context.component!.events;
  if (stop) {
    events.emit('debugTarget', {
      src: undefined
    });
    return;
  }
  const page = params.focusArea.ele.closest('[data-zone-title]');
  const src = page?.getAttribute('data-zone-title');
    events.emit('debugTarget', {
    src
  })
}