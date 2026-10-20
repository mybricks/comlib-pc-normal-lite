export type SizeAxis = 'width' | 'height'
export type SizeOrigin = { kind: 'content' | 'external' | 'unknown'; reason: string }
export type SizeDecision = { kind: 'keep' } | { kind: 'protect'; value: string } |
  { kind: 'unknown'; reason: string }

/** 普通值快照：规则不读取 DOM，也不参与 Less / JSX 写入。 */
export interface SizeStyle {
  width?: string
  height?: string
  minWidth: string
  minHeight: string
  display: string
  position: string
  writingMode: string
  aspectRatio: string
  float: string
  flexDirection: string
  flexWrap: string
  flexGrow: number
  flexShrink: number
  flexBasis: string
  alignSelf: string
  alignItems: string
  autoMarginWidth: boolean
  autoMarginHeight: boolean
  overflowX: string
  overflowY: string
}

const content = (reason: string): SizeOrigin => ({ kind: 'content', reason })
const external = (reason: string): SizeOrigin => ({ kind: 'external', reason })
export const unknownSize = (reason: string): SizeOrigin => ({ kind: 'unknown', reason })
export const isFlexDisplay = (display: string) => display === 'flex' || display === 'inline-flex'
export const getFlexMainAxis = (direction: string): SizeAxis => direction.startsWith('column') ? 'height' : 'width'
export const pixels = (value: string): number | undefined => /^\d+(\.\d+)?px$/.test(value) ? parseFloat(value) : undefined
const isPercentage = (value: string) => /^\d+(\.\d+)?%$/.test(value)

export function classifyNormalFlowSize(style: SizeStyle, axis: SizeAxis, parent: SizeOrigin): SizeOrigin {
  const value = style[axis]!
  if (pixels(value) !== undefined) return external('明确尺寸')
  if (isPercentage(value)) return parent
  if (value !== 'auto') return unknownSize('尺寸表达式尚未支持')
  if (axis === 'height') return content('普通流内容高度')
  if (style.display.startsWith('inline-')) return content('行内盒子的内容宽度')
  return parent // 普通块的 auto 宽度填充外层，但外层也可能依赖内容。
}

/** Flex 主轴的 auto minimum 可能包含内容下限；滚动容器的自动下限为零。 */
function hasContentMinimum(style: SizeStyle, axis: SizeAxis): boolean {
  const minimum = axis === 'width' ? style.minWidth : style.minHeight
  const scrollable = [style.overflowX, style.overflowY].some(value => /^(auto|scroll|hidden)$/.test(value))
  return minimum === 'auto' && !scrollable
}

export function classifyFlexMainSize(
  style: SizeStyle, axis: SizeAxis, parent: SizeOrigin, stableSiblings: boolean,
): SizeOrigin {
  const size = style[axis]!
  const basis = style.flexBasis === 'auto' ? size : style.flexBasis
  const contentBasis = basis === 'auto' || basis === 'content'
  if (contentBasis) {
    if (style.flexGrow === 0 || parent.kind === 'content') return content('Flex 主轴依赖内容 basis')
    if (parent.kind === 'external' && style.flexGrow >= 1 && stableSiblings && !hasContentMinimum(style, axis)) {
      return external('唯一增长项目填充独立的剩余空间')
    }
    return unknownSize('Flex 内容 basis 与伸缩分配共同决定尺寸')
  }
  const independentBasis = pixels(basis) !== undefined || (isPercentage(basis) && parent.kind === 'external')
  if (!independentBasis) return unknownSize('Flex basis 参照尚未确定')
  // 固定 basis 仍可能被内容型的自动 minimum 撑大；内容移走后该下限会消失。
  if (hasContentMinimum(style, axis)) {
    if (style.flexBasis === 'auto' && pixels(size) !== undefined && style.flexGrow === 0 && style.flexShrink === 0) {
      return external('明确尺寸且不参与伸缩')
    }
    return unknownSize('Flex 主轴的自动最小尺寸依赖内容')
  }
  if (parent.kind === 'external' || (style.flexGrow === 0 && style.flexShrink === 0)) {
    return external('独立 basis 和最小尺寸')
  }
  return unknownSize('Flex 主轴分配缺少独立参照')
}

export function classifyFlexCrossSize(
  style: SizeStyle, parentStyle: SizeStyle, axis: SizeAxis, parent: SizeOrigin,
): SizeOrigin {
  const size = style[axis]!
  if (pixels(size) !== undefined) return external('交叉轴有明确尺寸')
  if (isPercentage(size)) {
    return parent.kind === 'external' && pixels(parentStyle[axis] || '') !== undefined
      ? external('交叉轴百分比有明确参照') : unknownSize('Flex 交叉轴百分比参照尚未确定')
  }
  if (size !== 'auto') return unknownSize('交叉轴尺寸表达式尚未支持')
  // 交叉轴 auto margin 优先于 align-self，不能误认为仍在 stretch。
  if (axis === 'width' ? style.autoMarginWidth : style.autoMarginHeight) return content('交叉轴自动外边距，尺寸依赖内容')
  const alignment = style.alignSelf === 'auto' ? parentStyle.alignItems : style.alignSelf
  if (alignment !== 'stretch' && alignment !== 'normal') return content('交叉轴未拉伸，依赖自身内容')
  if (parentStyle.flexWrap !== 'nowrap') return unknownSize('多行 Flex 的 stretch 行尺寸尚未支持')
  return parent // stretch 跟随行尺寸；单行外层本身也可能由当前内容撑开。
}

export function decideAxisProtection(origin: SizeOrigin, size: number, minimum: number | undefined): SizeDecision {
  if (origin.kind === 'external' || (minimum !== undefined && minimum >= size - 1)) return { kind: 'keep' }
  if (origin.kind === 'unknown') return { kind: 'unknown', reason: origin.reason }
  if (minimum === undefined) return { kind: 'unknown', reason: '已有最小尺寸不可直接比较' }
  if (!Number.isFinite(size)) return { kind: 'unknown', reason: '无法读取有效布局尺寸' }
  return { kind: 'protect', value: `${size}px` }
}
