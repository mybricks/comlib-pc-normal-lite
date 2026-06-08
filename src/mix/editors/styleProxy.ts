import context from '../context';
import { parseLess, stringifyLess } from '../utils/transform/less';
import { debounce } from '../../utils/debounce'
import { undoRedoManager } from './undoRedo'
import { convertCamelToHyphen } from '../../utils/string'

export const STATIC_SRC_RE = /\bsrc=(["'])([^"']*)\1|\bsrc=\{["'`]([^"'`]*)["'`]\}/;

// ── CSS shorthand 映射 ────────────────────────────────────────────────────────

const CSS_SHORTHAND_GROUPS: Record<string, string[]> = {
  'margin': ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  'padding': ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  'background': ['background-color', 'background-image', 'background-repeat', 'background-position', 'background-size', 'background-attachment', 'background-origin', 'background-clip'],
};

const LONGHAND_TO_SHORTHAND: Record<string, string> = {};
Object.entries(CSS_SHORTHAND_GROUPS).forEach(([shorthand, longhands]) => {
  longhands.forEach(longhand => { LONGHAND_TO_SHORTHAND[longhand] = shorthand; });
});

function camelToKebab(str: string) {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}


function getBaseSelector(selector: string) {
  return selector.replace(/:{1,2}[a-zA-Z-]+(\([^)]*\))?$/, '').trim();
}

// 找出 cssObj 中与 targetSelector 同元素的孤儿 key（含伪类变体），用于清空后联动删除。
function findOrphanKeys(cssObj: Record<string, any>, targetSelector: string): string[] {
  const targetBase = getBaseSelector(targetSelector);
  const segments = targetBase.trim().split(/\s+/).filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  const middleSegments = segments.slice(1, -1);
  const rootSegment = segments[0];

  return Object.keys(cssObj).filter(key => {
    if (key === targetSelector) return false;
    const base = getBaseSelector(key);

    // 同一路径（含伪类）可一起删除，例如 ".a .b" 与 ".a .b:hover"
    if (base === targetBase) return true;

    // 保护独立根规则，避免把 ".a .b" 的后缀 ".b" / ".b::placeholder" 误删
    if (
      segments.length > 1 &&
      !base.includes(' ') &&
      !!lastSegment &&
      (base === lastSegment || base.endsWith(lastSegment))
    ) {
      return false;
    }

    // 只清理明显由中间节点拆分出来的扁平孤儿类（例如 ".parent .mid .leaf" 里的 ".mid"）
    if (segments.length >= 3 && !base.includes(' ') && middleSegments.includes(base)) {
      const parentRoots = new Set(
        Object.keys(cssObj)
          .map(item => getBaseSelector(item).trim().split(/\s+/).filter(Boolean))
          .filter(itemSegs => itemSegs.length > 1 && itemSegs.includes(base))
          .map(itemSegs => itemSegs[0])
      );
      if (parentRoots.size === 0 || (parentRoots.size === 1 && parentRoots.has(rootSegment))) {
        return true;
      }
    }

    return false;
  });
}

// 吸收孤儿类，将孤儿类合并到目标选择器中
function absorbOrphans(cssObj: Record<string, any>, targetKey: string): void {
  const segments = targetKey.trim().split(/\s+/).filter(Boolean);
  if (segments.length < 3) return;
  for (let i = 1; i < segments.length - 1; i++) {
    const candidate = segments[i];
    if (!candidate.startsWith('.') || !cssObj[candidate]) continue;
    const parentRoots = new Set(
      Object.keys(cssObj)
        .filter(key => { const segs = key.trim().split(/\s+/); return segs.length > 1 && segs.includes(candidate); })
        .map(key => key.trim().split(/\s+/)[0])
    );
    if (parentRoots.size > 1) continue;
    const nestedPath = segments.slice(0, i + 1).join(' ');
    cssObj[nestedPath] = { ...cssObj[candidate], ...(cssObj[nestedPath] ?? {}) };
    delete cssObj[candidate];
  }
}

function expandDeletions(deletions: string[]): string[] {
  const toDelete = new Set(deletions);
  deletions.forEach(key => {
    const kebabKey = camelToKebab(key);
    const shorthand = LONGHAND_TO_SHORTHAND[kebabKey] ?? LONGHAND_TO_SHORTHAND[key];
    if (shorthand) toDelete.add(shorthand);
    const longhands = CSS_SHORTHAND_GROUPS[kebabKey] ?? CSS_SHORTHAND_GROUPS[key];
    if (longhands) longhands.forEach(lh => toDelete.add(lh));
  });
  return Array.from(toDelete);
}

