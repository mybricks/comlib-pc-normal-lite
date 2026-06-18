import context from '../context';
import { parseLess, stringifyLess } from '../utils/transform/less';
import { debounce } from '../../utils/debounce'
import { undoRedoManager } from './undoRedo'
import { convertCamelToHyphen } from '../../utils/string'

export const STATIC_SRC_RE = /\bsrc=(["'])([^"']*)\1|\bsrc=\{["'`]([^"'`]*)["'`]\}/;

/**
 * 将 CSS 颜色值归一化为统一的 rgb(...) 形式，用于跨格式比较。
 * 支持：#rgb / #rrggbb → rgb(r,g,b)，rgba(r,g,b,1/1.0) → rgb(r,g,b)，统一空白。
 */
function normalizeCSSValue(v: string): string {
  const s = v.trim().toLowerCase();
  const h3 = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (h3) return `rgb(${parseInt(h3[1] + h3[1], 16)}, ${parseInt(h3[2] + h3[2], 16)}, ${parseInt(h3[3] + h3[3], 16)})`;
  const h6 = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
  if (h6) return `rgb(${parseInt(h6[1], 16)}, ${parseInt(h6[2], 16)}, ${parseInt(h6[3], 16)})`;
  // rgba(r,g,b,1) / rgba(r,g,b,1.0) 与 rgb(r,g,b) 视觉等价
  const rgba1 = s.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*1(?:\.0*)?\s*\)$/);
  if (rgba1) return `rgb(${rgba1[1]}, ${rgba1[2]}, ${rgba1[3]})`;
  return s.replace(/\s+/g, ' ');
}

// ── CSS shorthand 映射 ────────────────────────────────────────────────────────

