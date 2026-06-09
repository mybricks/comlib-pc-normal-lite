import context from '../../context'

const runDelete = (options) => {
  const message = '删除当前聚焦的元素'
  const componentId = context.component!.params.id
  ;(window as any)._sendToAgent_source_ = 'dom_change'
  ;(window as any)._sandbox_?.helpers?.sendToAgent?.(componentId, { message })
}

export default runDelete