function findCompoundClassKey(cssObj: Record<string, any>, eleClassList: string[]): string | undefined {
  const validClasses = new Set(eleClassList.filter(c => c && c !== 'undefined'));
  let best: string | undefined;
  let bestCount = 0;
  for (const key of Object.keys(cssObj)) {
    if (key.includes(' ')) continue;
    const classes = (key.match(/\.([^.#[:]+)/g) ?? []).map(c => c.slice(1));
    if (classes.length < 2) continue;
    if (classes.every(c => validClasses.has(c)) && classes.length > bestCount) {
      best = key;
      bestCount = classes.length;
    }
  }
  return best;
}

// 根据选择器获取对应的css对象key
function resolveTargetKey(params: {
  cssObj: Record<string, any>;
  fullSelector: string;
  eleClassList?: string[];
}): string {
  const { cssObj, fullSelector, eleClassList = [] } = params;
  const segments = fullSelector.trim().split(/\s+/).filter(Boolean);

  // 后缀遍历匹配：取路径最长（最具体）的 key
  const suffixMatchKey = Object.keys(cssObj)
    .filter(k => k === fullSelector || k.endsWith(' ' + fullSelector))
    .sort((a, b) => b.length - a.length)[0];

  const shrinkMatchKey = segments.slice(1).reduce((found: string | undefined, _, i) => {
    if (found) return found;
    const candidate = segments.slice(i + 1).join(' ');
    return cssObj[candidate] !== undefined ? candidate : undefined;
  }, undefined as string | undefined);

  const compoundMatchKey = eleClassList.length > 0 ? findCompoundClassKey(cssObj, eleClassList) : undefined;

  // 逗号分隔选择器兼容
  const commaMatchKey = Object.keys(cssObj).find(k => {
    if (!k.includes(',')) return false;
    return k.split(',').map(s => s.trim()).some(s => s === fullSelector || s.endsWith(' ' + fullSelector));
  });

  return suffixMatchKey ?? shrinkMatchKey ?? compoundMatchKey ?? commaMatchKey ?? fullSelector;
}

function extractDataZoneSelector(selector: string): string {
  const match = selector.match(/\[data-zone-selector=\[["']([^"']+)["']\]\]/);
  return match?.[1] ?? selector;
}

// ── 工厂函数 ──────────────────────────────────────────────────────────────────

export function genStyleValue(params: { comId: string }) {
  const { comId } = params;

  const debouncedUpdateFile = debounce(
    (params: {
      path: string,
      current: string,
      previous: string,
      callback: () => void
    }) => {
      const { 
        path,
        current,
        previous,
        callback
      } = params

      undoRedoManager.execute({
        execute() {
          context.updateFile({ fileName: path, content: current, type: undefined });
          context.saveManualVersion([path]);
        },
        undo() {
          context.updateFile({ fileName: path, content: previous, type: undefined });
          context.saveManualVersion([path]);
        },
      })

      callback()
      // context.saveManualVersion(comId, [path]);
    },
    500
  );

  let previousLess: string | null = null

  return {
    set(params: any, value: any) {
      const loc = params.focusArea?.dataset.loc;
      const cn = JSON.parse(loc);
      const lessPath = cn.files?.less ?? 'style.less';

      const deletions: string[] | null = (window as any).__mybricks_style_deletions;
      const aiComParams = context.component?.params;
      const lessFile = lessPath
        ? aiComParams.data.files?.find((f: { fileName: string; source: string }) => f.fileName === lessPath)
        : undefined;
      const rawLess = lessFile?.source ?? aiComParams.data.styleSource ?? '';
      if (!previousLess) {
        previousLess = rawLess ? decodeURIComponent(rawLess) : ''
      }
      const cssObj = rawLess ? parseLess(decodeURIComponent(rawLess)) : {};

      const fullSelector = params.selector;

      const ele: Element | null = params.focusArea?.ele ?? null;
      const eleClassList = ele ? Array.from(ele.classList) as string[] : [];
      const targetKey = resolveTargetKey({ cssObj, fullSelector, eleClassList });

      absorbOrphans(cssObj, targetKey);

      if (!cssObj[targetKey]) {
        cssObj[targetKey] = {};
      }

      Object.entries(value).forEach(([key, val]) => {
        cssObj[targetKey][key] = val;
      });

      if (deletions && deletions.length > 0) {
        const expandedDeletions = expandDeletions(deletions);
        expandedDeletions.forEach(key => delete cssObj[targetKey][key]);
      }

      if (Object.keys(cssObj[targetKey] || {}).length === 0) {
        const orphanKeys = findOrphanKeys(cssObj, targetKey);
        orphanKeys.forEach(key => delete cssObj[key]);
        delete cssObj[targetKey];
      }

      const cssStr = stringifyLess(cssObj);
      context.updateFile({ fileName: lessPath, content: cssStr, type: undefined });
      debouncedUpdateFile({
        path: lessPath,
        current: cssStr,
        previous: previousLess,
        callback: () => {
          previousLess = null
        }
      });
    },
  };
}

export function genImgSrcReplacer() {
  return {
    get(params: any) {
      return params.focusArea?.ele?.getAttribute?.('src') ?? '';
    },
    set(params: any) {
      const loc = JSON.parse(params.focusArea?.dataset?.loc ?? '{}');
      const jsxPath = loc.files?.jsx;
      if (!jsxPath) return;

      const comId = params.id;
      const aiComParams = context.component?.params;
      const jsxFile = aiComParams?.data?.files?.find(
        (f: { fileName: string; source: string }) => f.fileName === jsxPath
      );
      if (!jsxFile) return;
      const source = decodeURIComponent(jsxFile.source);

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const uploadFn = params.env?.uploadFile;
        let newSrc: string;
        if (typeof uploadFn === 'function') {
          const res = await uploadFn([file]);
          newSrc = res?.url ?? '';
        } else {
          newSrc = await new Promise<string>(resolve => {
            const fr = new FileReader();
            fr.readAsDataURL(file);
            fr.onload = ev => resolve((ev.currentTarget as FileReader).result as string);
          });
        }

        const snippet = source.slice(loc.jsx.start, loc.jsx.end);

        if (STATIC_SRC_RE.test(snippet)) {
          const newSnippet = snippet.replace(STATIC_SRC_RE, `src="${newSrc}"`);
          const newSource = source.slice(0, loc.jsx.start) + newSnippet + source.slice(loc.jsx.end);

          undoRedoManager.execute({
            execute() {
              context.updateFile({ fileName: jsxPath, content: newSource, type: undefined });
              context.saveManualVersion([jsxPath]);
            },
            undo() {
              context.updateFile({ fileName: jsxPath, content: source, type: undefined });
              context.saveManualVersion([jsxPath]);
            },
          });
        } else {
          const plugins = context.plugins as any;
          plugins?.showAIDialog?.();
          plugins?.aiService?.request({
            message: '请将页面中当前这张图片的地址替换为用户上传的图片链接',
            attachments: [{ url: newSrc }],
          });
        }

        // context.updateFile(comId, { fileName: jsxPath, content: newSource, type: undefined });
        // context.saveManualVersion(comId, [jsxPath]);
      };
      input.click();
    }
  };
}

/** SVG 属性名 → JSX 属性名的特殊映射表 */
const SVG_ATTR_MAP: Record<string, string> = {
  class: 'className',
  'clip-path': 'clipPath',
  'clip-rule': 'clipRule',
  'color-interpolation': 'colorInterpolation',
  'color-interpolation-filters': 'colorInterpolationFilters',
  'color-rendering': 'colorRendering',
  'dominant-baseline': 'dominantBaseline',
  'fill-opacity': 'fillOpacity',
  'fill-rule': 'fillRule',
  'flood-color': 'floodColor',
  'flood-opacity': 'floodOpacity',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-size-adjust': 'fontSizeAdjust',
  'font-stretch': 'fontStretch',
  'font-style': 'fontStyle',
  'font-variant': 'fontVariant',
  'font-weight': 'fontWeight',
  'glyph-orientation-horizontal': 'glyphOrientationHorizontal',
  'glyph-orientation-vertical': 'glyphOrientationVertical',
  'image-rendering': 'imageRendering',
  'letter-spacing': 'letterSpacing',
  'lighting-color': 'lightingColor',
  'marker-end': 'markerEnd',
  'marker-mid': 'markerMid',
  'marker-start': 'markerStart',
  'overline-position': 'overlinePosition',
  'overline-thickness': 'overlineThickness',
  'paint-order': 'paintOrder',
  'pointer-events': 'pointerEvents',
  'shape-rendering': 'shapeRendering',
  'stop-color': 'stopColor',
  'stop-opacity': 'stopOpacity',
  'strikethrough-position': 'strikethroughPosition',
  'strikethrough-thickness': 'strikethroughThickness',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-miterlimit': 'strokeMiterlimit',
  'stroke-opacity': 'strokeOpacity',
  'stroke-width': 'strokeWidth',
  'text-anchor': 'textAnchor',
  'text-decoration': 'textDecoration',
  'text-rendering': 'textRendering',
  'underline-position': 'underlinePosition',
  'underline-thickness': 'underlineThickness',
  'unicode-bidi': 'unicodeBidi',
  'vector-effect': 'vectorEffect',
  'word-spacing': 'wordSpacing',
  'writing-mode': 'writingMode',
  // xlink 命名空间
  'xlink:href': 'href',
  'xlink:title': 'xlinkTitle',
  'xlink:show': 'xlinkShow',
  'xlink:actuate': 'xlinkActuate',
};

/**
 * 将原始 SVG 字符串转换为 JSX 兼容的字符串。
 * 使用 DOMParser 解析后再序列化，精确处理：
 * - xmlns:xxx 命名空间声明属性（删除）
 * - xlink:href → href
 * - 连字符属性 → 驼峰（如 fill-rule → fillRule）
 * - class → className
 */
function svgToJsx(rawSvg: string, sizeOverride?: { width?: string; height?: string }): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return rawSvg;

  function serializeNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? '';
    }
    if (node.nodeType === Node.COMMENT_NODE) {
      return `{/*${(node as Comment).data}*/}`;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as Element;
    const tagName = el.tagName.toLowerCase();
    const attrs: string[] = [];

    for (let i = 0; i < el.attributes.length; i++) {
      const { name, value } = el.attributes[i];
      // 删除 xmlns:xxx 命名空间声明（xmlns 本身保留）
      if (/^xmlns:[a-zA-Z]/.test(name)) continue;
      const jsxName = SVG_ATTR_MAP[name] ?? name;
      // React JSX 的 style 必须是对象，将 CSS 字符串转换为 JSX 对象字面量
      if (name === 'style') {
        const styleObj = value
          .split(';')
          .map(s => s.trim())
          .filter(Boolean)
          .map(decl => {
            const colonIdx = decl.indexOf(':');
            const prop = decl.slice(0, colonIdx).trim();
            const val = decl.slice(colonIdx + 1).trim();
            const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            return `${camelProp}: '${val.replace(/'/g, "\\'")}'`;
          })
          .join(', ');
        attrs.push(`style={{${styleObj}}}`);
        continue;
      }
      attrs.push(`${jsxName}="${value.replace(/"/g, '&quot;')}"`);
    }

    const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
    const children = Array.from(el.childNodes).map(serializeNode).join('');

    if (!children) {
      return `<${tagName}${attrStr} />`;
    }
    return `<${tagName}${attrStr}>${children}</${tagName}>`;
  }

  // 沿用原始图标的 width/height 属性，保持替换前后尺寸一致
  if (sizeOverride?.width != null) {
    svgEl.setAttribute('width', sizeOverride.width);
  }
  if (sizeOverride?.height != null) {
    svgEl.setAttribute('height', sizeOverride.height);
  }

  // 确保根 svg 始终带有 height:auto，保证在容器内自适应高度
  const existingStyle = svgEl.getAttribute('style') ?? '';
  const styleWithoutHeight = existingStyle.replace(/height\s*:[^;]*(;|$)/g, '').replace(/;+$/, '').trim();
  svgEl.setAttribute('style', styleWithoutHeight ? `${styleWithoutHeight};height:auto` : 'height:auto');

  return serializeNode(svgEl);
}

/**
 * 将 rawSvg 字符串写入 params 聚焦的 SVG 对应的 JSX 源码位置。
 * 供上传文件和从图标库选取两条路径复用。
 */
/**
 * 在 source 中定位目标 SVG 的实际范围。
 * data-loc 在第一次替换后可能因源码长度变化而失效，
 * 此时以 hintStart 为中心向前搜索最近的 <svg，再向后匹配对应的 </svg>。
 */
/**
 * 在 source 中定位目标 SVG 的实际 [start, end) 范围。
 *
 * 安全原则：end 永远只通过深度计数求得，绝不信任 hintEnd。
 * 只要找不到完整的 <svg>...</svg> 结构，返回 null（调用方放弃替换）。
 *
 * @param hintStart  data-loc 或上次记录的起始位置，作为搜索锚点
 * @param hintEnd    仅用于限制向后搜索的窗口，不作为 end 输出
 */
function findActualSvgRange(
  source: string,
  hintStart: number,
  hintEnd: number,
): { start: number; end: number } | null {
  // Step 1: 以 hintStart 为锚点，向前搜索最近的合法 <svg 开始标签。
  // 合法：<svg 后接空白、> 或 / (即不是 <svgFoo 之类的自定义标签)
  const isSvgTag = (pos: number) => /[\s>/]/.test(source[pos + 4] ?? '');

  let svgStart = -1;
  // 先尝试 hintStart 自身或紧邻（偏差 ≤ 10 字符）
  const nearIdx = source.indexOf('<svg', Math.max(0, hintStart - 2));
  if (nearIdx !== -1 && nearIdx <= hintStart + 10 && isSvgTag(nearIdx)) {
    svgStart = nearIdx;
  }
  // 找不到则向前扫描（最多回溯 500 字符）
  if (svgStart === -1) {
    for (let p = hintStart; p >= Math.max(0, hintStart - 500); p--) {
      if (source.startsWith('<svg', p) && isSvgTag(p)) { svgStart = p; break; }
    }
  }
  // 仍找不到，或锚点偏差过大（500 字符外），放弃——宁愿不替换
  if (svgStart === -1 || Math.abs(svgStart - hintStart) > 500) return null;

  // Step 2: 从 svgStart 开始深度计数，找到配对的 </svg>。
  // end 完全由此计算，不依赖 hintEnd。
  let depth = 0;
  let pos = svgStart;
  while (pos < source.length) {
    if (source.startsWith('<svg', pos) && isSvgTag(pos)) {
      depth++;
      pos += 4;
    } else if (source.startsWith('</svg>', pos)) {
      depth--;
      if (depth === 0) return { start: svgStart, end: pos + 6 };
      pos += 6;
    } else {
      pos++;
    }
  }
  // 未找到配对的 </svg>，放弃
  return null;
}

let _svgAppliedCallback: ((rawSvg: string) => void) | null = null;

/** SvgPreview 组件注册回调，替换成功后立即更新预览 */
export function registerSvgAppliedCallback(cb: ((rawSvg: string) => void) | null): void {
  _svgAppliedCallback = cb;
}

/**
 * 记录上一次替换后 SVG 在新源码中的精确位置。
 * syntheticParams.focusArea 在 render(editConfig) 调用后就固定不变，
 * 多次替换同一个 SVG 时 data-loc 提示会因源码长度变化而失效。
 * 通过 dataLocStart 区分「同一 SVG 的再次替换」和「切换到其他 SVG」。
 */
let _lastSvgState: {
  comId: string;
  jsxPath: string;
  dataLocStart: number; // 原始 data-loc.jsx.start，用于判断是否同一目标 SVG
  start: number;        // 上次替换后 SVG 在新源码中的实际起始位置
  end: number;          // 上次替换后 SVG 在新源码中的实际结束位置
} | null = null;

export function applyRawSvg(params: any, rawSvg: string): void {
  const loc = JSON.parse(params.focusArea?.dataset?.loc ?? '{}');
  const jsxPath = loc.files?.jsx;
  if (!jsxPath) return;

  const comId = params.id;
  const aiComParams = context.component?.params;
  const jsxFile = aiComParams?.data?.files?.find(
    (f: { fileName: string; source: string }) => f.fileName === jsxPath
  );
  if (!jsxFile) return;
  const source = decodeURIComponent(jsxFile.source);

  // 若本次目标与上次一致（同 comId + jsxPath + dataLocStart），
  // 且上次记录的位置处确实还是 <svg，则直接用精确记录的 range，
  // 避免 data-loc 因源码长度变化失效导致截断位置出错。
  let hintStart: number = loc.jsx?.start;
  let hintEnd: number = loc.jsx?.end;
  if (
    _lastSvgState &&
    _lastSvgState.comId === comId &&
    _lastSvgState.jsxPath === jsxPath &&
    _lastSvgState.dataLocStart === loc.jsx?.start &&
    source.slice(_lastSvgState.start, _lastSvgState.start + 4) === '<svg'
  ) {
    hintStart = _lastSvgState.start;
    hintEnd = _lastSvgState.end;
  }

  const range = findActualSvgRange(source, hintStart, hintEnd);
  if (!range) return;

  // 最终安全断言：被替换的 slice 必须是完整的 <svg>…</svg>，否则放弃
  const candidate = source.slice(range.start, range.end);
  if (!candidate.startsWith('<svg') || !candidate.trimEnd().endsWith('</svg>')) return;

  // 提取原始 svg 的 width/height 属性，替换时保持图标尺寸不变
  const sizeOverride: { width?: string; height?: string } = {};
  const widthMatch = candidate.match(/\bwidth="([^"]+)"/);
  const heightMatch = candidate.match(/\bheight="([^"]+)"/);
  if (widthMatch) sizeOverride.width = widthMatch[1];
  if (heightMatch) sizeOverride.height = heightMatch[1];

  const jsxSvg = svgToJsx(rawSvg, sizeOverride);
  const newSource = source.slice(0, range.start) + jsxSvg + source.slice(range.end);

  // 记录本次替换的精确范围，供下次替换复用
  _lastSvgState = {
    comId,
    jsxPath,
    dataLocStart: loc.jsx?.start,
    start: range.start,
    end: range.start + jsxSvg.length,
  };

  undoRedoManager.execute({
    execute() {
      context.updateFile({ fileName: jsxPath, content: newSource, type: undefined });
      context.saveManualVersion([jsxPath]);
    },
    undo() {
      context.updateFile({ fileName: jsxPath, content: source, type: undefined });
      context.saveManualVersion([jsxPath]);
    },
  })

  // context.updateFile(comId, { fileName: jsxPath, content: newSource, type: undefined });
  // context.saveManualVersion(comId, [jsxPath]);
  _svgAppliedCallback?.(rawSvg);
}

