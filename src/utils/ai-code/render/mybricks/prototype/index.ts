import { Events } from '../../../../events'

class ProtoType {
  events = new Events<{
    appConfig: any
    viewportId: any
  }>()
}

export default new ProtoType()
