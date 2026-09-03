import { calculate, compare } from 'specificity'
import { CSSProperties } from 'react'

import context from '../../../mix/context'
import { undoRedoManager } from '../../../mix/editors/undoRedo'
import { randomUUID } from '../../../mix/utils/uuid'
import { convertCamelToHyphen } from '../../../utils/string'
import { debounce } from '../../../helpers/debounce'

type StyleEntry = [string, any]

interface DomLoc {
  codeLine?: { start?: number; end?: number }
  files?: { jsx?: string; less?: string }
  cn?: string[]
}

type StyleTarget =
  | {
      kind: 'inline'
      target: HTMLElement
      property: string
      previousValue: string
      previousPriority: string
    }
  | {
      kind: 'rule'
      target: CSSStyleRule
      property: string
      previousValue: string
      previousPriority: string
    }

type RuleCandidate = {
  rule: CSSStyleRule
  specificity: ReturnType<typeof calculate>
  sheetIndex: number
  ruleOrder: number
}

// 暂存连续样式修改的单个属性，等防抖结束后再统一生成分支提交。
type PendingStyleEntry = {
  key: string
  value: any
  target: StyleTarget
}

// 同一个元素在一段时间内多次调样式时，用这个结构合并成一次提交。
type PendingStyleBranch = {
  ele: HTMLElement
  actionId: string
  chipId: string
  classNames: string
  codeLocation: string
  label: string
  entries: Map<string, PendingStyleEntry>
}

function getElementClassNames(ele) {
  const classNames: string[] = Array.from(ele.classList)
  return classNames.map((className) => {
    if (className.match('%2F')) {
      return decodeURIComponent(className)
    }

    return className
  }).join(' ')
}

// 把传入的样式值整理成可直接写入 CSS 的字符串。
function formatStyleValue(value: any) {
  if (value === null || value === undefined || value === '') return ''
  return typeof value === 'number' ? `${value}px` : String(value)
}

// 跨 iframe 不能依赖 instanceof，这里用 rule.type 判断是否为样式规则。
function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return typeof CSSRule !== 'undefined' && rule.type === CSSRule.STYLE_RULE
}

// 把 selector list 拆成单个 selector；会避开括号、方括号、字符串和转义字符里的逗号。
function splitSelectorList(selectorText: string): string[] {
  const parts: string[] = []
  let parenDepth = 0
  let bracketDepth = 0
  let quote: '"' | "'" | null = null
  let escaped = false
  let start = 0

  for (let index = 0; index < selectorText.length; index += 1) {
    const ch = selectorText[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (ch === quote) quote = null
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }

    if (ch === '(') parenDepth += 1
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1)
    else if (ch === '[') bracketDepth += 1
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    else if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
      parts.push(selectorText.slice(start, index).trim())
      start = index + 1
    }
  }

  parts.push(selectorText.slice(start).trim())
  return parts.filter(Boolean)
}

function safeParseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch (_) {
    return undefined
  }
}

function getClosestDomLoc<T extends DomLoc>(el: Element): T | undefined {
  let current: Element | null = el
  while (current) {
    const loc = safeParseJson<T>(current.getAttribute('data-loc'))
    if (loc) return loc
    current = current.parentElement
  }
  return undefined
}

function getElementCodeLocation(el?: Element): string {
  if (!el) return '未知'

  const loc = getClosestDomLoc<DomLoc>(el)
  if (!loc) return '未知'

  const jsxFile = loc.files?.jsx
  const startLine = loc.codeLine?.start
  const endLine = loc.codeLine?.end

  if (!jsxFile && !startLine) return '未知'

  const lineDesc =
    startLine && endLine && endLine !== startLine
      ? `L${startLine}-L${endLine}`
      : startLine
        ? `L${startLine}`
        : '未知行'

  return jsxFile ? `${jsxFile}#${lineDesc}` : lineDesc
}

function formatDisplayClassName(className: string): string {
  if (!className) return className

  if (!className.includes('%2F')) return className

  let decodedClassName = className
  try {
    decodedClassName = decodeURIComponent(className)
  } catch (_) {
    return className
  }

  const firstSeparator = decodedClassName.indexOf('--')
  const lastSeparator = decodedClassName.lastIndexOf('--')
  if (firstSeparator < 0 || lastSeparator <= firstSeparator) return decodedClassName

  return decodedClassName.slice(firstSeparator + 2, lastSeparator) || decodedClassName
}

// 优先找和当前元素 class 相关的样式表，减少无关样式表的遍历。
function getPreferredStyleSheets(ele: HTMLElement): CSSStyleSheet[] {
  const ownerDocument = ele.ownerDocument
  const classNames = Array.from(ele.classList).filter(Boolean)
  const styleSheets: CSSStyleSheet[] = []
  const seen = new Set<CSSStyleSheet>()

  classNames.forEach((className) => {
    if (!className.includes('--')) return
    const styleTagId = className.split('--')[0]
    if (!styleTagId) return
    const styleTag = ownerDocument.getElementById(styleTagId) as HTMLStyleElement | null
    const sheet = styleTag?.sheet
    if (!sheet || seen.has(sheet)) return
    seen.add(sheet)
    styleSheets.push(sheet)
  })

  return styleSheets
}