/**
 * 递归移除元素及其所有后代上的 data-* 属性。
 * DOM 扫描到的 SVG 带有平台注入的 data-loc / data-zone-* 等属性，
 * 它们的值是含双引号的 JSON 字符串，经 svgToJsx 序列化后会破坏 JSX 属性语法。
 */
function stripDataAttrs(el: Element): void {
  Array.from(el.attributes)
    .filter(a => a.name.startsWith('data-'))
    .forEach(a => el.removeAttribute(a.name));
  Array.from(el.children).forEach(child => stripDataAttrs(child));
}

/**
 * 扫描 MyBricks 画布 Shadow DOM，收集所有带 data-source-icon 属性的 SVG 图标。
 * 与 AISvgEditEditor 中的同名函数逻辑一致，在组件库侧独立实现以避免跨包依赖。
 */
export function scanIconsFromDOM(): Array<{ name: string; svg: string }> {
  const shadowRoot = document.querySelector('#_mybricks-geo-webview_')?.shadowRoot;
  const scope: Document | ShadowRoot = shadowRoot ?? document;
  return Array.from(scope.querySelectorAll<SVGElement>('svg[data-source-icon]'))
    .map(node => {
      const name = node.getAttribute('data-source-icon') ?? '';
      // 克隆后清除所有 data-* 属性，避免平台属性污染目标 JSX
      const clone = node.cloneNode(true) as SVGElement;
      stripDataAttrs(clone);
      return { name, svg: clone.outerHTML };
    })
    .filter(icon => icon.name && icon.svg);
}

