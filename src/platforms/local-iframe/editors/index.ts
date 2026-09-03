import lowcode from '../../../mix/localIframe/buildHooks/lowcode'
import debug from './debug'
import style from './style'
import resizer from './resizer'
import commitUserActions from './commitUserActions'
import cancelUserActions from './cancelUserActions'
import updateSegment from './updateSegment'
import runTest from './runTest'
import setStyle from './setStyle'

export default function () {
  return {
    '@lowcode': lowcode,
    '@debug': debug,
    '[data-zone-selector]': {
      style: [
        {
          items: [
            style(),
            resizer(),
          ],
        },
      ],
    },
    '[data-zone-noselector]': {
      // style: [{ items: [] }],
    },
    '@commitUserActions': commitUserActions,
    '@cancelUserActions': cancelUserActions,
    '@updateSegment': updateSegment,
    '@setStyle': setStyle(),
    '@runTest': runTest
  }
}