import { Events } from '../../../utils/events'

export class Debug {
  events = new Events<{
    debugTarget: {
      src: string | undefined
    }
  }>()
}
