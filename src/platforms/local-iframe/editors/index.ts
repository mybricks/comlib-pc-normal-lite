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
import auditPage from './auditPage'
import viewCode from './viewCode'
import resizePage from './resizePage'

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
    '[class]': {
      items: [
        noteRender
      ]
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
    '@viewCode': viewCode
  }
}