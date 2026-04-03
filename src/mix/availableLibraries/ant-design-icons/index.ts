import { ICON_NAMES } from './iconNames'
import validator from './validator'

const usageMd: string = require('./usage.md').default

export default {
  name: '@ant-design/icons',
  version: '5.5.0',
  usage: usageMd + '\n\n## 可用图标列表\n' + ICON_NAMES.join(', '),
  validator,
}