export function genSvgReplacer() {
  return {
    set(params: any) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.svg,image/svg+xml';
      input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const rawSvg = await file.text();
        applyRawSvg(params, rawSvg);
      };
      input.click();
    },
  };
}

/**
 * 将第三方图标组件（如 <NormalHistogramLine />）替换为上传的内联 SVG。
 * 与 applyRawSvg 的区别：不要求源码该位置是 <svg，而是任意 JSX 元素（<ComponentName ... />）。
 */
export function applyIconWithSvg(params: any, rawSvg: string): void {
  const loc = JSON.parse(params.focusArea?.dataset?.loc ?? '{}');
  const jsxPath = loc.files?.jsx;
  if (!jsxPath) return;

  const aiComParams = context.component?.params;
  const jsxFile = aiComParams?.data?.files?.find(
    (f: { fileName: string; source: string }) => f.fileName === jsxPath
  );
  if (!jsxFile) return;
  const source = decodeURIComponent(jsxFile.source);

  const start: number = loc.jsx?.start;
  const end: number = loc.jsx?.end;
  if (start == null || end == null || start < 0 || end > source.length) return;

  const candidate = source.slice(start, end);
  // 安全断言：必须是 JSX 元素（以 < 开头）
  if (!candidate.startsWith('<')) return;

  const jsxSvg = svgToJsx(rawSvg, {});
  const newSource = source.slice(0, start) + jsxSvg + source.slice(end);

  undoRedoManager.execute({
    execute() {
      context.updateFile({ fileName: jsxPath, content: newSource, type: undefined });
      context.saveManualVersion([jsxPath]);
    },
    undo() {
      context.updateFile({ fileName: jsxPath, content: source, type: undefined });
      context.saveManualVersion([jsxPath]);
    },
  });

  _svgAppliedCallback?.(rawSvg);
}

