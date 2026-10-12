import { Events } from '../../../utils/events'

export class Refresh {
  events = new Events<{
    refreshTarget: {
      src: string
    }
  }>()
}
