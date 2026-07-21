type FileEntry = { fileName: string; source?: string }

/** 将 fromFile 目录下的相对/裸 less 路径解析为 files 中的 fileName */
function resolveRelativeLessPath(fromFile: string, importPath: string): string {
  const fromDir = fromFile.includes('/') ? fromFile.split('/').slice(0, -1) : []
  const parts = [...fromDir]
  for (const seg of importPath.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/**
 * 从入口 tsx 源码提取 less import（含副作用导入）。
 * 多个 import 时取最后一个，与 babelPlugin lessMap 行为一致。
 */
function extractLessImportFromSource(fileName: string, source?: string): string | null {
  if (!source) return null
  let code = source
  try {
    code = decodeURIComponent(source)
  } catch {
    // source 可能已是明文
  }

  // import css from './index.less' / import './index.less' / import "style.less"
  const re =
    /(?:^|[\n;])\s*import\s+(?:[^'";\n]*?\s+from\s+)?['"]([^'"]+\.less)['"]/g
  let last: string | null = null
  let match: RegExpExecArray | null
  while ((match = re.exec(code)) !== null) {
    last = resolveRelativeLessPath(fileName, match[1])
  }
  return last
}

function pickByFileName(files: FileEntry[]): string | null {
  if (files.some((f) => f.fileName === 'index.less')) return 'index.less'
  if (files.some((f) => f.fileName === 'style.less')) return 'style.less'
  const anyLess = files.find((f) => /\.less$/i.test(f.fileName))
  return anyLess?.fileName ?? null
}

/**
 * 解析样式写入目标 less 文件路径。
 *
 * 优先级：
 * 1. Babel 打标的 `data-loc.files.less`（当前文件自身 import）
 * 2. 入口文件（entry）的 less import —— 覆盖子目录 tsx 未 import 的情况
 * 3. 按项目已有文件名：index.less > style.less > 任意 .less
 * 4. 默认 index.less
 */
export function resolveLessFilePath(
  declaredLess: string | undefined | null,
  files?: FileEntry[] | null,
  entryFileName?: string | null,
): string {
  if (declaredLess) return declaredLess

  if (files?.length) {
    const entryName = entryFileName || 'index.tsx'
    const entry =
      files.find((f) => f.fileName === entryName) ||
      files.find((f) => f.fileName === 'index.tsx')
    const fromEntry = entry
      ? extractLessImportFromSource(entry.fileName, entry.source)
      : null
    if (fromEntry) return fromEntry

    const byName = pickByFileName(files)
    if (byName) return byName
  }

  return 'index.less'
}