const CSS_SHORTHAND_GROUPS: Record<string, string[]> = {
  'margin': ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  'padding': ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  'background': ['background-color', 'background-image', 'background-repeat', 'background-position', 'background-size', 'background-attachment', 'background-origin', 'background-clip'],
  'gap': ['row-gap', 'column-gap'],
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

/**
 * 第 5 条匹配策略：处理 CSS Modules 哈希类名场景。
 *
 * 触发条件（同时满足）：
 *   1. fullSelector 含 '--'（CSS Modules 哈希分隔符）
 *   2. 最后一段是复合类选择器（含多个 .class）
 *
 * 核心逻辑：
 *   - 从最后一段的各 class 中提取原始类名（取 lastIndexOf('--') 之后的部分）
 *   - 将有 '--' 的（哈希化的动态类）与没有 '--' 的（静态基类）区分开
 *   - 优先对"哈希化的动态类"做 shrink match（含祖先路径）和独立 match
 *   - 返回 cssObj 中第一个命中的 key
 */
function tryResolveCSSModulesHashedSelector(
  cssObj: Record<string, any>,
  fullSelector: string,
): string | undefined {
  if (!fullSelector.includes('--')) return undefined;

  const segments = fullSelector.trim().split(/\s+/).filter(Boolean);
  const lastSeg = segments[segments.length - 1];

  // 最后一段必须是复合类（含 >= 2 个 .class）
  const rawClasses = (lastSeg.match(/\.([^.#[:]+)/g) ?? []).map(c => c.slice(1));
  if (rawClasses.length < 2) return undefined;

  // 区分"哈希动态类"和"静态基类"
  // 有 '--' 的是 CSS Modules 哈希类（如 pages_...--cyan → 原始名 cyan）
  const dynamicClasses = rawClasses
    .filter(c => c.includes('--'))
    .map(c => c.slice(c.lastIndexOf('--') + 2));

  if (dynamicClasses.length === 0) return undefined;

  const ancestorSegs = segments.slice(0, -1); // 祖先路径段（已是原始类名）

  for (const origName of dynamicClasses) {
    const cls = '.' + origName;
    // 优先尝试含祖先路径的 key（从最长到最短）
    for (let i = 0; i < ancestorSegs.length; i++) {
      const cand = [...ancestorSegs.slice(i), cls].join(' ');
      if (cssObj[cand] !== undefined) return cand;
    }
    // 尝试独立 key（已存在于 cssObj 时直接返回）
    if (cssObj[cls] !== undefined) return cls;
    // cssObj 中尚无此 key（首次写入）：直接返回独立类名。
    // 这样首次写入也会落到 ".cyan" 而非哈希复合键，完全避免产生脏键。
    return cls;
  }

  return undefined;
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

  // 第 5 策略：CSS Modules 哈希复合类名反推（前 4 策略均失败时才触发）
  const cssModulesKey = tryResolveCSSModulesHashedSelector(cssObj, fullSelector);

  return suffixMatchKey ?? shrinkMatchKey ?? compoundMatchKey ?? commaMatchKey ?? cssModulesKey ?? fullSelector;
}

/**
 * 检测 fullSelector 是否命中 cssObj 中的嵌套伪类/伪元素规则（如 ".pageBtn" 下的 "&:disabled"），
 * 若命中则直接在原位写入样式，完全保留 Less 嵌套结构，并清理可能存在的历史孤儿复合规则。
 *
 * 背景：parseLess 会将 `&:disabled { ... }` 解析为父规则下的嵌套 key；
 * resolveTargetKey 只查顶层 key，导致 .pageBtn:disabled 匹配失败，退化成
 * 创建全路径孤立复合选择器（如 ".container ... .pageBtn:disabled"）。
 *
 * 返回 true 表示已处理，调用方应跳过后续的 resolveTargetKey 流程；
 * 返回 false 表示未命中，继续走正常流程。
 */
function tryWriteNestedPseudo(
  cssObj: Record<string, any>,
  fullSelector: string,
  value: Record<string, any>,
  deletions: string[] | null,
): boolean {
  const segments = fullSelector.trim().split(/\s+/).filter(Boolean);
  if (segments.length < 2) return false;

  // 按 shrinkMatchKey 相同顺序遍历候选后缀（从长到短），取最短匹配
  for (let i = 1; i < segments.length; i++) {
    const candidate = segments.slice(i).join(' ');

    // 只关注单段候选（无空格）
    if (candidate.includes(' ')) continue;

    // 必须是「单类名 + 伪类/伪元素」形式，支持 :disabled、::placeholder、:hover:not(:disabled) 等
    const pseudoMatch = candidate.match(/^(\.[^:]+)(:{1,2}.+)$/);
    if (!pseudoMatch) continue;

    const [, base, pseudo] = pseudoMatch;
    if (!cssObj[base] || typeof cssObj[base] !== 'object') continue;

    const nestedKey = '&' + pseudo;
    if (cssObj[base][nestedKey] === undefined) continue;

    // 找到嵌套伪类，直接在原位写入，保留 Less 嵌套结构
    const target = cssObj[base][nestedKey] as Record<string, any>;
    Object.entries(value).forEach(([k, v]) => { target[k] = v; });

    if (deletions && deletions.length > 0) {
      const expandedDeletions = expandDeletions(deletions);
      expandedDeletions.forEach(k => delete target[k]);
    }

    // 嵌套块变为空时删除该嵌套 key
    if (Object.keys(target).length === 0) {
      delete cssObj[base][nestedKey];
    }

    // 顺手清除因历史 bug 产生的孤儿复合规则
    if (cssObj[fullSelector]) {
      delete cssObj[fullSelector];
    }

    return true;
  }

  return false;
}

// ── 工厂函数 ──────────────────────────────────────────────────────────────────

export function genStyleValue(props) {

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

      // 嵌套伪类快速路径：直接写入 &:disabled 等嵌套位置，保留 Less 原有结构
      if (tryWriteNestedPseudo(cssObj, fullSelector, value, deletions)) {
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
        return;
      }

      const targetKey = resolveTargetKey({ cssObj, fullSelector, eleClassList });

      // 若 targetKey 是独立单类（如 ".cyan"），清除 cssObj 中可能残留的旧版复合选择器键。
      // 例：历史写入产生了 ".topFeatureItem.cyan" 或 ".topFeatureItem.pages_xxx--cyan"，
      // 它们的 CSS 优先级（0,2,0）高于 ".cyan"（0,1,0），会覆盖新写入的规则。
      if (/^\.[\w-]+$/.test(targetKey)) {
        const targetClass = targetKey.slice(1);
        Object.keys(cssObj).forEach(key => {
          if (key === targetKey) return;
          const keyLastSeg = (key.trim().split(/\s+/).pop() || '');
          const keyClasses = (keyLastSeg.match(/\.([^.#[:]+)/g) ?? []).map(c => c.slice(1));
          if (keyClasses.length < 2) return; // 非复合类选择器，不处理
          // 将哈希类名还原为原始类名（pages_xxx--cyan → cyan）
          const normalizedClasses = keyClasses.map(c => {
            const ddIdx = c.lastIndexOf('--');
            return ddIdx > 0 ? c.slice(ddIdx + 2) : c;
          });
          if (normalizedClasses.includes(targetClass)) {
            delete cssObj[key];
          }
        });
      }

      absorbOrphans(cssObj, targetKey);

      if (!cssObj[targetKey]) {
        cssObj[targetKey] = {};
      }

      const computedStyle = ele ? getComputedStyle(ele as HTMLElement) : null;

      Object.entries(value).forEach(([key, val]) => {
        const existing = cssObj[targetKey]?.[key];
        // 当前 Less 文件中该属性是 Less 变量引用（@xxx）时，判断是否真正被用户改动：
        // - 无法取到计算值 → 变量未解析 → 保留变量
        // - 计算值与写入值归一化后相同 → editConfig 里只是旧缓存，用户未真正改动 → 保留变量
        // - 不同 → 用户确实改了 → 允许覆盖
        if (typeof existing === 'string' && /^\s*@[\w-]/.test(existing)) {
          if (!computedStyle) return;
          const computedVal = computedStyle.getPropertyValue(convertCamelToHyphen(key)).trim();
          if (!computedVal) return;
          if (normalizeCSSValue(computedVal) === normalizeCSSValue(String(val ?? ''))) return;
        }
        cssObj[targetKey][key] = val;
      });

      // 若写入了 background-image: none（表示用户切换到纯色背景），
      // 自动清除 background 简写属性，避免简写残留导致渐变未被覆盖。
      // CSS 中 shorthand + longhand 同规则共存时行为不稳定，删除简写是最可靠的做法。
      if (
        cssObj[targetKey] &&
        'backgroundImage' in value &&
        (value as any)['backgroundImage'] === 'none' &&
        'background' in cssObj[targetKey]
      ) {
        delete cssObj[targetKey]['background'];
      }

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
            mentionFocus: true,
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
    // 使用 localName 而非 tagName.toLowerCase()，以保留 SVG camelCase 元素名
    // 例如 linearGradient、radialGradient、clipPath、feGaussianBlur 等
    const tagName = el.localName;
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
 * 从 hintStart 向后扫描，动态找到 JSX 自闭合标签（<Comp ... />）的实际结束位置。
 * 通过追踪花括号深度跳过 style={{ ... }} 等表达式，避免被其中的 /> 误判。
 * 同时支持 open+close 形式（<Comp>...</Comp>），但图标组件基本都是自闭合。
 */
function findActualIconTagRange(
  source: string,
  hintStart: number,
): { start: number; end: number } | null {
  // 找到实际的 < 起始位置（允许 hintStart 前后 ±5 字符的偏差）
  let start = hintStart;
  if (source[start] !== '<') {
    const near = source.lastIndexOf('<', hintStart);
    if (near === -1 || hintStart - near > 10) return null;
    start = near;
  }

  let pos = start + 1;
  let braceDepth = 0;

  while (pos < source.length) {
    const ch = source[pos];
    if (ch === '{') {
      braceDepth++;
    } else if (ch === '}') {
      braceDepth--;
    } else if (braceDepth === 0) {
      if (ch === '/' && source[pos + 1] === '>') {
        // 自闭合标签结束
        return { start, end: pos + 2 };
      }
      if (ch === '>' && source[pos - 1] !== '/') {
        // open tag，找对应的 </TagName>
        const tagMatch = source.slice(start).match(/^<([A-Za-z][A-Za-z0-9.]*)/);
        if (!tagMatch) return null;
        const closeTag = `</${tagMatch[1]}>`;
        const closeIdx = source.indexOf(closeTag, pos + 1);
        if (closeIdx !== -1) return { start, end: closeIdx + closeTag.length };
        return null;
      }
    }
    pos++;
  }
  return null;
}

/**
 * 将第三方图标组件（如 <NormalHistogramLine />）替换为上传的内联 SVG。
 * 与 applyRawSvg 的区别：不要求源码该位置是 <svg，而是任意 JSX 元素（<ComponentName ... />）。
 * 使用 findActualIconTagRange 动态确定标签范围，避免 patchIconSizeInTsx 改过源码后
 * data-loc.jsx.end 失效导致截断不完整的问题。
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

  const hintStart: number = loc.jsx?.start;
  if (hintStart == null || hintStart < 0) return;

  // 动态扫描标签实际范围，不依赖可能已过期的 loc.jsx.end
  const range = findActualIconTagRange(source, hintStart);
  if (!range) return;

  const { start, end } = range;
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

  // 若显式设置了 height，需清除 style 中的 height: auto（内联 style 优先级高于属性，会覆盖 height 值）
  if (size.height != null) {
    openTag = openTag.replace(
      /(\bstyle=\{\{)([^}]*)(\}\})/,
      (_, prefix, inner, suffix) => {
        const cleaned = inner
          .replace(/,?\s*\bheight\s*:\s*['"]?auto['"]?\s*/g, '')
          .replace(/^\s*,\s*/, '')
          .replace(/,\s*$/, '')
          .trim();
        return cleaned ? `${prefix} ${cleaned} ${suffix}` : '';
      },
    );
  }

  // 宽高不等时需要 preserveAspectRatio="none" 才能真正拉伸变形，
  // 否则浏览器会按 viewBox 的比例等比缩放（默认 xMidYMid meet）。
  // 宽高相等时恢复默认（移除该属性）。
  if (size.width != null && size.height != null) {
    const parAttrRe = /\s+preserveAspectRatio=(?:"[^"]*"|'[^']*'|\{[^}]*\})/;
    const isSquare = size.width === size.height;
    if (isSquare) {
      // 相等时移除 preserveAspectRatio，交由浏览器默认等比处理
      openTag = openTag.replace(parAttrRe, '');
    } else {
      // 不等时强制设为 none，允许独立拉伸
      if (parAttrRe.test(openTag)) {
        openTag = openTag.replace(parAttrRe, ' preserveAspectRatio="none"');
      } else {
        openTag = openTag.replace(/^<svg\b/, '<svg preserveAspectRatio="none"');
      }
    }
  }

  return openTag + svgSource.slice(openTagMatch[0].length)
}

export function patchSvgSizeInTsx(params: any, size: { width?: number; height?: number }): void {
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

/** 清除 style object inner 字符串两端多余的逗号和空白 */
function cleanStyleInner(inner: string): string {
  return inner.replace(/^\s*,\s*/, '').replace(/,\s*$/, '').trim();
}

/** 在已有 style object inner 中追加一个属性（如果未存在）或替换（如果已存在） */
function setStyleProp(inner: string, key: string, value: string | number): string {
  const keyRe = new RegExp(`\\b${key}\\s*:\\s*[^,}]+`);
  if (keyRe.test(inner)) {
    return inner.replace(keyRe, `${key}: ${value}`);
  }
  const cleaned = cleanStyleInner(inner);
  return cleaned ? `${cleaned}, ${key}: ${value}` : `${key}: ${value}`;
}

/**
 * 将 style prop 中的尺寸 patch 到三方图标组件的 JSX 片段中。
 * 适用于 <PlusOutlined />、<NormalHistogramLine /> 等场景。
 * 三方图标组件统一使用 fontSize 控制大小，不使用 width/height。
 * 若源码中存在 width/height（如 AI 生成的代码），自动清除并转为 fontSize（取 width 值）。
 */
function patchStylePropInJsxSnippet(
  snippet: string,
  size: { width: number; height: number },
): string {
  const fontSize = size.width;

  const styleIdx = snippet.indexOf('style={{');
  if (styleIdx !== -1) {
    const innerStart = styleIdx + 'style={{'.length;
    const innerEnd = snippet.indexOf('}}', innerStart);
    if (innerEnd !== -1) {
      let inner = snippet.slice(innerStart, innerEnd);

      // 清除 width / height（不论 AI 写了什么），统一改用 fontSize
      inner = inner.replace(/,?\s*\bwidth\s*:\s*[^,}]+/g, '');
      inner = inner.replace(/,?\s*\bheight\s*:\s*[^,}]+/g, '');
      inner = cleanStyleInner(inner);
      inner = setStyleProp(inner, 'fontSize', fontSize);

      return snippet.slice(0, styleIdx) + 'style={{ ' + inner + ' }}' + snippet.slice(innerEnd + 2);
    }
  }

  // 没有 style prop，插入新的
  const selfClose = snippet.lastIndexOf('/>');
  if (selfClose !== -1) {
    return snippet.slice(0, selfClose).trimEnd() + ` style={{ fontSize: ${fontSize} }} />`;
  }
  const firstClose = snippet.indexOf('>');
  if (firstClose !== -1) {
    return snippet.slice(0, firstClose) + ` style={{ fontSize: ${fontSize} }}` + snippet.slice(firstClose);
  }
  return snippet;
}

/**
 * 从三方图标组件对应的 JSX 源码片段中读取当前显式设置的尺寸。
 * 优先读 style.fontSize；若 AI 生成了旧式 style.width/height 则作为 fallback 兼容读取。
 * 找不到显式尺寸时返回 { w: 0, h: 0 }，调用方可回退到 DOM 测量。
 */
export function readIconSizeFromJsx(params: any): { w: number; h: number } {
  const focusAreaEle = getFocusAreaEle(params);
  const loc = JSON.parse(focusAreaEle?.dataset?.loc ?? '{}');
  const jsxPath = loc.files?.jsx;
  if (!jsxPath) return { w: 0, h: 0 };

  const aiComParams = context.component?.params;
  const jsxFile = aiComParams?.data?.files?.find(
    (f: { fileName: string; source: string }) => f.fileName === jsxPath,
  );
  if (!jsxFile) return { w: 0, h: 0 };

  const source = decodeURIComponent(jsxFile.source);
  const start: number = loc.jsx?.start;
  const end: number = loc.jsx?.end;
  if (start == null || end == null || start < 0 || end > source.length) return { w: 0, h: 0 };

  const snippet = source.slice(start, end);

  // fontSize 优先（antd 等方形图标）
  const fontSizeMatch = snippet.match(/\bfontSize\s*:\s*(\d+(?:\.\d+)?)/);
  if (fontSizeMatch) {
    const size = Math.round(parseFloat(fontSizeMatch[1]));
    if (size > 0) return { w: size, h: size };
  }

  // 非方形：读 width / height
  const widthMatch = snippet.match(/\bwidth\s*:\s*(\d+(?:\.\d+)?)/);
  const heightMatch = snippet.match(/\bheight\s*:\s*(\d+(?:\.\d+)?)/);
  const w = widthMatch ? Math.round(parseFloat(widthMatch[1])) : 0;
  const h = heightMatch ? Math.round(parseFloat(heightMatch[1])) : 0;
  if (w > 0 && h > 0) return { w, h };
  if (w > 0) return { w, h: w };
  if (h > 0) return { w: h, h };

  return { w: 0, h: 0 };
}

export function patchIconSizeInTsx(params: any, size: { width: number; height: number }): void {
  const focusAreaEle = getFocusAreaEle(params);
  const loc = JSON.parse(focusAreaEle?.dataset?.loc ?? '{}');
  const jsxPath = loc.files?.jsx;
  if (!jsxPath) return;

  const aiComParams = context.component?.params;
  const jsxFile = aiComParams?.data?.files?.find(
    (f: { fileName: string; source: string }) => f.fileName === jsxPath,
  );
  if (!jsxFile) return;

  const source = decodeURIComponent(jsxFile.source);
  const hintStart: number = loc.jsx?.start;
  if (hintStart == null || hintStart < 0) return;

  // 动态扫描标签实际范围，避免前一次 patch 后 loc.jsx.end 失效
  const range = findActualIconTagRange(source, hintStart);
  if (!range) return;

  const { start, end } = range;
  const snippet = source.slice(start, end);
  if (!snippet.startsWith('<')) return;

  const newSnippet = patchStylePropInJsxSnippet(snippet, size);
  if (newSnippet === snippet) return;

  const newSource = source.slice(0, start) + newSnippet + source.slice(end);

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
}
