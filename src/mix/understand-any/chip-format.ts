import { copy } from './index.i18n'

export function formatUnderstandChips({ message, chips }: { message: string; chips: Array<{ id: string; label: string; data?: { zoneId?: string; isNew?: boolean } }> }) {
  let resolved = message
  const regions: string[] = []
  for (const chip of chips) {
    const zoneId = chip.data?.zoneId
    if (typeof zoneId !== 'string' || !zoneId) continue
    const isNew = chip.data?.isNew === true
    resolved = resolved.split(`[[chip:${chip.id}]]`).join(isNew ? copy.currentRegion() : `@${chip.label}`)
    regions.push(copy.regionId(zoneId, isNew))
  }
  return regions.length ? `${resolved}\n\n<referenced-nodes type="understand" note="${copy.regionNote()}">\n${regions.join('\n')}\n</referenced-nodes>` : resolved
}
