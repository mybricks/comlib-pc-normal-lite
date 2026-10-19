import type { inspectLayoutTarget } from './layoutStyleSources'

/** string/number 表示写入该值；null 表示删除 Less 声明，例如 { left: null } 删除 left。 */
export type LayoutStyleValue = string | number | null
/** 本次要修改的属性，例如 { position: 'absolute', left: '120px', '--layout-item': 'freedom' }。 */
export type LayoutStylePatch = Record<string, LayoutStyleValue>

interface LayoutSourceTarget {
  /** 当前选中的容器或其直接子元素；用于校验节点和定位 Less 规则，不会发给引擎。 */
  target: HTMLElement
  /** 读取节点时的 data-loc 原始字符串；写文件前比较它，检查源码位置是否已变化。 */
  sourceLocation: string
  /** 组件文件列表中的 Less 路径，例如 components/Card/index.less，不是磁盘绝对路径。 */
  fileName: string
}

/**
 * 转换前读取的一个节点：它当前如何布局、样式来自哪些规则、应写入哪个文件。
 * collectLayoutTargets 生成这些信息，进入/退出规则据此决定改什么，
 * resolveLayoutStyleWrites 再决定每个属性写到哪条 selector。
 */
export interface LayoutTargetInfo extends LayoutSourceTarget {
  /** get('left') 返回声明 left 的规则；winner 是其中优先级最高的一条，candidates 是全部候选。 */
  resolution: ReturnType<typeof inspectLayoutTarget>
  /** 转换前的浏览器计算值，例如 flex；用于决定父容器是否保留行内显示方式。 */
  display: string
  /** 转换前的浏览器计算值，例如 static/absolute；用于识别原本就绝对定位的装饰元素。 */
  position: string
}

/**
 * 对一个文件中的一条规则做一次修改。
 * 例如 fileName='components/Card/index.less'、selector='.root'、style={ left: '120px' }。
 * 同一个 DOM 的属性可能来自不同规则，因此一个节点可以生成多条 LayoutStyleWrite。
 */
export interface LayoutStyleWrite extends LayoutSourceTarget {
  /** 写入 Less 时使用的选择器，例如 .card；与查询 DOM 时使用的 selectorPart 区分。 */
  selector: string
  style: LayoutStylePatch
}

/**
 * 一次布局切换需要的全部 Less 修改，包含父容器以及需要转换的直接子元素。
 * prepareLayoutStyleChange 按文件合并 writes，styleProxy 再提交文件内容并登记撤销操作。
 * 这是组件库内部的数据；编辑器仍只通过 value.set 传父容器的样式和 selector。
 */
export interface LayoutWritePlan {
  /** 当前组件实例 id；提交前检查它，避免把旧选中对象的修改写到另一个组件。 */
  componentId: string
  container: HTMLElement
  /** 同一文件可有多条 selector；不同文件也可能各自都有一条 .root。 */
  writes: LayoutStyleWrite[]
}
