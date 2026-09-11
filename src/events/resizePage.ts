import { Events } from '../utils/events'

export default new Events<Record<string, {
  width: number
  height: number
}>>()