// 递归遍历样式表，收集所有真正匹配当前元素的规则。
function collectMatchingRulesFromSheet(sheet: CSSStyleSheet, ele: HTMLElement, sheetIndex: number): RuleCandidate[] {
  const candidates: RuleCandidate[] = []
  let ruleOrder = 0

  const visitRules = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (isStyleRule(rule)) {
        const selectorText = rule.selectorText
        try {
          if (!ele.matches(selectorText)) {
            ruleOrder += 1
            continue
          }
        } catch {
          ruleOrder += 1
          continue
        }

        const matchingBranches = splitSelectorList(selectorText).filter((branch) => {
          try {
            return ele.matches(branch)
          } catch {
            return false
          }
        })

        if (!matchingBranches.length) {
          ruleOrder += 1
          continue
        }

        const bestSpecificity = matchingBranches.reduce((best, branch) => {
          try {
            const value = calculate(branch)
            return !best || compare(value, best) > 0 ? value : best
          } catch {
            return best
          }
        }, null as ReturnType<typeof calculate> | null)

        if (bestSpecificity) {
          candidates.push({
            rule,
            specificity: bestSpecificity,
            sheetIndex,
            ruleOrder,
          })
        }

        ruleOrder += 1
        continue
      }

      const nestedRules = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules
      if (nestedRules) visitRules(nestedRules)
      ruleOrder += 1
    }
  }

  try {
    visitRules(sheet.cssRules)
  } catch {
    return []
  }

  return candidates
}

// 在所有命中的规则中，找出最终生效的那一条。
function findWinningStyleRule(ele: HTMLElement): CSSStyleRule | null {
  const preferredSheets = getPreferredStyleSheets(ele)

  const collectBestRule = (sheets: CSSStyleSheet[]) => {
    let bestCandidate: RuleCandidate | null = null

    sheets.forEach((sheet, sheetIndex) => {
      collectMatchingRulesFromSheet(sheet, ele, sheetIndex).forEach((candidate) => {
        if (!bestCandidate) {
          bestCandidate = candidate
          return
        }

        const specificityCmp = compare(candidate.specificity, bestCandidate.specificity)
        if (specificityCmp > 0) {
          bestCandidate = candidate
          return
        }
        if (specificityCmp < 0) return

        if (candidate.sheetIndex > bestCandidate.sheetIndex) {
          bestCandidate = candidate
          return
        }
        if (candidate.sheetIndex < bestCandidate.sheetIndex) return

        if (candidate.ruleOrder > bestCandidate.ruleOrder) {
          bestCandidate = candidate
        }
      })
    })

    return bestCandidate?.rule ?? null
  }

  return collectBestRule(preferredSheets)
}

// 决定这次修改应该写到行内样式，还是写回当前生效的 CSS 规则。
function resolveStyleTarget(ele: HTMLElement, property: string): StyleTarget {
  const previousInlineValue = ele.style.getPropertyValue(property)
  if (previousInlineValue !== '') {
    return {
      kind: 'inline',
      target: ele,
      property,
      previousValue: previousInlineValue,
      previousPriority: ele.style.getPropertyPriority(property),
    }
  }

  const winningRule = findWinningStyleRule(ele)
  if (winningRule) {
    return {
      kind: 'rule',
      target: winningRule,
      property,
      previousValue: winningRule.style.getPropertyValue(property),
      previousPriority: winningRule.style.getPropertyPriority(property),
    }
  }

  return {
    kind: 'inline',
    target: ele,
    property,
    previousValue: previousInlineValue,
    previousPriority: ele.style.getPropertyPriority(property),
  }
}

// 按目标位置写入样式，并保留原来的优先级标记。
function applyStyleTarget(target: StyleTarget, value: any) {
  const nextValue = formatStyleValue(value)
  if (target.kind === 'inline') {
    if (!nextValue) {
      target.target.style.removeProperty(target.property)
      return
    }
    target.target.style.setProperty(target.property, nextValue, target.previousPriority)
    return
  }

  if (!nextValue) {
    target.target.style.removeProperty(target.property)
    return
  }
  target.target.style.setProperty(target.property, nextValue, target.previousPriority)
}

// 撤销时，把样式恢复成修改前的状态。
function restoreStyleTarget(target: StyleTarget) {
  if (target.kind === 'inline') {
    if (target.previousValue !== '') {
      target.target.style.setProperty(target.property, target.previousValue, target.previousPriority)
    } else {
      target.target.style.removeProperty(target.property)
    }
    return
  }

  if (target.previousValue !== '') {
    target.target.style.setProperty(target.property, target.previousValue, target.previousPriority)
  } else {
    target.target.style.removeProperty(target.property)
  }
}

