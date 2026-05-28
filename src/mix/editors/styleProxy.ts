import context from '../context';
import { parseLess, stringifyLess } from '../utils/transform/less';
import { debounce } from '../../utils/debounce'
import { undoRedoManager } from './undoRedo'
import { convertCamelToHyphen } from '../../utils/string'

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
          context.updateFile(comId, { fileName: path, content: current, type: undefined });
          context.saveManualVersion(comId, [path]);
        },
        undo() {
          context.updateFile(comId, { fileName: path, content: previous, type: undefined });
          context.saveManualVersion(comId, [path]);
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
      const aiComParams = context.getAiComParams(comId);
      const lessFile = lessPath
        ? aiComParams.data.files?.find((f: { fileName: string; source: string }) => f.fileName === lessPath)
        : undefined;
      const rawLess = lessFile?.source ?? aiComParams.data.styleSource ?? '';
      if (!previousLess) {
        previousLess = rawLess ? decodeURIComponent(rawLess) : ''
      }
      const cssObj = rawLess ? parseLess(decodeURIComponent(rawLess)) : {};

      const fullSelector = params.selector;

      // console.log("editConfig.value.set 组件侧接收params.selector",fullSelector)

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
      context.updateFile(comId, { fileName: lessPath, content: cssStr, type: undefined });
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
      const aiComParams = context.getAiComParams(comId);
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
        const newSnippet = snippet.replace(
          /\bsrc=(["'])([^"']*)\1|\bsrc=\{["'`]([^"'`]*)["'`]\}/,
          `src="${newSrc}"`
        );
        const newSource = source.slice(0, loc.jsx.start) + newSnippet + source.slice(loc.jsx.end);

        undoRedoManager.execute({
          execute() {
            context.updateFile(comId, { fileName: jsxPath, content: newSource, type: undefined });
            context.saveManualVersion(comId, [jsxPath]);
          },
          undo() {
            context.updateFile(comId, { fileName: jsxPath, content: source, type: undefined });
            context.saveManualVersion(comId, [jsxPath]);
          },
        })

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
function svgToJsx(rawSvg: string): string {
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
  const aiComParams = context.getAiComParams(comId);
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

  const jsxSvg = svgToJsx(rawSvg);
  const newSource = source.slice(0, range.start) + jsxSvg + source.slice(range.end);

  // 记录本次替换的精确范围，供下次替换复用
  _lastSvgState = {
    comId,
    jsxPath,
    dataLocStart: loc.jsx?.start,
    start: range.start,
    end: range.start + jsxSvg.length,
  };

  context.updateFile(comId, { fileName: jsxPath, content: newSource, type: undefined });
  context.saveManualVersion(comId, [jsxPath]);
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

export function genResizer() {
  let className = ''
  let style = {}

  return {
    type: '_resizer',
    value: {
      get() {},
      set(params: any, value: any, status: any) {
        const { state } = status
        const ctx = params
        const ele = ctx.focusArea.ele
        if (state === 'start') {
          className = `.${ele.className.split(' ').join('.')}`
        } else if (state === 'ing') {
          style = value
          ctx.css.set(SETSTYLE_CSS_ID, `${className} {${styleToCss(style)}}`)
        } else if (state === 'finish') {
          const loc = ele.dataset.loc
          const cn = loc ? JSON.parse(loc) : {}
          const lessPath = cn.files?.less
          if (!lessPath) {
            return
          }
          const comId = ctx.id
          const aiComParams = context.getAiComParams(comId);
          const lessFile = aiComParams.data.files?.find((f: { fileName: string; source: string }) => f.fileName === lessPath)
          const previousLess = decodeURIComponent(lessFile.source)
          const cssObj = parseLess(previousLess)
          const zoneSelector = JSON.parse(ele.dataset.zoneSelector)[0]
          const eleClassList = Array.from(ele.classList) as string[] 
          const cssObjKey = resolveTargetKey({ cssObj, fullSelector: zoneSelector, eleClassList })

          if (!cssObjKey) {
            return
          }

          if (!cssObj[cssObjKey]) {
            cssObj[cssObjKey] = {};
          }

          Object.entries(style).forEach(([key, val]) => {
            // [TODO] 目前给到的style一定数字且需要px单位
            cssObj[cssObjKey][key] = `${val}px`;
          });
          const cssStr = stringifyLess(cssObj);

          undoRedoManager.execute({
            execute() {
              context.updateFile(comId, { fileName: lessPath, content: cssStr, type: undefined });
              context.saveManualVersion(comId, [lessPath]);
            },
            undo() {
              context.updateFile(comId, { fileName: lessPath, content: previousLess, type: undefined });
              context.saveManualVersion(comId, [lessPath]);
            },
          })
          ctx.css.remove(SETSTYLE_CSS_ID)
        }
      },
    },
  };
}

function styleToCss(style: Record<string, string | number>): string {
  return Object.entries(style)
    .map(([key, value]) => {
      // [TODO] 目前支持的都是需要px单位的样式
      return `${convertCamelToHyphen(key)}: ${value}px;`
    })
    .concat(`transition: none!important;`) // 拖拽过程中 transition: all 体感上会有卡顿的感觉
    .join(' ')
}

const SETSTYLE_CSS_ID = "SETSTYLE_CSS_ID"

export default function () {
  let className = ''
  return {
    /** 画布上各种可视化调整 */
    '@setStyle'(ctx, params) {
      const {
        ele,
        state,
        style,
        ignoreFirst
      } = params
      if (state === 'start') {
        className = `.${ele.className.split(' ').join('.')}${ignoreFirst ? ':not(:first-child)' : ''}`
      } else if (state === 'ing') {
        ctx.css.set(SETSTYLE_CSS_ID, `${className} {${styleToCss(style)}}`)
      } else if (state === 'finish') {
        const loc = ele.dataset.loc
        const cn = loc ? JSON.parse(loc) : {}
        const lessPath = cn.files?.less
        if (!lessPath) {
          return
        }
        const comId = ctx.id
        const aiComParams = context.getAiComParams(comId);
        const lessFile = aiComParams.data.files?.find((f: { fileName: string; source: string }) => f.fileName === lessPath)
        const previousLess = decodeURIComponent(lessFile.source)
        const cssObj = parseLess(previousLess)
        const zoneSelector = JSON.parse(ele.dataset.zoneSelector)[0]
        const eleClassList = Array.from(ele.classList) as string[] 
        const cssObjKey = resolveTargetKey({ cssObj, fullSelector: zoneSelector, eleClassList })

        if (!cssObjKey) {
          return
        }

        // 如果有 ignoreFirst，需要在选择器上追加 :not(:first-child)
        const finalCssObjKey = ignoreFirst ? `${cssObjKey}:not(:first-child)` : cssObjKey;

        if (!cssObj[finalCssObjKey]) {
          cssObj[finalCssObjKey] = {};
        }

        Object.entries(style).forEach(([key, val]) => {
          // [TODO] 目前给到的style一定数字且需要px单位
          cssObj[finalCssObjKey][key] = `${val}px`;
        });
        const cssStr = stringifyLess(cssObj);

        undoRedoManager.execute({
          execute() {
            context.updateFile(comId, { fileName: lessPath, content: cssStr, type: undefined });
            context.saveManualVersion(comId, [lessPath]);
          },
          undo() {
            context.updateFile(comId, { fileName: lessPath, content: previousLess, type: undefined });
            context.saveManualVersion(comId, [lessPath]);
          },
        })
        ctx.css.remove(SETSTYLE_CSS_ID)
      }
    },
  }
}