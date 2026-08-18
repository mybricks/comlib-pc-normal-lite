import React from 'react'
import * as ReactDOM from 'react-dom'
import babelPlugin from '../../../utils/ai-code/plugins/babelPlugin'
import type { JSXElementDataAttributes } from '../../../utils/ai-code/plugins/babelPlugin'
import context, { config } from '../../context'
import { randomUUID } from '../../utils/uuid'
import { getShadowRoot } from '../../../helpers/designer'
import { undoRedoManager } from '../undoRedo'
import { getElementCodeLocation, getElementLabel, indentText, parseElementInfo } from './elementChip'
import {
  createDOMSourceLocationSnapshot,
  restoreDOMSourceLocationSnapshot,
  shiftDOMSourceLocationsAfterReplacement,
  type SourceReplacement,
} from './sourceLocation'

interface InsertOptions {
  /** Target element. */
  toEle: HTMLElement;
  /** Insert before or after the target element. */
  type: 'before' | 'after';
  /** Code to insert. */
  code: {
    /** Imports required by the JSX fragment. */
    import?: string;
    /** JSX fragment to insert. */
    jsx: string;
  }
}

type ImportDeclaration = {
  text: string
  source: string
  named: string[]
}

type SourcePatch = SourceReplacement

type InsertPreview = {
  container: HTMLDivElement
}

type PreviewSourceLocation = {
  fileName: string
  source: string
  jsxInsertion: string
  jsxStart: number
  contextElement: HTMLElement
  dataAttributes: JSXElementDataAttributes[]
}

type LegacyReactDOM = typeof ReactDOM & {
  render(element: React.ReactNode, container: Element): void
}

const IMPORT_DECLARATION_RE = /\bimport\s+(?:(?:[\s\S]*?)\s+from\s+)?['"]([^'"]+)['"][ \t]*;?/g

const countLineBreaks = (value: string) => value.match(/\r\n|\r|\n/g)?.length ?? 0

const getBabelOptions = (fileName = 'inserted-segment.tsx') => ({
  filename: fileName,
  presets: [
    ['env', { modules: 'commonjs' }],
    ['react', { runtime: 'classic' }],
  ],
  plugins: [['transform-typescript', { isTSX: true, allExtensions: true }]],
})

const getLineNumber = (source: string, position: number) => {
  return source.slice(0, position).split('\n').length
}

const getPreviewBabelOptions = (componentCode: string, jsxStart: number, location?: PreviewSourceLocation) => {
  if (!location) return getBabelOptions()

  return {
    ...getBabelOptions(location.fileName),
    plugins: [
      babelPlugin({
        fileName: location.fileName,
        sourceOffset: location.jsxStart - jsxStart,
        lineOffset: getLineNumber(location.source, location.jsxStart) - getLineNumber(componentCode, jsxStart),
      }),
      ['transform-typescript', { isTSX: true, allExtensions: true }],
    ],
  }
}

const parseImportDeclarations = (source: string): ImportDeclaration[] => {
  const declarations: ImportDeclaration[] = []

  for (const match of source.matchAll(IMPORT_DECLARATION_RE)) {
    const text = match[0]
    const namedMatch = text.match(/\{([\s\S]*?)\}/)
    const named = namedMatch
      ? namedMatch[1]
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      : []

    declarations.push({
      text,
      source: match[1],
      named,
    })
  }

  return declarations
}

const normalizeImportSpecifier = (specifier: string) => specifier.replace(/\s+/g, ' ').trim()

const getImportInsertPosition = (source: string) => {
  const declarations = [...source.matchAll(IMPORT_DECLARATION_RE)]
  if (!declarations.length) return 0
  const last = declarations[declarations.length - 1]
  return last.index + last[0].length
}

/**
 * Merge named imports from the inserted fragment into the target module.
 * Import syntax outside the supported static form is left to the AI fallback,
 * rather than risk producing an invalid or duplicate declaration.
 */