/** 触发文件选择框，用户上传 SVG 后替换第三方图标组件 */
export function genIconReplacer() {
  return {
    set(params: any) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.svg,image/svg+xml';
      input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const rawSvg = await file.text();
        applyIconWithSvg(params, rawSvg);
      };
      input.click();
    },
  };
}

function styleToCss(style: Record<string, string | number>): string {
  return Object.entries(style)
    .map(([key, value]) => {
      // [TODO] 目前支持的都是需要px单位的样式
      return `${convertCamelToHyphen(key)}: ${value}px!important;;`
    })
    .concat(`transition: none!important;`) // 拖拽过程中 transition: all 体感上会有卡顿的感觉
    .join(' ')
}

const SETSTYLE_CSS_ID = "SETSTYLE_CSS_ID"

function getFocusAreaEle(params: any): HTMLElement | null {
  return (params.focusArea?.ele ?? params.focusArea ?? null) as HTMLElement | null
}

function patchSvgOpenTagSize(svgSource: string, size: { width?: number; height?: number }): string | null {
  const openTagMatch = svgSource.match(/^<svg\b[^>]*>/)
  if (!openTagMatch) return null

  let openTag = openTagMatch[0]

  const replaceAttr = (tag: string, attr: 'width' | 'height', value?: number) => {
    if (value == null) return tag
    const attrRe = new RegExp(`\\s${attr}=(?:"[^"]*"|'[^']*'|\\{[^}]*\\})`)
    const existing = tag.match(attrRe)?.[0]
    if (!existing) {
      return tag.replace(/^<svg\b/, `<svg ${attr}="${value}"`)
    }
    const normalized = existing.includes('{')
      ? ` ${attr}={${value}}`
      : existing.includes("'")
        ? ` ${attr}='${value}'`
        : ` ${attr}="${value}"`
    return tag.replace(attrRe, normalized)
  }

  openTag = replaceAttr(openTag, 'width', size.width)
  openTag = replaceAttr(openTag, 'height', size.height)

  return openTag + svgSource.slice(openTagMatch[0].length)
}

