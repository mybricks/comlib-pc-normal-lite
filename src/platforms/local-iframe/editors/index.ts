import lowcode from './lowcode'
import debug from './debug'
import style from './style'
import resizer from './resizer'
import commitUserActions from './commitUserActions'
import cancelUserActions from './cancelUserActions'
import updateSegment from './updateSegment'
import runTest from './runTest'
import setStyle from './setStyle'
import { undoRedoManager } from '../../../mix/editors/undoRedo'
import noteRender from './noteRender'
import getComments from './getComments'
import auditPage from './auditPage'
import viewCode from './viewCode'
import resizePage from './resizePage'
import doc from './doc'
import refresh from './refresh'
import zoneStatus from './zoneStatus'
import { buildPagePanel } from '../../../mix/editors/configs/pagePanel'

export default function (props) {
  return {
    '@lowcode': lowcode,
    '@debug': debug,
    '@refresh': refresh,
    '[data-loc]': {
      items: [
        noteRender,
      ]
      // style: [{ items: [] }],
    },
    '[class]': {
      items: [
        noteRender,
        style(),
        resizer(),
      ]
    },
    '[data-zone-selector]': {
      items: [
        style(),
        resizer(),
      ],
    },
    '@commitUserActions': commitUserActions,
    '@cancelUserActions': cancelUserActions,
    '@updateSegment': updateSegment,
    '@setStyle': setStyle(),
    // '@runTest': runTest,
    '@resizePage': resizePage,
    '@undo'() {
      undoRedoManager.undo()
    },
    '@redo'() {
      undoRedoManager.redo()
    },
    '@auditPage': auditPage,
    '@viewCode': viewCode,
    '@getComments': getComments,
    ...doc(),
    ...zoneStatus(props),
    '[data-zone-type=page]': buildPagePanel(props),
  }
}
