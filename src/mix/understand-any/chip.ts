import { randomUUID } from '../utils/uuid'
import { copy } from './index.i18n'
import { formatUnderstandChips } from './chip-format'

export function createUnderstandChip(zoneId: string, title?: string, isNew = false) {
  return { id: randomUUID(), type: 'understand', label: title || copy.document(), data: { zoneId, isNew } }
}

export const understandChipDef = { type: 'understand', format: formatUnderstandChips }
