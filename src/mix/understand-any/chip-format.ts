export function formatUnderstandChips({ message, chips }: { message: string; chips: Array<{ id: string; label: string; data?: { zoneId?: string } }> }) {
  let resolved = message
  const regions: string[] = []
  for (const chip of chips) {
    const zoneId = chip.data?.zoneId
    if (typeof zoneId !== 'string' || !zoneId) continue
    resolved = resolved.split(`[[chip:${chip.id}]]`).join(`@${chip.label}`)
    regions.push(`区域 ID：${JSON.stringify(zoneId)}`)
  }
  return regions.length ? `${resolved}\n\n<referenced-nodes type="understand" note="上方引用的业务图区域，供参考。">\n${regions.join('\n')}\n</referenced-nodes>` : resolved
}