export default function() {
  let pendingStyleBranch: PendingStyleBranch | null = null

  // 这里只负责把缓存的样式改动真正写进 undoRedo 分支。
  // DOM 样式本身仍然在 set 阶段立即生效，保证页面反馈实时。
  const commitPendingStyleBranch = () => {
    const branch = pendingStyleBranch
    if (!branch || !branch.entries.size) return

    pendingStyleBranch = null

    const resolvedEntries = Array.from(branch.entries.values())
    const styleChangeLines = resolvedEntries.map(({ key, value }) => {
      const property = convertCamelToHyphen(key)
      const nextValue =
        value === null || value === undefined || value === ''
          ? '删除'
          : typeof value === 'number'
            ? `${value}px`
            : String(value)
      return `- ${property}：${nextValue}`
    })
    const previousTargets = resolvedEntries.map(({ target }) => target)
    const chip = {
      id: branch.chipId,
      label: branch.label,
      type: 'element-style-update',
      data: {
        inlineText: `执行「${branch.chipId}」，`,
        detailText: [
          `<element-style-update-operation id="${branch.chipId}">`,
          '## 操作意图',
          'dom 样式修改。请优先修改样式文件（Less/CSS）中的对应规则；只有在样式文件不存在、无法可靠定位，或该样式确实只能由运行时 prop 生效时，才修改 JSX 源码中对应的 prop。',
          '',
          '## 目标元素',
          `- 名称：${branch.ele.tagName.toLowerCase()}`,
          `- 类名：${branch.classNames || '无'}`,
          `- 代码位置：${branch.codeLocation}`,
          '',
          '## 需要修改的内容',
          ...styleChangeLines,
          '</element-style-update-operation>',
        ].join('\n'),
      }
    }

    undoRedoManager.executeBranch({
      aiRequest: {
        message: `[[chip:${chip.id}]]`,
        chips: [chip],
      },
      execute() {
        resolvedEntries.forEach(({ value, target }) => {
          applyStyleTarget(target, value)
        })
        context.component?.actions.addUserAction({
          id: branch.actionId,
          type: 'update-style',
          title: branch.label,
          refElement: branch.ele,
        })
      },
      undo() {
        previousTargets.forEach((target) => {
          restoreStyleTarget(target)
        })
        context.component?.actions.removeUserAction(branch.actionId)
      },
    })
  }

  const debouncedCommitPendingStyleBranch = debounce(commitPendingStyleBranch, 300)

  return {
    title: '样式',
    autoOptions: true,
    valueProxy: {
      set({ focusArea }, style: CSSProperties) {
        // 先拿到当前聚焦元素，没有目标就直接结束。
        const ele = focusArea?.ele as HTMLElement | undefined
        if (!ele) return

        // 过滤掉空值，只保留真正需要写入的样式项。
        const styleEntries = Object.entries(style ?? {}).filter(([, value]) => value !== undefined) as StyleEntry[]
        if (!styleEntries.length) return

        // 把属性名转成 CSS 形式，并判断每一项该写到哪里。
        const resolvedEntries = styleEntries
          .map(([key, value]) => {
            const property = convertCamelToHyphen(key)
            const target = resolveStyleTarget(ele, property)
            return {
              key,
              value,
              target,
            }
          })
          .filter(({ target }) => target.property)

        if (!resolvedEntries.length) return

        const classNames = getElementClassNames(ele)
        const rawClassNames = Array.from(ele.classList).filter(Boolean)
        const codeLocation = getElementCodeLocation(ele)
        const lastClassName = rawClassNames[rawClassNames.length - 1] ?? ''
        const labelTarget = lastClassName ? formatDisplayClassName(lastClassName) : ele.tagName.toLowerCase()
        const label = `调整 ${labelTarget} 样式`

        // 如果切换到了新的元素，先把上一个元素的缓存分支提交掉，避免串单。
        if (pendingStyleBranch && pendingStyleBranch.ele !== ele) {
          commitPendingStyleBranch()
        }

        // 同一个元素的多次调样式只创建一个待提交分支，后续内容直接覆盖缓存。
        if (!pendingStyleBranch) {
          pendingStyleBranch = {
            ele,
            actionId: randomUUID(),
            chipId: randomUUID(),
            classNames,
            codeLocation,
            label,
            entries: new Map(),
          }
        }

        resolvedEntries.forEach((entry) => {
          // 相同属性重复修改时，只更新最新值，保留首次记录的回退信息。
          const pendingEntry = pendingStyleBranch!.entries.get(entry.target.property)
          if (!pendingEntry) {
            pendingStyleBranch!.entries.set(entry.target.property, entry)
          } else {
            pendingEntry.key = entry.key
            pendingEntry.value = entry.value
          }

          applyStyleTarget(entry.target, entry.value)
        })

        debouncedCommitPendingStyleBranch()
      },
    },
  }
}
