export function formatUnderstandChips({ message, chips }: { message: string; chips: Array<{ id: string; label: string; data?: { zoneId?: string; isNew?: boolean } }> }) {
  let resolved = message
  const regions: string[] = []
  for (const chip of chips) {
    const zoneId = chip.data?.zoneId
    if (typeof zoneId !== 'string' || !zoneId) continue
    const isNew = chip.data?.isNew === true
    resolved = resolved.split(`[[chip:${chip.id}]]`).join(isNew ? '当前可视化区域' : `@${chip.label}`)
    regions.push(isNew
      ? `区域 ID：${JSON.stringify(zoneId)}；该区域尚未绑定文档，请为该区域新建可视化文档并绑定此区域。`
      : `区域 ID：${JSON.stringify(zoneId)}`)
  }
  return regions.length ? `${resolved}\n\n<referenced-nodes type="understand" note="上方引用的可视化区域及文档状态。">\n${regions.join('\n')}\n</referenced-nodes>` : resolved
}
