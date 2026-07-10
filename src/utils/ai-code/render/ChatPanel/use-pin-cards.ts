import { useState } from 'react'
import { isSamePinnedCard, makePinKey, type PinnedCard } from './pin-card-utils'

/**
 * Pin 功能逻辑层 Hook。
 *
 * 存储层为组件内部纯内存（useState），不依赖外部存储。
 * 提供 pin / unPin / isPinned 操作和 pinnedCards 状态。
 */
export function usePinCards() {
  const [pinnedCards, setPinnedCards] = useState<PinnedCard[]>([])

  const pin = (name: string, props: Record<string, any>) => {
    const pinKey = makePinKey(name, props)
    setPinnedCards((prev) => {
      if (prev.some((card) => isSamePinnedCard(card, name, props))) return prev
      return [...prev, { pinKey, name, props, pinnedAt: Date.now() }]
    })
  }

  const unPin = (pinKey: string) => {
    setPinnedCards((prev) =>
      prev.filter((card) => card.pinKey !== pinKey && makePinKey(card.name, card.props) !== pinKey),
    )
  }

  const isPinned = (name: string, props: Record<string, any>) =>
    pinnedCards.some((card) => isSamePinnedCard(card, name, props))

  return { pinnedCards, pin, unPin, isPinned }
}
