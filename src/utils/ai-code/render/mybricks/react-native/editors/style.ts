import type { StylePropInfo } from '../plugins/stylePropInfoUtils'

// ─── Babel AST 工具（来自运行时 window.Babel，@babel/standalone） ────────────

function getBabelParser() {
  const Babel = (window as any).Babel
  if (!Babel) throw new Error('[style editor] window.Babel 未就绪')
  // @babel/standalone 将子包挂在 Babel.packages 上
  return Babel.packages?.parser ?? Babel
}

function getBabelTraverse() {
  const Babel = (window as any).Babel
  if (!Babel) throw new Error('[style editor] window.Babel 未就绪')
  const t = Babel.packages?.traverse
  // standalone 有时把 traverse 挂在 default 属性上
  return (typeof t === 'function' ? t : t?.default) as (ast: any, visitors: any) => void
}

/**
 * 解析 TypeScript/TSX 源码，返回带精确 start/end 位置信息的 Babel AST。
 */
function parseSource(source: string): any {
  const parser = getBabelParser()
  return parser.parse(source, {
    sourceType: 'module',
    strictMode: false,
    plugins: ['typescript', 'jsx'],
  })
}

// ─── 辅助：获取节点 key 名 ────────────────────────────────────────────────────

function getKeyName(keyNode: any): string | null {
  if (keyNode?.type === 'Identifier') return keyNode.name
  if (keyNode?.type === 'StringLiteral') return keyNode.value
  return null
}

// ─── 辅助：识别 StyleSheet.create(…) ─────────────────────────────────────────

function isStyleSheetCreate(node: any): boolean {
  return (
    node.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    node.callee.object?.type === 'Identifier' &&
    node.callee.object.name === 'StyleSheet' &&
    node.callee.property?.type === 'Identifier' &&
    node.callee.property.name === 'create'
  )
}

// ─── Patch 类型 ───────────────────────────────────────────────────────────────

type Patch =
  | { type: 'replace'; start: number; end: number; text: string }
  | { type: 'insert'; pos: number; text: string }

// ─── 定位：StyleSheet.create 场景 ─────────────────────────────────────────────

/**
 * 遍历 AST，找到 StyleSheet.create({ [styleName]: { [propKey]?: … } })，
 * 返回 update 或 insert patch。
 */
function collectStylesheetPatch(
  ast: any,
  source: string,
  styleName: string,
  propKey: string,
  newValStr: string
): Patch | null {
  const traverse = getBabelTraverse()
  let patch: Patch | null = null

  traverse(ast, {
    CallExpression(path: any) {
      if (patch) { path.stop(); return }
      if (!isStyleSheetCreate(path.node)) return

      const arg0 = path.node.arguments?.[0]
      if (!arg0 || arg0.type !== 'ObjectExpression') return

      for (const styleProp of arg0.properties) {
        if (styleProp.type !== 'ObjectProperty') continue
        if (getKeyName(styleProp.key) !== styleName) continue
        const styleObj = styleProp.value
        if (!styleObj || styleObj.type !== 'ObjectExpression') continue

        // 找目标属性
        const existing = (styleObj.properties || []).find(
          (p: any) => p.type === 'ObjectProperty' && getKeyName(p.key) === propKey
        )

        if (existing) {
          // update：替换整个属性 key: value
          patch = { type: 'replace', start: existing.start, end: existing.end, text: `${propKey}: ${newValStr}` }
        } else {
          // insert：在 styleObj 的末尾 } 前插入
          patch = buildInsertPatch(source, styleObj, propKey, newValStr)
        }

        path.stop()
        break
      }
    },
  })

  return patch
}

// ─── 定位：inline style 场景 ─────────────────────────────────────────────────

/**
 * 遍历 AST，找到包含行号为 targetLine 的非下划线属性的 ObjectExpression，
 * 返回 update 或 insert patch。
 */