function patchSvgSizeInTsx(params: any, size: { width?: number; height?: number }): void {
  const focusAreaEle = getFocusAreaEle(params)
  const loc = JSON.parse(focusAreaEle?.dataset?.loc ?? '{}')
  const jsxPath = loc.files?.jsx
  if (!jsxPath) return

  const comId = params.id
  const aiComParams = context.component?.params
  const jsxFile = aiComParams?.data?.files?.find(
    (f: { fileName: string; source: string }) => f.fileName === jsxPath
  )
  if (!jsxFile) return

  const source = decodeURIComponent(jsxFile.source)
  let hintStart: number = loc.jsx?.start
  let hintEnd: number = loc.jsx?.end

  if (
    _lastSvgState &&
    _lastSvgState.comId === comId &&
    _lastSvgState.jsxPath === jsxPath &&
    _lastSvgState.dataLocStart === loc.jsx?.start &&
    source.slice(_lastSvgState.start, _lastSvgState.start + 4) === '<svg'
  ) {
    hintStart = _lastSvgState.start
    hintEnd = _lastSvgState.end
  }

  const range = findActualSvgRange(source, hintStart, hintEnd)
  if (!range) return

  const candidate = source.slice(range.start, range.end)
  if (!candidate.startsWith('<svg') || !candidate.trimEnd().endsWith('</svg>')) return

  const patchedSvg = patchSvgOpenTagSize(candidate, size)
  if (!patchedSvg || patchedSvg === candidate) return

  const newSource = source.slice(0, range.start) + patchedSvg + source.slice(range.end)
  _lastSvgState = {
    comId,
    jsxPath,
    dataLocStart: loc.jsx?.start,
    start: range.start,
    end: range.start + patchedSvg.length,
  }

  undoRedoManager.execute({
    execute() {
      context.updateFile({ fileName: jsxPath, content: newSource, type: undefined })
      context.saveManualVersion([jsxPath])
    },
    undo() {
      context.updateFile({ fileName: jsxPath, content: source, type: undefined })
      context.saveManualVersion([jsxPath])
    },
  })
}

/**
 * 将一组静态 style 键值直接替换到 JSX/TSX 源码中。
 * 利用 data-style-info 中记录的 valueStart/valueEnd 字符偏移，
 * 从后向前替换，避免偏移量因前面内容长度变化而失效。
 *
 * @returns 替换后的新源码字符串，若无法定位则返回 null
 */