const mergeImports = (source: string, importCode?: string): { source: string; patches: SourcePatch[] } | null => {
  const normalizedImportCode = importCode?.trim()
  if (!normalizedImportCode) return { source, patches: [] }

  const incomingDeclarations = parseImportDeclarations(normalizedImportCode)
  const consumed = normalizedImportCode.replace(IMPORT_DECLARATION_RE, '').trim()
  if (!incomingDeclarations.length || consumed) return null

  let nextSource = source
  const patches: SourcePatch[] = []
  const pendingDeclarations: string[] = []

  incomingDeclarations.forEach((incoming) => {
    const existingDeclarations = parseImportDeclarations(nextSource)
    const exactExisting = existingDeclarations.some(
      (item) => normalizeImportSpecifier(item.text) === normalizeImportSpecifier(incoming.text),
    )
    if (exactExisting) return

    const mergeTarget = incoming.named.length
      ? existingDeclarations.find((item) => item.source === incoming.source && item.named.length)
      : undefined

    if (!mergeTarget) {
      pendingDeclarations.push(incoming.text.trim())
      return
    }

    const existingNames = new Set(mergeTarget.named.map(normalizeImportSpecifier))
    const namesToAdd = incoming.named.filter((name) => !existingNames.has(normalizeImportSpecifier(name)))
    if (!namesToAdd.length) return

    const nextNamed = [...mergeTarget.named, ...namesToAdd].join(', ')
    const replacement = mergeTarget.text.replace(/\{[\s\S]*?\}/, `{ ${nextNamed} }`)
    const start = nextSource.indexOf(mergeTarget.text)
    if (start < 0) {
      pendingDeclarations.push(incoming.text.trim())
      return
    }

    nextSource = nextSource.slice(0, start) + replacement + nextSource.slice(start + mergeTarget.text.length)
    patches.push({
      start,
      end: start + mergeTarget.text.length,
      newLength: replacement.length,
      lineDelta: countLineBreaks(replacement) - countLineBreaks(mergeTarget.text),
    })
  })

  if (pendingDeclarations.length) {
    const start = getImportInsertPosition(nextSource)
    const followedByNewline = nextSource[start] === '\n' || nextSource[start] === '\r'
    const insertion = `${start ? '\n' : ''}${pendingDeclarations.join('\n')}${followedByNewline ? '' : '\n'}`
    nextSource = nextSource.slice(0, start) + insertion + nextSource.slice(start)
    patches.push({
      start,
      end: start,
      newLength: insertion.length,
      lineDelta: countLineBreaks(insertion),
    })
  }

  return { source: nextSource, patches }
}

const getLineIndent = (source: string, position: number) => {
  const lineStart = source.lastIndexOf('\n', Math.max(0, position - 1)) + 1
  const linePrefix = source.slice(lineStart, position)
  return /^[ \t]*$/.test(linePrefix) ? linePrefix : ''
}

const formatJsxInsertion = (source: string, position: number, jsx: string, type: 'before' | 'after') => {
  const indent = getLineIndent(source, position)
  const formattedJsx = indentText(jsx.trim(), indent)
  return type === 'before'
    ? `${formattedJsx}\n${indent}`
    : `\n${indent}${formattedJsx}`
}

const applyCompiledDataAttributes = (container: HTMLDivElement, attributes: JSXElementDataAttributes[]) => {
  const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-loc]'))
  if (elements.length !== attributes.length) return

  elements.forEach((element, index) => {
    Object.entries(attributes[index].attributes).forEach(([name, value]) => {
      element.setAttribute(name, value)
    })
  })
}

/**
 * AI 回退预览尚未回写源码并经过项目编译，因此没有源码定位信息。
 * 仅标记其渲染出的根节点为可选中的 AI 节点：点击子元素时可命中根节点，
 * 同时避免将组件库的内部 DOM 暴露为独立编辑目标。
 */
const markAIOnlyPreviewRoots = (container: HTMLDivElement) => {
  Array.from(container.children).forEach((element) => {
    if (!element.hasAttribute('data-zone-selector') && !element.hasAttribute('data-zone-noselector')) {
      element.setAttribute('data-zone-noselector', 'true')
    }
  })
}