function collectInlinePatch(
  ast: any,
  source: string,
  targetLine: number,
  propKey: string,
  newValStr: string
): Patch | null {
  const traverse = getBabelTraverse()
  let patch: Patch | null = null

  traverse(ast, {
    ObjectExpression(path: any) {
      if (patch) { path.stop(); return }

      const obj = path.node
      const props = obj.properties || []

      // 判断该对象是否包含目标行号的非下划线属性
      const hasTargetLine = props.some((p: any) => {
        if (p.type !== 'ObjectProperty') return false
        const k = getKeyName(p.key)
        if (!k || k.startsWith('_')) return false
        return p.loc?.start?.line === targetLine
      })

      if (!hasTargetLine) return

      // 找目标属性
      const existing = props.find(
        (p: any) => p.type === 'ObjectProperty' && getKeyName(p.key) === propKey
      )

      if (existing) {
        patch = { type: 'replace', start: existing.start, end: existing.end, text: `${propKey}: ${newValStr}` }
      } else {
        patch = buildInsertPatch(source, obj, propKey, newValStr)
      }

      path.stop()
    },
  })

  return patch
}

// ─── 辅助：构建 insert patch ──────────────────────────────────────────────────

/**
 * 在 ObjectExpression 闭合 `}` 前构建插入 patch。
 * 自动检测前一个属性是否缺逗号并补上，缩进与同块已有属性一致。
 */
function buildInsertPatch(
  source: string,
  objNode: any,
  propKey: string,
  newValStr: string
): Patch {
  // objNode.end 指向 `}` 后一位，所以 `}` 在 objNode.end - 1
  const closePos = objNode.end - 1

  // 取已有属性最后一个的缩进（或默认两空格）
  const realProps = (objNode.properties || []).filter((p: any) => {
    const k = getKeyName(p.key)
    return p.type === 'ObjectProperty' && k && !k.startsWith('_')
  })

  let indent = '  '
  if (realProps.length > 0) {
    const lastProp = realProps[realProps.length - 1]
    const lineStart = source.lastIndexOf('\n', lastProp.start) + 1
    const lineContent = source.slice(lineStart, lastProp.start)
    indent = lineContent.match(/^(\s+)/)?.[1] ?? '  '
  }

  // 检查 closePos 前是否需要补逗号（向前扫描跳过空白）
  let lastNonWs = closePos - 1
  while (lastNonWs >= 0 && /\s/.test(source[lastNonWs])) lastNonWs--
  const needsComma = lastNonWs >= 0 && source[lastNonWs] !== ','

  const prefix = needsComma ? ',' : ''
  const text = `${prefix}\n${indent}${propKey}: ${newValStr},`

  return { type: 'insert', pos: closePos, text }
}

// ─── 应用 patches ─────────────────────────────────────────────────────────────

/**
 * 将 patches 从后往前应用到 source 上，返回新字符串。
 * replace 和 insert 统一转成 {start, end, text}，按 start 降序排序。
 */
function applyPatches(source: string, patches: Patch[]): string {
  const normalized = patches.map((p) =>
    p.type === 'replace'
      ? { start: p.start, end: p.end, text: p.text }
      : { start: p.pos, end: p.pos, text: p.text }
  )

  // 从后往前替换，保证前面的 offset 不受影响
  normalized.sort((a, b) => b.start - a.start)

  let result = source
  for (const { start, end, text } of normalized) {
    result = result.slice(0, start) + text + result.slice(end)
  }
  return result
}

// ─── 主编辑器逻辑 ─────────────────────────────────────────────────────────────

