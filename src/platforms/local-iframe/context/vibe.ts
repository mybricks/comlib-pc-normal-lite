import { Events } from '../../../utils/events'

export class Vibe {
  private active = false

  events = new Events<{
    change: boolean
  }>()

  get isVibing() {
    return this.active
  }

  set isVibing(value: boolean) {
    if (this.active === value) return
    this.active = value
    this.events.emit('change', value)
  }
}