const createPreview = (code: InsertOptions['code'], location?: PreviewSourceLocation): InsertPreview | null => {
  if (!window.Babel || !code.jsx.trim()) return null

  try {
    const imports = code.import?.trim()
    const jsxInsertion = location?.jsxInsertion ?? code.jsx.trim()
    const componentHeader = `${imports ? `${imports}\n` : ''}export default function InsertedSegment() {\n  return <>`
    const componentCode = `${componentHeader}${jsxInsertion}</>\n}`
    const compiled = window.Babel.transform(
      componentCode,
      getPreviewBabelOptions(componentCode, componentHeader.length, location),
    ).code
    const exports: Record<string, any> = {}
    const dependencies = {
      ...config.getAllDependencies(),
      react: React,
      'react-dom': ReactDOM,
    }
    const require = (moduleName: string) => {
      const dependency = dependencies[moduleName]
      if (dependency == null) throw new Error(`无法加载插入片段依赖：${moduleName}`)
      return dependency
    }
    const execute = new Function('exports', 'require', 'React', `"use strict";\n${compiled}`)
    execute(exports, require, React)

    const Component = exports.default
    if (typeof Component !== 'function') return null

    // display: contents keeps this bookkeeping node out of the page layout.
    const container = document.createElement('div')
    container.style.display = 'contents'
    ReactDOM.flushSync(() => {
      ;(ReactDOM as LegacyReactDOM).render(React.createElement(Component), container)
    })
    if (location) {
      applyCompiledDataAttributes(container, location.dataAttributes)
    } else {
      markAIOnlyPreviewRoots(container)
    }
    return { container }
  } catch (_) {
    return null
  }
}

const mountPreview = (preview: InsertPreview, toEle: HTMLElement, type: 'before' | 'after') => {
  const parent = toEle.parentNode
  if (!parent) return false
  parent.insertBefore(preview.container, type === 'before' ? toEle : toEle.nextSibling)
  return true
}

const removePreview = (preview: InsertPreview | null) => {
  preview?.container.remove()
}

const validateSource = (source: string, fileName: string) => {
  if (!window.Babel) return false
  try {
    window.Babel.transform(source, getBabelOptions(fileName))
    return true
  } catch (_) {
    return false
  }
}

const getPositionAfterPatches = (position: number, patches: SourcePatch[]) => {
  let nextPosition = position

  for (const patch of patches) {
    if (patch.end <= nextPosition) {
      nextPosition += patch.newLength - (patch.end - patch.start)
    } else if (patch.start < nextPosition) {
      return null
    }
  }

  return nextPosition
}

const collectCompiledDataAttributes = (
  source: string,
  fileName: string,
  jsxStart: number,
  jsxEnd: number,
) => {
  if (!window.Babel) return [] as JSXElementDataAttributes[]

  const attributes: JSXElementDataAttributes[] = []

  try {
    window.Babel.transform(source, {
      ...getBabelOptions(fileName),
      plugins: [
        babelPlugin({
          fileName,
          onJSXElement(metadata) {
            if (metadata.start >= jsxStart && metadata.end <= jsxEnd) {
              attributes.push(metadata)
            }
          },
        }),
        ['transform-typescript', { isTSX: true, allExtensions: true }],
      ],
    })
  } catch (_) {
    return []
  }

  return attributes
}

/** `shiftDOMSourceLocationsAfterReplacement` retains a range beginning at an insertion point. */
const shiftTargetStartAtInsertionBoundary = (target: HTMLElement, patch: SourcePatch) => {
  if (patch.start !== patch.end) return
  const delta = patch.newLength
  if (!delta) return

  try {
    const loc = JSON.parse(target.dataset.loc || '')
    if (loc?.jsx?.start !== patch.start) return
    loc.jsx.start += delta
    if (patch.lineDelta && typeof loc.codeLine?.start === 'number') {
      loc.codeLine.start += patch.lineDelta
    }
    target.dataset.loc = JSON.stringify(loc)
  } catch (_) {
    // data-loc is runtime metadata; a malformed value should not break undo/redo.
  }
}

const buildInsertAIRequest = (options: InsertOptions, targetLabel: string) => {
  const target = parseElementInfo(options.toEle, targetLabel)
  const placement = options.type === 'before' ? '前面' : '后面'
  const imports = options.code.import?.trim() || '无'

  return [
    `请在【${targetLabel}】${placement}插入以下 JSX 片段。`,
    `目标源码位置：${getElementCodeLocation(options.toEle)}`,
    `目标 DOM 摘要：${target.domSummary}`,
    '要求：保留现有结构和缩进；将同一模块的命名 import 合并，已导入的标识符不得重复。',
    '需要导入：',
    indentText(imports, '  '),
    'JSX：',
    indentText(options.code.jsx.trim(), '  '),
  ].join('\n')
}