function patchStyleInTsx(
  source: string,
  styleEntries: Array<{ key: string; val: number; valueStart: number; valueEnd: number }>,
): string | null {
  if (styleEntries.length === 0) return null

  // 按 valueStart 从大到小排序，从后向前替换，保证偏移量不受前面替换影响
  const sorted = [...styleEntries].sort((a, b) => b.valueStart - a.valueStart)

  let result = source
  for (const { val, valueStart, valueEnd } of sorted) {
    if (valueStart < 0 || valueEnd > result.length || valueStart >= valueEnd) return null
    const newVal = `${val}`
    result = result.slice(0, valueStart) + newVal + result.slice(valueEnd)
  }
  return result
}

/**
 * 将 style 写入目标元素对应的文件（TSX 或 LESS），并推入撤销栈。
 * 完成后移除临时预览 CSS。
 *
 * 判断逻辑：
 * 1. 没有 data-style-info 信息 → 全部改 less 文件
 * 2. 有 data-style-info，且对应修改的 key 为 static → 直接改 tsx style
 * 3. 其它情况（dynamic 或 static 但缺偏移信息）→ 改 less 文件
 *
 * 同时改多个属性时，可能出现既改 tsx 又改 less 的混合情况。
 *
 * @param ctx         编辑器上下文（含 ctx.id / ctx.css）
 * @param ele         目标 DOM 元素
 * @param style       要写入的样式键值对（值为数字，写入时追加 px）
 * @param ignoreFirst 若为 true，在解析出的选择器后追加 :not(:first-child)
 */
export function applyStyleToLessFile(
  ctx: any,
  ele: HTMLElement,
  style: Record<string, number>,
  ignoreFirst: boolean,
): void {
  const loc = ele.dataset.loc
  const cn = loc ? JSON.parse(loc) : {}

  // ── 解析 data-style-info，按 key 分流 ──────────────────────────────────────
  type StyleKeyInfo = { kind: 'static' | 'dynamic'; valueStart?: number; valueEnd?: number }
  const styleInfoRaw = ele.dataset.styleInfo
  const styleInfo: Record<string, StyleKeyInfo> | null = styleInfoRaw
    ? (() => { try { return JSON.parse(styleInfoRaw) } catch { return null } })()
    : null

  // 将 style 中每个 key 分流：tsxEntries → 改 tsx；lessStyle → 改 less
  const tsxEntries: Array<{ key: string; val: number; valueStart: number; valueEnd: number }> = []
  const lessStyle: Record<string, number> = {}

  Object.entries(style).forEach(([key, val]) => {
    const info = styleInfo?.[key]
    if (
      info &&
      info.kind === 'static' &&
      typeof info.valueStart === 'number' &&
      typeof info.valueEnd === 'number'
    ) {
      tsxEntries.push({ key, val, valueStart: info.valueStart, valueEnd: info.valueEnd })
    } else {
      lessStyle[key] = val
    }
  })

  // ── 准备 TSX 更新 ────────────────────────────────────────────────────────────
  const jsxPath = cn.files?.jsx
  const aiComParams = context.component?.params

  let previousTsx: string | null = null
  let newTsx: string | null = null

  if (tsxEntries.length > 0 && jsxPath) {
    const jsxFile = aiComParams?.data?.files?.find(
      (f: { fileName: string; source: string }) => f.fileName === jsxPath
    )
    if (jsxFile) {
      previousTsx = decodeURIComponent(jsxFile.source as string)
      newTsx = patchStyleInTsx(previousTsx, tsxEntries)
      // 若替换失败，回退到改 less
      if (!newTsx) {
        Object.entries(style).forEach(([key, val]) => { lessStyle[key] = val })
        tsxEntries.length = 0
      }
    } else {
      // 找不到文件，全部改 less
      Object.entries(style).forEach(([key, val]) => { lessStyle[key] = val })
      tsxEntries.length = 0
    }
  } else if (tsxEntries.length > 0) {
    // 有 static key 但找不到 jsxPath，回退到 less
    Object.entries(style).forEach(([key, val]) => { lessStyle[key] = val })
    tsxEntries.length = 0
  }

  // ── 准备 LESS 更新 ──────────────────────────────────────────────────────────
  const lessPath = cn.files?.less
  let previousLess: string | null = null
  let newLessStr: string | null = null

  if (Object.keys(lessStyle).length > 0 && lessPath) {
    const lessFile = aiComParams?.data?.files?.find(
      (f: { fileName: string; source: string }) => f.fileName === lessPath
    )
    previousLess = decodeURIComponent(lessFile.source as string)
    const cssObj = parseLess(previousLess)
    const zoneSelector = JSON.parse(ele.dataset.zoneSelector!)[0]
    const eleClassList = Array.from(ele.classList) as string[]
    const cssObjKey = resolveTargetKey({ cssObj, fullSelector: zoneSelector, eleClassList })

    if (!cssObjKey) {
      ctx.css.remove(SETSTYLE_CSS_ID)
      return
    }

    // 如果有 data-render-key，需要在选择器上追加属性选择器；如果有 ignoreFirst，再追加 :not(:first-child)
    const renderKey = ele.dataset.renderKey
    const renderKeySelector = renderKey ? `[data-render-key="${renderKey}"]` : ''
    const finalCssObjKey = `${cssObjKey}${renderKeySelector}${ignoreFirst ? ':not(:first-child)' : ''}`

    if (!cssObj[finalCssObjKey]) {
      cssObj[finalCssObjKey] = {}
    }

    Object.entries(lessStyle).forEach(([key, val]) => {
      // [TODO] 目前给到的style一定数字且需要px单位
      cssObj[finalCssObjKey][key] = `${val}px`
    })
    newLessStr = stringifyLess(cssObj)
  }

  // ── 若两侧都没有变更，直接返回 ─────────────────────────────────────────────
  if (!newTsx && !newLessStr) {
    ctx.css.remove(SETSTYLE_CSS_ID)
    return
  }

  const paths: string[] = []
  const executeFiles: any[] = []
  const undoFiles: any[] = []

  if (newTsx) {
    paths.push(jsxPath)
    executeFiles.push({ fileName: jsxPath, content: newTsx, type: undefined })
    undoFiles.push({ fileName: jsxPath, content: previousTsx, type: undefined })
  }
  if (newLessStr) {
    paths.push(lessPath)
    executeFiles.push({ fileName: lessPath, content: newLessStr, type: undefined })
    undoFiles.push({ fileName: lessPath, content: previousLess, type: undefined })
  }

  // ── 推入统一的撤销栈 ────────────────────────────────────────────────────────
  undoRedoManager.execute({
    execute() {
      executeFiles.forEach(context.updateFile.bind(context))
      context.saveManualVersion(paths)
    },
    undo() {
      undoFiles.forEach(context.updateFile.bind(context))
      context.saveManualVersion(paths)
    },
  })
  ctx.css.remove(SETSTYLE_CSS_ID)
}

