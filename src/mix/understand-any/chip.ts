import { randomUUID } from '../utils/uuid'
import { copy } from './index.i18n'
import { formatUnderstandChips } from './chip-format'

export function createUnderstandChip(zoneId: string) {
  return { id: randomUUID(), type: 'understand', label: copy.title(), data: { zoneId } }
}

export const understandChipDef = { type: 'understand', format: formatUnderstandChips }