export default function ({ context, undoRedoManager }) {
  return {
    '[dir="auto"]': {
      style: [
        {
          items: [
            {
              title: '样式',
              autoOptions: true,
              valueProxy: {
                set(params: any, value: any) {
                  const updateValues = Object.entries(value)
                  const focusEle = params.focusArea.ele
                  const wrapperDiv = focusEle.closest('[data-rn-style]')
                  console.log(1, params)
                  console.log(2, updateValues)
                  console.log(3, wrapperDiv)

                  const dataRnStyle = wrapperDiv?.dataset?.rnStyle
                  if (!dataRnStyle) {
                    // 没有 style 信息，<Text>hello</Text> 等无 style 的情况
                    return
                  }

                  const rnStyleRaw = JSON.parse(dataRnStyle)
                  const rnStyleList: any[] = Array.isArray(rnStyleRaw) ? rnStyleRaw : [rnStyleRaw]
                  const rnStyleFallback = rnStyleList[rnStyleList.length - 1]

                  console.log(4, rnStyleList)

                  // ── 收集每个文件需要执行的操作 ─────────────────────────
                  type StyleOp = {
                    propInfo: StylePropInfo
                    key: string
                    newValStr: string
                  }
                  const fileOps = new Map<string, { pre: string; cur: string; ops: StyleOp[] }>()

                  updateValues.forEach(([key, val]) => {
                    // 从后往前找：RN style 数组越靠后越优先
                    const ownerStyle =
                      [...rnStyleList].reverse().find((s) => s[`_${key}`] != null) ?? rnStyleFallback

                    const propInfo: StylePropInfo | undefined = ownerStyle?.[`_${key}`]
                    const filename: string | undefined = ownerStyle?._filename

                    if (!filename || !propInfo) return

                    if (!fileOps.has(filename)) {
                      const file = (context as any)?.component?.params?.data?.files?.find(
                        (f: any) => f.fileName === filename
                      )
                      if (!file) return
                      const decoded = decodeURIComponent(file.source)
                      fileOps.set(filename, { pre: decoded, cur: decoded, ops: [] })
                    }

                    // 格式化新值为 JS 字面量字符串
                    const newValStr =
                      typeof val === 'string'
                        ? `'${String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
                        : String(val)

                    fileOps.get(filename)!.ops.push({ propInfo, key, newValStr })
                  })

                  if (fileOps.size === 0) return

                  // ── 每个文件 parse 一次，收集 patches，从后往前替换 ─────
                  fileOps.forEach((entry) => {
                    // parse 当前源码，获取实时 AST 位置
                    let ast: any
                    try {
                      ast = parseSource(entry.cur)
                    } catch (e) {
                      console.error('[style editor] parse 失败', e)
                      return
                    }

                    const patches: Patch[] = []

                    entry.ops.forEach(({ propInfo, key, newValStr }) => {
                      let patch: Patch | null = null
                      if (propInfo.type === 'stylesheet') {
                        patch = collectStylesheetPatch(ast, entry.cur, propInfo.styleName, key, newValStr)
                      } else {
                        patch = collectInlinePatch(ast, entry.cur, propInfo.line, key, newValStr)
                      }
                      if (patch) patches.push(patch)
                    })

                    if (patches.length > 0) {
                      entry.cur = applyPatches(entry.cur, patches)
                    }
                  })

                  console.log('[fileOps]', fileOps)

                  // ── undo/redo ────────────────────────────────────────────
                  undoRedoManager.execute({
                    execute() {
                      fileOps.forEach(({ filename, cur }: any) => {
                        console.log('[filename]', filename)
                        console.log('[cur]', cur)
                        ;(context as any).updateFile({
                          fileName: filename,
                          content: cur,
                          type: undefined,
                        })
                      })
                      ;(context as any).saveManualVersion?.([...fileOps.keys()])
                    },
                    undo() {
                      fileOps.forEach(({ filename, pre }: any) => {
                        ;(context as any).updateFile({
                          fileName: filename,
                          content: pre,
                          type: undefined,
                        })
                      })
                      ;(context as any).saveManualVersion?.([...fileOps.keys()])
                    },
                  })
                },
              },
            },
          ],
        },
      ],
    },
  }
}
