import validator from './validator'
import { getMybricksUsage } from './usage'

export default {
  name: 'mybricks',
  version: 'builtin',
  usage: getMybricksUsage,
  // [TODO] 临时，这里mybricks相关usage还存在耦合
  usagenext: require('./usagenext.md').default,
  validator
}