/**
 * 构造一个处理 start / ing / finish 三态的样式拖拽处理器。
 *
 * @param getEle       从调用参数中提取目标 DOM 元素
 * @param getStyle     从调用参数中提取当前样式对象
 * @param getIgnoreFirst 从调用参数中提取 ignoreFirst 标志（默认 false）
 */
function createSetStyleHandler(
  getEle: (ctx: any, params: any) => HTMLElement,
  getStyle: (ctx: any, params: any) => Record<string, number>,
  getIgnoreFirst: (ctx: any, params: any) => boolean = () => false,
) {
  let className = ''
  // [引擎兼容处理] start、finish状态可能没有style，在ing阶段进行收集
  let style = {}

  return function handler(ctx: any, params: any) {
    const { state } = params

    const resolveTarget = (ele: HTMLElement, style: Record<string, number>) => {
      const hasGap = 'rowGap' in style || 'columnGap' in style || 'gap' in style
      const targetEle = hasGap ? (ele.parentElement as HTMLElement) : ele
      const ignoreFirst = hasGap ? false : getIgnoreFirst(ctx, params)
      return { targetEle, ignoreFirst }
    }

    try {
      if (state === 'start') {
        const ele = getEle(ctx, params)
        style = getStyle(ctx, params) || {}
        const { targetEle, ignoreFirst } = resolveTarget(ele, style)
        const renderKey = targetEle.dataset.renderKey
        const classSelector = `.${targetEle.className.split(' ').join('.')}`
        const renderKeySelector = renderKey ? `[data-render-key="${renderKey}"]` : ''
        className = `${classSelector}${renderKeySelector}${ignoreFirst ? ':not(:first-child)' : ''}`
      } else if (state === 'ing' || state === 'moving') {
        // [引擎兼容处理] state传参未统一
        style = getStyle(ctx, params)
        ctx.css.set(SETSTYLE_CSS_ID, `${className} {${styleToCss(style)}}`)
      } else if (state === 'finish') {
        const ele = getEle(ctx, params)
        style = getStyle(ctx, params) || style
        const { targetEle, ignoreFirst } = resolveTarget(ele, style)
        applyStyleToLessFile(ctx, targetEle, style, ignoreFirst)
      }
    } catch {}
  }
}

export function genResizer() {
  let style: Record<string, number> = {}

  const handler = createSetStyleHandler(
    (ctx) => ctx.focusArea.ele,
    () => style,
  )

  return {
    type: '_resizer',
    value: {
      get() {},
      set(params: any, value: any, status: any) {
        const { state } = status
        const ctx = params
        if (state === 'ing') {
          style = value
        }
        handler(ctx, { state })
      },
    },
  }
}

export function genSvgResizer() {
  let style: Record<string, number> = {}

  return {
    type: '_resizer',
    value: {
      get() {},
      set(params: any, value: any, status: any) {
        const { state } = status
        const svgEle = getFocusAreaEle(params) as SVGElement | null

        if ((state === 'ing' || state === 'finish') && value) {
          style = value
        }
        if (state === 'ing') {
          if (svgEle) {
            if (style.width != null) svgEle.setAttribute('width', `${style.width}`)
            if (style.height != null) svgEle.setAttribute('height', `${style.height}`)
          }
        } else if (state === 'finish') {
          patchSvgSizeInTsx(params, {
            width: style.width,
            height: style.height,
          })
        }
      },
    },
  }
}

export default function () {
  return {
    /** 画布上各种可视化调整 */
    '@setStyle': createSetStyleHandler(
      (_ctx, params) => params.ele,
      (_ctx, params) => params.style,
      (_ctx, params) => !!params.ignoreFirst,
    ),
  }
}