const runInsertByAI = (options: InsertOptions, preview: InsertPreview | null, title: string) => {
  const actionId = randomUUID()
  const targetLabel = getElementLabel(options.toEle, '节点')

  undoRedoManager.executeBranch({
    aiRequest: {
      message: buildInsertAIRequest(options, targetLabel),
      chips: [],
    },
    execute() {
      if (preview) mountPreview(preview, options.toEle, options.type)
      context.component!.actions.addUserAction({
        id: actionId,
        type: 'insert',
        title,
        refElement: preview?.container ?? options.toEle,
      })
    },
    undo() {
      removePreview(preview)
      context.component!.actions.removeUserAction(actionId)
    },
  })

  return { type: 'success', actionId }
}

const insert = (options: InsertOptions) => {
  const { toEle, type, code } = options
  if (!toEle || (type !== 'before' && type !== 'after') || !code?.jsx?.trim()) return

  const targetLabel = getElementLabel(toEle, '节点')
  const title = `在 ${targetLabel}${type === 'before' ? '前' : '后'}插入内容`

  try {
    const locValue = toEle.dataset.loc
    if (!locValue) return runInsertByAI(options, createPreview(code), title)

    const shadowRoot = getShadowRoot()
    const sameLocationElements = Array.from(shadowRoot.querySelectorAll<HTMLElement>('[data-loc]'))
      .filter((element) => element.dataset.loc === locValue)
    if (sameLocationElements.length !== 1) return runInsertByAI(options, createPreview(code), title)

    const loc = JSON.parse(locValue)
    const fileName = loc?.files?.jsx
    const start = loc?.jsx?.start
    const end = loc?.jsx?.end
    const file = context.component?.params?.data?.files?.find((item) => item.fileName === fileName)
    const source = file?.source ? decodeURIComponent(file.source) : ''
    if (
      !fileName ||
      !file ||
      loc?.swappable !== true ||
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      start < 0 ||
      end <= start ||
      end > source.length
    ) {
      return runInsertByAI(options, createPreview(code), title)
    }

    const insertPosition = type === 'before' ? start : end
    const jsxInsertion = formatJsxInsertion(source, insertPosition, code.jsx, type)
    const sourceWithJsx = source.slice(0, insertPosition) + jsxInsertion + source.slice(insertPosition)
    const imports = mergeImports(sourceWithJsx, code.import)
    if (!imports || !validateSource(imports.source, fileName)) {
      return runInsertByAI(options, createPreview(code), title)
    }

    const finalJsxStart = getPositionAfterPatches(insertPosition, imports.patches)
    if (finalJsxStart == null) return runInsertByAI(options, createPreview(code), title)
    const dataAttributes = collectCompiledDataAttributes(
      imports.source,
      fileName,
      finalJsxStart,
      finalJsxStart + jsxInsertion.length,
    )
    const preview = createPreview(code, {
      fileName,
      source: imports.source,
      jsxInsertion,
      jsxStart: finalJsxStart,
      contextElement: toEle,
      dataAttributes,
    })

    const sourcePatches: SourcePatch[] = [
      {
        start: insertPosition,
        end: insertPosition,
        newLength: jsxInsertion.length,
        lineDelta: countLineBreaks(jsxInsertion),
      },
      ...imports.patches,
    ]
    const sourceLocationSnapshot = createDOMSourceLocationSnapshot(shadowRoot, fileName)
    const actionId = randomUUID()

    undoRedoManager.executeBranch({
      execute() {
        context.updateFile({ fileName, content: imports.source, type: undefined, noUpdateFileSystem: true })
        sourcePatches.forEach((patch) => {
          shiftDOMSourceLocationsAfterReplacement(shadowRoot, fileName, patch)
          shiftTargetStartAtInsertionBoundary(toEle, patch)
        })
        if (preview) mountPreview(preview, toEle, type)
        context.component!.actions.addUserAction({
          id: actionId,
          type: 'insert',
          title,
          refElement: preview?.container ?? toEle,
        })
      },
      undo() {
        context.updateFile({ fileName, content: source, type: undefined, noUpdateFileSystem: true })
        removePreview(preview)
        restoreDOMSourceLocationSnapshot(sourceLocationSnapshot)
        context.component!.actions.removeUserAction(actionId)
      },
    })

    return { type: 'success', actionId }
  } catch (_) {
    return runInsertByAI(options, createPreview(code), title)
  }
}

export default insert
