/** 已 pin 卡片的存储快照，记录重现所需的最小信息 */
export interface PinnedCard {
  /** 唯一键：由 name + 稳定序列化后的 props 生成，参数一致则认为是同一张卡 */
  pinKey: string
  /** 卡片 name（对应 CardDef.name）*/
  name: string
  /** 渲染 props 快照 */
  props: Record<string, any>
  /** pin 时间戳 */
  pinnedAt: number
}

/** 递归排序对象 key，保证 props 序列化结果稳定。 */
export function sortKeys(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(sortKeys)

  const sorted: Record<string, any> = {}
  Object.keys(obj)
    .sort()
    .forEach((key) => {
      sorted[key] = sortKeys(obj[key])
    })
  return sorted
}

/** 基于卡片名和稳定序列化 props 生成 pin 唯一 key。 */
export function makePinKey(
  name: string,
  props: Record<string, any> = {},
): string {
  return `${name}::${JSON.stringify(sortKeys(props))}`
}

/** 判断一张卡是否和指定 name + props 是同一个 pin 项。 */
export function isSamePinnedCard(
  pinned: PinnedCard,
  name: string,
  props: Record<string, any>,
): boolean {
  const pinKey = makePinKey(name, props)
  return (
    pinned.pinKey === pinKey ||
    (pinned.name === name && makePinKey(pinned.name, pinned.props) === pinKey)
  )
}
