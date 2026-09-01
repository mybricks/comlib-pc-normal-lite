import { buildHooks } from '../../../mix/editors/hooks'

export default function () {
  return {
    '@lowcode': buildHooks()['@lowcode'],
    '[data-zone-noselector]': {}
  }
}