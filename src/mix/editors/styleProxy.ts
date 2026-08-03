import context, { config } from '../context';
import { parseLess, stringifyLess } from '../utils/transform/less';
import { debounce } from '../../utils/debounce'
import { undoRedoManager } from './undoRedo'
import { convertCamelToHyphen } from '../../utils/string'
import { randomUUID } from '../utils/uuid'
import { buildElementImageUpdateChipData, buildElementStyleUpdateChipData, buildElementSvgUpdateChipData, getElementLabel } from './setSegment/elementChip'
import { patchJsxInlineStyle, patchDataStyleInfo, injectStyleAttrIntoJSX, appendToInlineStyleAttr, removeFromInlineStyleAttr, StyleInfoEntry } from './style/helpers/patchJsxInlineStyle'
import { resolveLessFilePath } from './style/helpers/resolveLessFilePath'

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

function kebabToCamelProp(str: string) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * expandDeletions 会把 longhand 删除连带上简写（如删 backgroundImage → 也删 background）。
 * 同批 value 正在写入的属性必须排除，否则「写入 background + 删除旧 backgroundImage」
 * 会在落盘时把刚写入的 background 立刻删掉，表现为编辑器有值但 less 未更新。
 */
function filterExpandedDeletions(
  deletions: string[] | null | undefined,
  value: Record<string, any> | null | undefined,
): string[] {
  const expanded = expandDeletions(deletions || []);
  if (!value || typeof value !== 'object') return expanded;

  const protectedKeys = new Set<string>();
  Object.keys(value).forEach((key) => {
    if (value[key] === null || value[key] === undefined) return;
    protectedKeys.add(key);
    protectedKeys.add(camelToKebab(key));
    protectedKeys.add(kebabToCamelProp(key));
  });

  return expanded.filter(
    (key) =>
      !protectedKeys.has(key) &&
      !protectedKeys.has(kebabToCamelProp(key)) &&
      !protectedKeys.has(camelToKebab(key)),
  );
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

/**
 * 访问平台的 shadow DOM（样式注入在其中），等同于 editors-pc-common 的 getDocument()。
 */
function getShadowDoc(): Document | ShadowRoot {
  return (document.getElementById('_mybricks-geo-webview_') as HTMLElement | null)?.shadowRoot
    ?? (document as unknown as ShadowRoot);
}

/**
 * 简易 CSS 特指度分值（用于与纯单类 targetKey 做大小比较，不需要精确三元组）。
 * - `:where()` 贡献 0 特指度
 * - ID 选择器 #xxx：100
 * - 类/属性/伪类 .cls / [attr] / :hover：10
 * - 元素标签 div / th：1
 */
function simpleSpecificity(selector: string): number {
  const s = selector.replace(/:where\([^)]*\)/g, '');
  const ids = (s.match(/#[\w-]+/g) ?? []).length * 100;
  const classes = (s.match(/\.[\w-]+|\[[\w\s=^$*|~"']+\]/g) ?? []).length * 10;
  const tagMatches = (s.match(/(?:^|[\s>+~,])([a-z][a-z0-9-]*)(?=[.#:[\s>+~,{]|$)/g) ?? [])
    .map(m => m.trim())
    .filter(t => !['not', 'is', 'has', 'where', 'matches', 'nth', 'child', 'type', 'last', 'first', 'only', 'root', 'any'].includes(t));
  return ids + classes + tagMatches.length;
}

/**
 * `background` 简写属性展开后会影响的所有 longhand（连字符格式）。
 * antd 写 `background: #1677ff` 时，浏览器会隐式将 background-image 等 reset 为初始值。
 */
const BACKGROUND_LONGHAND_PROPS = [
  'background-color', 'background-image', 'background-size',
  'background-repeat', 'background-position', 'background-origin',
  'background-clip', 'background-attachment',
];

/**
 * 扫描 shadow DOM 内的 CSSOM，收集"匹配 ele 且特指度高于 targetKey"的所有竞争规则
 * 所设置的 CSS 属性（hyphen 格式）。
 *
 * 解决场景：antd 等外部库的复合类选择器（如 `.css-xxx.ant-btn-variant-solid`，特指度 0,2,0）
 * 会覆盖组件自身的单类选择器（`.headerStockInBtn`，0,1,0），而 cssObj 扫描看不到外部样式表。
 * `background` 简写展开处理：竞争规则设置了 `background` 时，视为同时影响所有 background-* 子属性。
 * `element.matches()` 天然过滤 `:hover/:focus` 等非激活伪类规则，不受点击时 hover 状态影响。
 *
 * @returns 被更高优先级规则覆盖的 hyphen 属性名集合
 */
// 提取 CSS 选择器末尾的交互伪类（如 :hover、:focus）
const PSEUDO_TAIL_RE = /:(hover|focus|active|visited|disabled|checked|focus-within|focus-visible|placeholder-shown|indeterminate|enabled|read-only|read-write)\s*$/i;

function collectCSSOMOverriddenProps(
  ele: Element,
  targetKey: string,
): Set<string> {
  const result = new Set<string>();

  // 提取 targetKey 中的伪类尾缀（如 '.addBtn:hover' → ':hover'）
  const pseudoMatch = targetKey.match(PSEUDO_TAIL_RE);
  const targetPseudo = pseudoMatch ? pseudoMatch[0].trim() : null;
  const targetBase   = targetPseudo
    ? targetKey.slice(0, targetKey.lastIndexOf(targetPseudo)).trim()
    : targetKey;

  // 非伪类情况：仅处理简单单类选择器
  if (!targetPseudo && !/^\.[\w-]+$/.test(targetKey)) return result;
  // 伪类情况：base 部分必须包含类名
  if (targetPseudo && !targetBase) return result;

  const targetSpec = simpleSpecificity(targetKey);

  try {
    const shadowDoc = getShadowDoc();
    for (const sheet of Array.from(shadowDoc.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          if (!(rule instanceof CSSStyleRule)) continue;

          if (targetPseudo) {
            // 伪类模式：规则必须以相同伪类结尾，再用 base selector 验证 ele
            const rulePseudoM = rule.selectorText.match(PSEUDO_TAIL_RE);
            const rulePseudo  = rulePseudoM ? rulePseudoM[0].trim() : null;
            if (!rulePseudo || rulePseudo.toLowerCase() !== targetPseudo.toLowerCase()) continue;
            const ruleBase = rule.selectorText.slice(0, rule.selectorText.lastIndexOf(rulePseudo)).trim();
            try { if (!ruleBase || !ele.matches(ruleBase)) continue; } catch { continue; }
          } else {
            // 普通模式：直接 element.matches（天然过滤未激活的 :hover 等）
            try { if (!ele.matches(rule.selectorText)) continue; } catch { continue; }
          }

          if (simpleSpecificity(rule.selectorText) <= targetSpec) continue;

          const st = rule.style;
          for (let i = 0; i < st.length; i++) {
            result.add(st[i]);
          }
          // background 简写会隐式覆盖所有 background-* longhand
          if (st.getPropertyValue('background')) {
            BACKGROUND_LONGHAND_PROPS.forEach(p => result.add(p));
          }
        }
      } catch { /* 跨域样式表 SecurityError，跳过 */ }
    }
  } catch { /* shadowDoc 访问异常，兜底 */ }

  return result;
}

/**
 * 检查 cssObj 中是否存在"标签选择器参与组合"的规则，会以更高优先级覆盖同一属性。
 * 典型场景：th/td 等语义元素被 `.tableHeadRow th { color: #555 }` (0,1,1) 命中，
 * 而样式编辑器写出的 `.colIndustry { color: xxx }` 仅有 (0,1,0)，永远被压制。
 * 注意：仅扫描组件自身的 cssObj，外部样式表（如 antd）由 collectCSSOMOverriddenProps 负责。
 */
function hasTagBasedCompetingRule(
  cssObj: Record<string, any>,
  targetKey: string,
  tagName: string,
  propKey: string,
): boolean {
  if (!tagName || !/^\.[\w-]+$/.test(targetKey)) return false;
  const tag = tagName.toLowerCase();

  // parseLess 使用 AST 模式，保留嵌套结构。
  // 例如 .tableHeadRow { th { color: #555 } } 解析后 th 是 .tableHeadRow 值里的嵌套 key，
  // 必须递归扫描才能发现。
  function scanNested(obj: Record<string, any>): boolean {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val !== 'object' || val === null) continue;
      const segments = key.trim().split(/\s+/);
      const hasTag = segments.some(
        seg => seg === tag || seg.startsWith(tag + ':') ||
               seg.startsWith(tag + '.') || seg.startsWith(tag + '['),
      );
      if (hasTag && propKey in val) return true;
      if (scanNested(val)) return true;
    }
    return false;
  }

  for (const key of Object.keys(cssObj)) {
    if (key === targetKey) continue;
    const val = cssObj[key];
    if (typeof val !== 'object' || val === null) continue;
    const segments = key.trim().split(/\s+/);
    const hasTag = segments.some(
      seg => seg === tag || seg.startsWith(tag + ':') ||
             seg.startsWith(tag + '.') || seg.startsWith(tag + '['),
    );
    if (hasTag && propKey in val) return true;
    if (scanNested(val)) return true;
  }
  return false;
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

  // 逗号分隔选择器兼容（用顶层逗号拆分，避免 :not(a, b) 被误拆）
  const commaMatchKey = Object.keys(cssObj).find(k => {
    if (!k.includes(',')) return false;
    return splitTopLevelCommaKeys(k).some(
      s => s === fullSelector || s.endsWith(' ' + fullSelector),
    );
  });

  // 第 5 策略：CSS Modules 哈希复合类名反推（前 4 策略均失败时才触发）
  const cssModulesKey = tryResolveCSSModulesHashedSelector(cssObj, fullSelector);

  return suffixMatchKey ?? shrinkMatchKey ?? compoundMatchKey ?? commaMatchKey ?? cssModulesKey ?? fullSelector;
}

/**
 * 按顶层逗号拆分嵌套 key（如 "&:hover, &:focus" → ["&:hover", "&:focus"]），
 * 忽略括号内的逗号（如 "&:not(a, b)"）。
 */
function splitTopLevelCommaKeys(key: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < key.length; i++) {
    const ch = key[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(key.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(key.slice(start).trim());
  return parts.filter(Boolean);
}

/** 取选择器末尾 class token（如 ".a .b.c" → ".c"） */
function getSelectorLastClassToken(selectorPart: string): string {
  const lastSegment = selectorPart.trim().split(/\s+/).pop() || selectorPart;
  const classTokens = lastSegment.split('.').filter(Boolean);
  return classTokens.length > 0 ? '.' + classTokens[classTokens.length - 1] : lastSegment;
}

/**
 * 判断逗号分支是否对应当前正在编辑的选择器末段。
 * 兼容：精确匹配、作用域后缀、CSS Modules 哈希（- / --）。
 */
function commaBranchMatchesSelector(branch: string, fullSelector: string): boolean {
  const selectorLastSeg = fullSelector.trim().split(/\s+/).pop() || fullSelector;
  const selectorLastToken = getSelectorLastClassToken(fullSelector);
  const selClass = selectorLastToken.replace(/^\./, '');

  if (branch === fullSelector || branch.endsWith(' ' + fullSelector)) return true;
  if (branch === selectorLastSeg || branch.endsWith(' ' + selectorLastSeg)) return true;

  const branchLastToken = getSelectorLastClassToken(branch);
  if (branchLastToken === selectorLastToken) return true;

  const branchClass = branchLastToken.replace(/^\./, '');
  return !!selClass && (
    branchClass === selClass ||
    branchClass.endsWith('-' + selClass) ||
    branchClass.endsWith('--' + selClass)
  );
}

/**
 * 删除时：若属性落在顶层逗号合并规则（如 ".resetBtn, .queryBtn { min-width }"）中，
 * 先拆成独立分支（其它分支保留共享样式），再只从匹配当前编辑选择器的分支删除属性。
 * 与 tryWriteNestedPseudo 对 "&:hover, &:focus" 的拆分策略一致。
 */
function deleteFromCommaMergedTopLevelRules(
  cssObj: Record<string, any>,
  fullSelector: string,
  expandedDeletions: string[],
): void {
  const commaKeys = Object.keys(cssObj).filter(k => k.includes(','));
  for (const commaKey of commaKeys) {
    const branches = splitTopLevelCommaKeys(commaKey);
    if (branches.length < 2) continue;
    if (!branches.some(b => commaBranchMatchesSelector(b, fullSelector))) continue;

    const sharedStyle = cssObj[commaKey];
    if (!sharedStyle || typeof sharedStyle !== 'object' || Array.isArray(sharedStyle)) continue;

    // 拆分：各分支先继承共享样式；已有同名 key 时不覆盖其已有属性
    for (const branch of branches) {
      const existing = cssObj[branch];
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        cssObj[branch] = { ...sharedStyle, ...existing };
      } else {
        cssObj[branch] = { ...sharedStyle };
      }
    }
    delete cssObj[commaKey];

    // 只从当前编辑分支删除
    for (const branch of branches) {
      if (!commaBranchMatchesSelector(branch, fullSelector)) continue;
      if (!cssObj[branch] || typeof cssObj[branch] !== 'object') continue;
      expandedDeletions.forEach(k => { delete cssObj[branch][k]; });
      if (Object.keys(cssObj[branch]).length === 0) {
        delete cssObj[branch];
      }
    }
  }
}

/**
 * 删除时：属性实际写在更短的后缀选择器上（如 `.resetBtn { min-width }`），
 * 而 resolveTargetKey 命中了更长路径（如 `.contentArea ... .resetBtn`）时，
 * 需要把 deletions 同步落到所有 fullSelector 的后缀候选 key 上。
 *
 * 只取路径后缀（segments.slice(i)），不会误伤中间祖先（如单独的 .formActions）。
 */
function deleteFromShorterMatchingRules(
  cssObj: Record<string, any>,
  fullSelector: string,
  targetKey: string,
  expandedDeletions: string[],
): void {
  const segments = fullSelector.trim().split(/\s+/).filter(Boolean);
  const candidates = new Set<string>();

  for (let i = 0; i < segments.length; i++) {
    const candidate = segments.slice(i).join(' ');
    if (candidate) candidates.add(candidate);
  }

  const lastToken = getSelectorLastClassToken(fullSelector);
  if (lastToken) candidates.add(lastToken);

  for (const key of candidates) {
    if (key === targetKey) continue;
    if (key.includes(',')) continue; // 逗号合并由 deleteFromCommaMergedTopLevelRules 处理
    const styleObj = cssObj[key];
    if (!styleObj || typeof styleObj !== 'object' || Array.isArray(styleObj)) continue;

    expandedDeletions.forEach(k => { delete styleObj[k]; });
    if (Object.keys(styleObj).length === 0) {
      delete cssObj[key];
    }
  }
}

/**
 * 检测 fullSelector 是否命中 cssObj 中的嵌套伪类/伪元素规则（如 ".pageBtn" 下的 "&:disabled"），
 * 若命中则直接在原位写入样式，完全保留 Less 嵌套结构，并清理可能存在的历史孤儿复合规则。
 *
 * 背景：parseLess 会将 `&:disabled { ... }` 解析为父规则下的嵌套 key；
 * resolveTargetKey 只查顶层 key，导致 .pageBtn:disabled 匹配失败，退化成
 * 创建全路径孤立复合选择器（如 ".container ... .pageBtn:disabled"）。
 *
 * 逗号合并写法兼容：`&:hover, &:focus { ... }` 这种写法，parseLess（见
 * less/index.ts 的 getRawSelector）会把两个逗号分支的选择器 join 成同一个
 * key `"&:hover, &:focus"`，而不是拆成两条独立记录。若只精确匹配 `"&:focus"`
 * 必然找不到，会误判为"未命中嵌套伪类"，退化成创建一条全路径的孤立规则——
 * 这条新规则的 CSS 优先级比原有的 `.xxx:focus` 更高，会在视觉上覆盖/与原规则
 * 冲突（典型现象：背景面板出现两个"同时生效"但实际只有一个可见的背景图层）。
 * 因此这里精确匹配失败时，进一步在同层所有以 "&" 开头、含逗号的 key 里按顶层
 * 逗号拆开找命中的分支，命中即视为找到同一条嵌套规则。
 *
 * 命中合并 key 后不会直接往共享块里写（那样会让 :hover/:focus 两个状态同时被改动，
 * 编辑器里每个伪类 tab 理应能独立编辑）。而是先把合并 key 拆成各自独立的分支
 * （如 "&:hover"、"&:focus"），每个分支先复制一份原共享样式作为初始值——这样
 * 没被编辑的那个状态视觉效果不变——再只把这次的新值写入当前正在编辑的分支。
 * 拆分后两个分支各自独立，后续编辑互不影响。
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
    const mergedKey = cssObj[base][nestedKey] === undefined
      ? Object.keys(cssObj[base]).find(k =>
          k.startsWith('&') && k.includes(',') && splitTopLevelCommaKeys(k).includes(nestedKey)
        )
      : undefined;
    if (cssObj[base][nestedKey] === undefined && mergedKey === undefined) continue;

    // 命中的是逗号合并块（且本身就有多个分支）：拆分成独立分支，各自继承原共享样式，
    // 避免"编辑其中一个伪类，另一个未编辑的伪类也被联动修改"。
    if (mergedKey !== undefined) {
      const branches = splitTopLevelCommaKeys(mergedKey);
      const sharedStyle = cssObj[base][mergedKey];
      branches.forEach(branchKey => {
        cssObj[base][branchKey] = { ...sharedStyle };
      });
      delete cssObj[base][mergedKey];
    }

    // 找到嵌套伪类，直接在原位写入，保留 Less 嵌套结构
    const target = cssObj[base][nestedKey] as Record<string, any>;
    Object.entries(value).forEach(([k, v]) => { target[k] = v; });

    if (deletions && deletions.length > 0) {
      const expandedDeletions = filterExpandedDeletions(deletions, value);
      expandedDeletions.forEach(k => {
        delete target[k];
        delete target[kebabToCamelProp(k)];
        delete target[camelToKebab(k)];
      });
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
  let previousLess: string | null = null
  type AIStylePayload = {
    jsxFileName?: string;
    lineStart?: number;
    lineEnd?: number;
    codeSnippet?: string;
    focusTitle?: string;
    focusComName?: string;
    domSummary?: string;
    styleValue: Record<string, any>;
    deletions: string[];
  };
  const tryParseJSON = <T = any>(raw: string | null | undefined, fallback: T): T => {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };
  const pickLocFromDomChain = (startEle: Element | null): any => {
    let cur = startEle as HTMLElement | null;
    while (cur) {
      const loc = tryParseJSON<any>(cur.dataset?.loc, null);
      if (loc && typeof loc === 'object' && Object.keys(loc).length > 0) return loc;
      cur = cur.parentElement;
    }
    return {};
  };
  const buildDomSummary = (startEle: Element | null): string => {
    if (!startEle) return '';
    const lines: string[] = [];
    const walk = (node: Element, depth: number) => {
      if (depth > 2) return;
      const tag = node.tagName.toLowerCase();
      const cls = Array.from(node.classList || []).slice(0, 3).join('.');
      const role = node.getAttribute('role') || '';
      const text = Array.from(node.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent || '').trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, 20);
      lines.push(`${'  '.repeat(depth)}${tag}${cls ? `(.${cls})` : ''}${role ? ` [role=${role}]` : ''}${text ? ` "${text}"` : ''}`);
      Array.from(node.children).slice(0, 6).forEach((child) => walk(child, depth + 1));
    };
    walk(startEle, 0);
    return lines.join('\n').slice(0, 380);
  };
  const buildDomIdentity = (startEle: Element | null): string => {
    if (!startEle) return 'unknown';
    const node = startEle as HTMLElement;
    const tag = node.tagName.toLowerCase();
    const role = node.getAttribute('role') || '';
    const cls = Array.from(node.classList || []).slice(0, 2).join('.');
    const text = (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18);
    const path: string[] = [];
    let cur: HTMLElement | null = node;
    let depth = 0;
    while (cur && depth < 4) {
      const parent = cur.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children);
      const idx = siblings.indexOf(cur);
      path.push(`${cur.tagName.toLowerCase()}:${idx}`);
      cur = parent as HTMLElement;
      depth++;
    }
    return `${tag}|${role}|${cls}|${text}|${path.join('>')}`;
  };
  let pendingAIPayload: AIStylePayload | null = null;
  let lastAISignature = '';
  const debouncedAIStyleRequest = debounce(() => {
    const payload = pendingAIPayload;
    pendingAIPayload = null;
    if (!payload) return;

    const { jsxFileName, lineStart, lineEnd, codeSnippet, styleValue, deletions, focusTitle, focusComName, domSummary } = payload;
    const styleDesc = Object.entries(styleValue)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([key, v]) => `${convertCamelToHyphen(key)}: ${String(v)}`)
      .join('；');
    const deletionDesc = deletions.length > 0
      ? deletions.map((k) => convertCamelToHyphen(k)).join('、')
      : '';
    const signature = JSON.stringify({
      jsxFileName,
      lineStart,
      lineEnd,
      styleValue,
      deletions: [...deletions].sort(),
    });
    if (signature === lastAISignature) return;
    lastAISignature = signature;

    const message = [
      `你正在处理“三方组件内部 DOM”的样式调整需求，这类样式通常应通过组件 props、外层 className 或 JSX style 在源码中实现，而不是依赖直接改内部 DOM。`,
      styleDesc
        ? `目标样式：${styleDesc}。`
        : `用户执行的是样式删除操作。`,
      deletionDesc ? `需要删除的样式属性：${deletionDesc}。` : '',
      `请基于下方聚焦上下文定位实际源码入口，修改后确保视觉结果与目标样式一致。优先做最小改动，不要影响其它实例。`,
      focusComName ? `聚焦组件名：${focusComName}` : '',
      focusTitle ? `聚焦标题：${focusTitle}` : '',
      jsxFileName
        ? `优先修改文件：\`${jsxFileName}\`${lineStart && lineEnd ? `（重点查看第 ${lineStart}~${lineEnd} 行附近）` : ''}。`
        : '',
      codeSnippet ? `\n相关代码片段（用于定位）：\n\`\`\`tsx\n${codeSnippet}\n\`\`\`` : '',
      domSummary ? `\n聚焦 DOM 摘要（用于辅助定位）：\n${domSummary}` : '',
      `请直接返回可执行的代码修改结果。`,
    ].filter(Boolean).join('\n');

    const plugins = context.plugins as any;
    plugins?.showAIDialog?.();
    plugins?.aiService?.request({
      message,
      mentionFocus: true,
      attachments: [],
    });
  }, 700);

  type PreviewOriginal = { hadValue: boolean; value: string; priority: string };
  type TargetSnapshot = {
    targetKey: string;
    jsxFileName?: string;
    lineStart?: number;
    lineEnd?: number;
    codeSnippet?: string;
    focusTitle?: string;
    focusComName?: string;
    domSummary?: string;
    stylePatch: Record<string, any>;
    deletions: Set<string>;
  };
  let batchEnabled = false;
  let batchSubmitting = false;
  const batchTargets = new Map<string, TargetSnapshot>();
  const previewOriginals = new Map<HTMLElement, Map<string, PreviewOriginal>>();
  const batchInstanceId = `style_batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  type BatchMeta = { enabled: boolean; dirtyCount: number; submitting: boolean };
  type BatchBridgeEntry = {
    commit: () => void;
    discard: () => void;
    getMeta: () => BatchMeta;
  };

  const ensureGlobalBatchBridge = () => {
    const win = window as any;
    if (!(win.__mybricks_style_batch_registry instanceof Map)) {
      win.__mybricks_style_batch_registry = new Map<string, BatchBridgeEntry>();
    }
    const registry = win.__mybricks_style_batch_registry as Map<string, BatchBridgeEntry>;
    const aggregateMeta = (): BatchMeta => {
      let enabled = false;
      let dirtyCount = 0;
      let submitting = false;
      registry.forEach((entry) => {
        const meta = entry.getMeta?.() ?? { enabled: false, dirtyCount: 0, submitting: false };
        const dirty = Number(meta.dirtyCount || 0);
        dirtyCount += dirty;
        enabled = enabled || !!meta.enabled || dirty > 0;
        submitting = submitting || !!meta.submitting;
      });
      return { enabled, dirtyCount, submitting };
    };
    win.__mybricks_style_batch_bridge = {
      commit: () => {
        registry.forEach((entry) => {
          const meta = entry.getMeta?.();
          if ((meta?.dirtyCount || 0) > 0 || meta?.enabled) {
            entry.commit?.();
          }
        });
      },
      discard: () => {
        registry.forEach((entry) => {
          const meta = entry.getMeta?.();
          if ((meta?.dirtyCount || 0) > 0 || meta?.enabled) {
            entry.discard?.();
          }
        });
      },
      getMeta: () => aggregateMeta(),
    };
    return registry;
  };

  const toTargetContext = (params: any, value: Record<string, any>, deletions: string[]) => {
    const locRaw = params.focusArea?.dataset?.loc;
    const cn = tryParseJSON<any>(locRaw, {});
    const ele: Element | null = params.focusArea?.ele ?? null;
    const chainLoc = pickLocFromDomChain(ele);
    const mergedLoc = {
      ...chainLoc,
      ...cn,
      files: { ...(chainLoc?.files || {}), ...(cn?.files || {}) },
      codeLine: { ...(chainLoc?.codeLine || {}), ...(cn?.codeLine || {}) },
      jsx: { ...(chainLoc?.jsx || {}), ...(cn?.jsx || {}) },
    };
    const jsxFileName: string | undefined = mergedLoc.files?.jsx;
    const locCodeLine = mergedLoc.codeLine ?? {};
    const lineStart: number | undefined = typeof locCodeLine.start === 'number' ? locCodeLine.start : undefined;
    const lineEnd: number | undefined = typeof locCodeLine.end === 'number' ? locCodeLine.end : undefined;
    let codeSnippet = '';
    const aiComParams = context.component?.params;
    if (jsxFileName) {
      const jsxFile = aiComParams?.data?.files?.find((f: { fileName: string; source: string }) => f.fileName === jsxFileName);
      if (jsxFile) {
        const source = decodeURIComponent(jsxFile.source);
        if (lineStart && lineEnd) {
          const lines = source.split('\n');
          codeSnippet = lines
            .slice(Math.max(0, lineStart - 3), Math.min(lines.length, lineEnd + 2))
            .join('\n');
        } else if (mergedLoc?.jsx?.start != null && mergedLoc?.jsx?.end != null) {
          codeSnippet = source.slice(mergedLoc.jsx.start, mergedLoc.jsx.end);
        }
      }
    }
    const focusComName = ele?.closest?.('[data-com-name]')?.getAttribute?.('data-com-name') || '';
    const focusTitle = ele?.closest?.('[data-zone-title]')?.getAttribute?.('data-zone-title') || '';
    const domSummary = buildDomSummary(ele);
    const domIdentity = buildDomIdentity(ele);
    const selector = params.selector || '';
    const targetKey = `${jsxFileName || 'unknown'}::${selector}::${focusComName || focusTitle || 'focus'}::${domIdentity}`;
    return {
      targetKey,
      ele: ele as HTMLElement | null,
      jsxFileName,
      lineStart,
      lineEnd,
      codeSnippet,
      focusTitle,
      focusComName,
      domSummary,
      styleValue: { ...(value || {}) },
      deletions,
    };
  };

  const ensurePreviewOriginal = (ele: HTMLElement, cssProp: string) => {
    let eleMap = previewOriginals.get(ele);
    if (!eleMap) {
      eleMap = new Map<string, PreviewOriginal>();
      previewOriginals.set(ele, eleMap);
    }
    if (!eleMap.has(cssProp)) {
      const currentValue = ele.style.getPropertyValue(cssProp);
      const currentPriority = ele.style.getPropertyPriority(cssProp);
      eleMap.set(cssProp, {
        hadValue: currentValue !== '',
        value: currentValue,
        priority: currentPriority,
      });
    }
  };

  const applyPreviewPatch = (ele: HTMLElement | null, styleValue: Record<string, any>, deletions: string[]) => {
    if (!ele) return;
    Object.entries(styleValue).forEach(([key, val]) => {
      const cssProp = convertCamelToHyphen(key);
      ensurePreviewOriginal(ele, cssProp);
      if (val === null || val === undefined || val === '') {
        ele.style.removeProperty(cssProp);
      } else {
        ele.style.setProperty(cssProp, String(val), 'important');
      }
    });
    deletions.forEach((key) => {
      const cssProp = convertCamelToHyphen(key);
      ensurePreviewOriginal(ele, cssProp);
      ele.style.removeProperty(cssProp);
    });
  };

  const getDirtyCount = () => {
    let total = 0;
    batchTargets.forEach((target) => {
      total += Object.keys(target.stylePatch).length + target.deletions.size;
    });
    return total;
  };

  const restorePreviewStyles = () => {
    previewOriginals.forEach((styleMap, ele) => {
      styleMap.forEach((origin, cssProp) => {
        if (origin.hadValue) {
          ele.style.setProperty(cssProp, origin.value, origin.priority || '');
        } else {
          ele.style.removeProperty(cssProp);
        }
      });
    });
    previewOriginals.clear();
  };

  const clearBatchState = () => {
    batchTargets.clear();
    restorePreviewStyles();
    batchSubmitting = false;
    batchEnabled = false;
  };

  const sendBatchAIRequest = () => {
    if (batchSubmitting) return;
    const dirtyCount = getDirtyCount();
    if (dirtyCount === 0) return;
    batchSubmitting = true;
    const grouped = new Map<string, TargetSnapshot[]>();
    batchTargets.forEach((target) => {
      const fileKey = target.jsxFileName || 'unknown-file';
      if (!grouped.has(fileKey)) grouped.set(fileKey, []);
      grouped.get(fileKey)!.push(target);
    });
    const detailBlocks: string[] = [];
    grouped.forEach((targets, fileKey) => {
      detailBlocks.push(`文件: ${fileKey}`);
      targets.forEach((target, idx) => {
        const styleDesc = Object.entries(target.stylePatch)
          .map(([k, v]) => `- ${convertCamelToHyphen(k)}: ${String(v)}`)
          .join('\n');
        const deletionDesc = target.deletions.size > 0
          ? Array.from(target.deletions).map((k) => `- 删除 ${convertCamelToHyphen(k)}`).join('\n')
          : '';
        detailBlocks.push([
          `目标 ${idx + 1}${target.lineStart && target.lineEnd ? `（${target.lineStart}~${target.lineEnd} 行）` : ''}:`,
          target.focusComName ? `组件: ${target.focusComName}` : '',
          target.focusTitle ? `标题: ${target.focusTitle}` : '',
          styleDesc ? `样式修改:\n${styleDesc}` : '',
          deletionDesc ? `样式删除:\n${deletionDesc}` : '',
          target.codeSnippet ? `代码片段:\n\`\`\`tsx\n${target.codeSnippet}\n\`\`\`` : '',
          target.domSummary ? `注意仅修改其中这个dom的样式:\n${target.domSummary}` : '',
        ].filter(Boolean).join('\n'));
      });
    });
    const message = [
      `请一次性完成以下三方组件内部 DOM 样式改造，按每个目标的“最终状态”修改源码（不要保留中间过程值）。`,
      `优先通过组件 props、外层 className 或 JSX style 调整，确保视觉结果与目标一致，并避免影响其他实例。`,
      ...detailBlocks,
      `请直接返回可执行的代码修改结果。`,
    ].join('\n\n');
    const requestPayload = {
      message,
      mentionFocus: true,
      attachments: [],
    };
    const plugins = context.plugins as any;
    const appendToSender = (window as any)?._sandbox_?.helpers?.appendToSender;
    const componentId = context.component?.params?.id;
    if (typeof appendToSender === 'function' && componentId) {
      plugins?.showAIDialog?.();
      appendToSender(componentId, requestPayload);
    } else {
      plugins?.showAIDialog?.();
      plugins?.aiService?.request(requestPayload);
    }
    clearBatchState();
  };

  const upsertBatchSnapshot = (params: any, value: Record<string, any>, deletions: string[]) => {
    const ctxInfo = toTargetContext(params, value || {}, deletions);
    const existing = batchTargets.get(ctxInfo.targetKey) ?? {
      targetKey: ctxInfo.targetKey,
      jsxFileName: ctxInfo.jsxFileName,
      lineStart: ctxInfo.lineStart,
      lineEnd: ctxInfo.lineEnd,
      codeSnippet: ctxInfo.codeSnippet,
      focusTitle: ctxInfo.focusTitle,
      focusComName: ctxInfo.focusComName,
      domSummary: ctxInfo.domSummary,
      stylePatch: {},
      deletions: new Set<string>(),
    };
    Object.entries(ctxInfo.styleValue).forEach(([key, val]) => {
      if (val === null || val === undefined || val === '') {
        delete existing.stylePatch[key];
        existing.deletions.add(key);
      } else {
        existing.stylePatch[key] = val;
        existing.deletions.delete(key);
      }
    });
    ctxInfo.deletions.forEach((key) => {
      delete existing.stylePatch[key];
      existing.deletions.add(key);
    });
    batchTargets.set(ctxInfo.targetKey, existing);
    applyPreviewPatch(ctxInfo.ele, ctxInfo.styleValue, ctxInfo.deletions);
  };

  const syncBatchBridge = () => {
    const registry = ensureGlobalBatchBridge();
    registry.set(batchInstanceId, {
      commit: () => sendBatchAIRequest(),
      discard: () => clearBatchState(),
      getMeta: () => ({
        enabled: batchEnabled,
        dirtyCount: getDirtyCount(),
        submitting: batchSubmitting,
      }),
    });
  };

  const getStyleActionTitle = (ele: Element) => `调整 ${getElementLabel(ele, '节点1')} 样式`;
  type PendingStyleFileUpdate = { previous: string; current: string };
  type PendingStyleFileBranch = {
    files: Map<string, PendingStyleFileUpdate>;
    ele: Element | null;
    title: string;
    actionId: string;
    actionApplied: boolean;
  };
  let pendingStyleFileBranch: PendingStyleFileBranch | null = null;

  /**
   * 保持原有 trailing debounce：窗口内所有直接样式写入只对应一条分支命令和一条用户操作记录。
   * 操作记录在首次写入时立即创建以唤起操作面板；防抖只负责结束本轮源码聚合窗口。
   */
  const finalizeStyleFileBranch = debounce(() => {
    const branch = pendingStyleFileBranch;
    if (!branch) return;

    pendingStyleFileBranch = null;
  }, 500);

  // 提交或取消分支时立即关闭旧的源码聚合窗口。
  undoRedoManager.onBranchHistoryChange((hasHistory) => {
    if (!hasHistory) pendingStyleFileBranch = null;
  });

  const updateStyleFileInBranch = (params: {
    path: string;
    current: string;
    previous: string;
    ele: Element | null;
    callback: () => void;
  }) => {
    const { path, current, previous, ele, callback } = params;
    let branch = pendingStyleFileBranch;

    if (!branch) {
      branch = {
        files: new Map([[path, { previous, current }]]),
        ele,
        title: ele ? getStyleActionTitle(ele) : '调整节点样式',
        actionId: randomUUID(),
        actionApplied: false,
      };
      pendingStyleFileBranch = branch;

      const currentBranch = branch;
      undoRedoManager.executeBranch({
        execute() {
          currentBranch.files.forEach(({ current }, fileName) => {
            context.updateFile({ fileName, content: current, type: undefined });
          });
          // 首次执行与 redo 都在这里登记操作，保证面板不受 debounce 延迟影响。
          if (currentBranch.ele && !currentBranch.actionApplied) {
            context.component?.actions.addUserAction({
              id: currentBranch.actionId,
              type: 'update-style',
              title: currentBranch.title,
              refElement: currentBranch.ele,
            });
            currentBranch.actionApplied = true;
          }
        },
        undo() {
          if (pendingStyleFileBranch === currentBranch) pendingStyleFileBranch = null;
          currentBranch.files.forEach(({ previous }, fileName) => {
            context.updateFile({ fileName, content: previous, type: undefined });
          });
          if (currentBranch.actionApplied) {
            context.component?.actions.removeUserAction(currentBranch.actionId);
            currentBranch.actionApplied = false;
          }
        },
      });
    } else {
      // 防抖窗口内仅更新最终源码，首个 previous 始终作为撤销基线。
      const file = branch.files.get(path);
      if (file) {
        file.current = current;
      } else {
        branch.files.set(path, { previous, current });
      }
      branch.ele = ele;
      branch.title = ele ? getStyleActionTitle(ele) : branch.title;
      context.updateFile({ fileName: path, content: current, type: undefined });
    }

    finalizeStyleFileBranch();
    callback();
  };

  /** 三方内部 DOM 没有可安全落盘的 CSS 入口时，按 setSegment 的 chip 分支请求 AI。 */
  const updateAIStyleInBranch = (ele: HTMLElement, value: Record<string, any>, deletions: string[]) => {
    const styleChanges = [
      ...Object.entries(value).map(([key, value]) => ({ key, value })),
      ...deletions
        .filter((key) => !(key in value))
        .map((key) => ({ key, value: null })),
    ];
    if (!styleChanges.length) return;

    const previousStyles = styleChanges.map(({ key }) => {
      const property = convertCamelToHyphen(key);
      const previousValue = ele.style.getPropertyValue(property);
      return {
        property,
        hadValue: previousValue !== '',
        value: previousValue,
        priority: ele.style.getPropertyPriority(property),
      };
    });
    const label = getElementLabel(ele, '节点1');
    const actionId = randomUUID();
    const chip = {
      id: randomUUID(),
      type: 'element-style-update',
      label: `调整 ${label} 样式`,
      data: buildElementStyleUpdateChipData(ele, styleChanges, label),
    };

    const applyPreview = () => {
      styleChanges.forEach(({ key, value }) => {
        const property = convertCamelToHyphen(key);
        if (value === null || value === undefined || value === '') {
          ele.style.removeProperty(property);
        } else {
          ele.style.setProperty(property, String(value), 'important');
        }
      });
    };

    undoRedoManager.executeBranch({
      aiRequest: {
        message: `[[chip:${chip.id}]]`,
        chips: [chip],
      },
      execute() {
        applyPreview();
        context.component?.actions.addUserAction({
          id: actionId,
          type: 'update-style',
          title: getStyleActionTitle(ele),
          refElement: ele,
        });
      },
      undo() {
        previousStyles.forEach(({ property, hadValue, value, priority }) => {
          if (hadValue) {
            ele.style.setProperty(property, value, priority);
          } else {
            ele.style.removeProperty(property);
          }
        });
        context.component?.actions.removeUserAction(actionId);
      },
    });
  };

  return {
    set(params: any, value: any) {
      const locRaw = params.focusArea?.dataset?.loc;
      const cn = tryParseJSON<any>(locRaw, {});
      const deletions: string[] | null = (window as any).__mybricks_style_deletions;
      const aiComParams = context.component?.params;
      // 子目录 tsx 未 import less 时：先看入口文件的 less import，再按文件名兜底
      const lessPath = resolveLessFilePath(
        cn.files?.less,
        aiComParams?.data?.files,
        config.getEntryFile(),
      );
      const ele: Element | null = params.focusArea?.ele ?? null;
      const eleClassList = ele ? Array.from(ele.classList) as string[] : [];
      const hasDataZoneSelector = !!(ele as HTMLElement | null)?.dataset?.zoneSelector;
      const isAIOnlyNode = !!ele && !hasDataZoneSelector;

      if (isAIOnlyNode) {
        updateAIStyleInBranch(ele as HTMLElement, value || {}, (deletions || []).slice());
        return;
      }

      const lessFile = lessPath
        ? aiComParams.data.files?.find((f: { fileName: string; source: string }) => f.fileName === lessPath)
        : undefined;
      const rawLess = lessFile?.source ?? aiComParams.data.styleSource ?? '';
      if (!previousLess) {
        previousLess = rawLess ? decodeURIComponent(rawLess) : ''
      }
      const cssObj = rawLess ? parseLess(decodeURIComponent(rawLess)) : {};

      const fullSelector = params.selector;

      // ── 内联样式优先路径 ──────────────────────────────────────────
      // 读取 Babel 插件注入的 data-style-info，判断哪些 key 是静态内联 style
      type StyleKeyInfo = { kind: 'static' | 'dynamic'; valueStart?: number; valueEnd?: number };
      const styleInfoRaw = (ele as HTMLElement | null)?.dataset?.styleInfo;
      const styleInfo: Record<string, StyleKeyInfo> | null = styleInfoRaw
        ? (() => { try { return JSON.parse(styleInfoRaw) } catch { return null } })()
        : null;

      // 将 value 分为"内联写 JSX"和"剩余写 Less"两组
      type InlineEntry = { key: string; val: string; valueStart: number; valueEnd: number };
      const inlineEntries: InlineEntry[] = [];
      const lessValue: Record<string, any> = {};

      Object.entries(value as Record<string, any>).forEach(([key, val]) => {
        const info = styleInfo?.[key];
        if (
          val !== null && val !== undefined &&
          info?.kind === 'static' &&
          info.valueStart != null && info.valueEnd != null
        ) {
          inlineEntries.push({ key, val: String(val), valueStart: info.valueStart, valueEnd: info.valueEnd });
        } else {
          lessValue[key] = val;
        }
      });

      // 写 JSX 内联 style
      if (inlineEntries.length > 0) {
        const jsxPath = cn.files?.jsx;
        if (jsxPath) {
          const jsxFile = aiComParams.data.files?.find(
            (f: { fileName: string; source: string }) => f.fileName === jsxPath
          );
          if (jsxFile) {
            const jsxPrevSource = decodeURIComponent(jsxFile.source);
            const jsxNewSource = patchJsxInlineStyle(
              jsxPrevSource,
              inlineEntries.map(({ val, valueStart, valueEnd }) => ({ val, valueStart, valueEnd, asString: true })),
            );
            if (jsxNewSource) {
              updateStyleFileInBranch({
                path: jsxPath,
                current: jsxNewSource,
                previous: jsxPrevSource,
                ele,
                callback: () => { previousLess = null; },
              });
              // 同步更新 DOM 上的 data-style-info 偏移量，防止连续编辑时偏移量因字符长度变化而失效
              if (ele) {
                patchDataStyleInfo(ele as HTMLElement, inlineEntries.map(({ val, valueStart, valueEnd }) => {
                  const escaped = val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                  return { valueStart, valueEnd, newLen: `'${escaped}'`.length };
                }));
              }
            } else {
              // patch 失败（偏移过期）→ 降级：把这些 key 回退到 Less 流程
              inlineEntries.forEach(({ key, val }) => { lessValue[key] = val; });
            }
          } else {
            // 找不到 JSX 文件，全部降级
            inlineEntries.forEach(({ key, val }) => { lessValue[key] = val; });
          }
        } else {
          // 没有 jsxPath，全部降级
          inlineEntries.forEach(({ key, val }) => { lessValue[key] = val; });
        }
      }

      // 若无需改 Less，提前退出
      if (Object.keys(lessValue).length === 0 && !(deletions && deletions.length > 0)) {
        return;
      }

      // 无 className 的元素（选择器末尾为 HTML 标签名，如 span / h2）：
      // 不写 Less（会产生全局性标签选择器规则），改为向 JSX 源码注入/追加/删除内联 style。
      if (eleClassList.length === 0) {
        // 仅处理选择器末尾是纯 HTML 标签名（如 ".parent span"）的情况
        const selectorEndsWithTag = fullSelector && /\s[a-z][a-zA-Z0-9]*$/.test(fullSelector);
        if (!selectorEndsWithTag) return;

        // 需要删除的内联属性：deletions 中在 styleInfo 有静态偏移记录的 key
        const inlineDeletions = (deletions || []).filter(
          (key: string) => styleInfo !== null && (styleInfo as any)[key]?.kind === 'static',
        );
        const hasInlineDeletions = inlineDeletions.length > 0;

        const propsToWrite: Record<string, string> = {};
        Object.entries(lessValue).forEach(([k, v]) => {
          if (v !== null && v !== undefined && v !== '') propsToWrite[k] = String(v);
        });
        const hasPropsToWrite = Object.keys(propsToWrite).length > 0;

        if (!hasPropsToWrite && !hasInlineDeletions) return;

        const jsxPathForInline: string | undefined = (() => {
          const locRaw = (ele as HTMLElement | null)?.dataset?.loc;
          if (!locRaw) return undefined;
          try { return JSON.parse(locRaw)?.files?.jsx; } catch { return undefined; }
        })();
        if (!jsxPathForInline) return;

        const jsxFileForInline = aiComParams.data.files?.find(
          (f: { fileName: string; source: string }) => f.fileName === jsxPathForInline,
        );
        if (!jsxFileForInline) return;

        const jsxPrevSource = decodeURIComponent(jsxFileForInline.source);

        // ── 路径 D：删除内联属性 ──────────────────────────────────────────────
        if (hasInlineDeletions && styleInfo !== null) {
          const removeResult = removeFromInlineStyleAttr(
            jsxPrevSource,
            styleInfo as Record<string, StyleInfoEntry>,
            inlineDeletions,
          );
          if (removeResult) {
            const { newSource: jsxNewSource, newStyleInfo } = removeResult;
            updateStyleFileInBranch({
              path: jsxPathForInline,
              current: jsxNewSource,
              previous: jsxPrevSource,
              ele,
              callback: () => { previousLess = null; },
            });
            if (ele) {
              // newStyleInfo 为 null 表示 style 属性已被完全移除
              (ele as HTMLElement).dataset.styleInfo = newStyleInfo ? JSON.stringify(newStyleInfo) : '';
            }
          }
          return;
        }

        if (styleInfo === null) {
          // ── 路径 A：span 尚无 style 属性，直接注入 style={{ ... }} ────────────
          // 若 element.style.cssText 非空，说明已有来自变量（如 style={someVar}）的内联样式，
          // Babel 无法为变量生成 data-style-info，不能安全注入（会产生重复 style 属性），直接跳过。
          if ((ele as HTMLElement | null)?.style?.cssText) return;
          const locRaw = (ele as HTMLElement | null)?.dataset?.loc;
          if (!locRaw) return;
          let tagEnd: number | undefined;
          try { tagEnd = JSON.parse(locRaw)?.tag?.end; } catch { return; }
          if (tagEnd == null) return;

          const injectResult = injectStyleAttrIntoJSX(jsxPrevSource, tagEnd, propsToWrite);
          if (!injectResult) return;

          const { newSource: jsxNewSource, styleInfo: injectedStyleInfo } = injectResult;
          updateStyleFileInBranch({
            path: jsxPathForInline,
            current: jsxNewSource,
            previous: jsxPrevSource,
            ele,
            callback: () => { previousLess = null; },
          });
          if (ele) {
            (ele as HTMLElement).dataset.styleInfo = JSON.stringify(injectedStyleInfo);
          }
        } else {
          // ── 路径 B：span 已有 style={}，把新属性追加到已有 }} 之前 ──────────
          const appendResult = appendToInlineStyleAttr(jsxPrevSource, styleInfo as Record<string, StyleInfoEntry>, propsToWrite);
          if (!appendResult) return;

          const { newSource: jsxNewSource, styleInfoUpdates } = appendResult;
          updateStyleFileInBranch({
            path: jsxPathForInline,
            current: jsxNewSource,
            previous: jsxPrevSource,
            ele,
            callback: () => { previousLess = null; },
          });
          // 把新属性的偏移合并进 DOM 上的 data-style-info
          if (ele) {
            const mergedStyleInfo = { ...styleInfo, ...styleInfoUpdates };
            (ele as HTMLElement).dataset.styleInfo = JSON.stringify(mergedStyleInfo);
          }
        }
        return;
      }
      // ─────────────────────────────────────────────────────────────

      // 嵌套伪类写入前：检测是否存在更高特指度的外部规则（如 antd hover），
      // 若有竞争则给 lessValue 中对应属性追加 !important，确保写入值能生效。
      const _pseudoTailM = fullSelector.match(PSEUDO_TAIL_RE);
      if (_pseudoTailM && ele) {
        const _segs = fullSelector.trim().split(/\s+/).filter(Boolean);
        // 取最后一段（如 '.addBtn:hover'）作为 targetKey，特指度与组件自身规则对齐
        const _pseudoTargetKey = _segs[_segs.length - 1];
        const _cssomOverriddenForPseudo = collectCSSOMOverriddenProps(ele as Element, _pseudoTargetKey);
        if (_cssomOverriddenForPseudo.size > 0) {
          Object.keys(lessValue).forEach(key => {
            const hyphenKey = convertCamelToHyphen(key);
            if (
              _cssomOverriddenForPseudo.has(hyphenKey) &&
              lessValue[key] !== null &&
              lessValue[key] !== undefined &&
              !String(lessValue[key]).includes('!important')
            ) {
              lessValue[key] = String(lessValue[key]) + ' !important';
            }
          });
        }
      }

      // 嵌套伪类快速路径：直接写入 &:disabled 等嵌套位置，保留 Less 原有结构
      if (tryWriteNestedPseudo(cssObj, fullSelector, lessValue, deletions)) {
        const cssStr = stringifyLess(cssObj);
        updateStyleFileInBranch({
          path: lessPath,
          current: cssStr,
          previous: previousLess ?? '',
          ele,
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
      const eleTagName = ele ? (ele as HTMLElement).tagName : '';

      // 扫描 CSSOM（shadow DOM）中匹配 ele 且特指度高于 targetKey 的竞争规则（如 antd 复合类）。
      // 每次写入动作扫描一次，供下方 forEach 使用，避免重复扫描。
      const cssomOverriddenProps: Set<string> = ele
        ? collectCSSOMOverriddenProps(ele as Element, targetKey)
        : new Set();

      Object.entries(lessValue).forEach(([key, val]) => {
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

        // 检测到以下任一竞争场景时，自动追加 !important 确保写入值生效：
        // 1. cssObj 内部规则：th/td 等标签选择器组合（如 .tableHeadRow th > .colTag）
        // 2. 外部样式表规则：antd 复合类选择器（如 .css-xxx.ant-btn-variant-solid > .headerStockInBtn）
        let writeVal = val;
        const hyphenKey = convertCamelToHyphen(key);
        const hasInternalConflict = eleTagName && hasTagBasedCompetingRule(cssObj, targetKey, eleTagName, key);
        const hasExternalConflict = cssomOverriddenProps.has(hyphenKey);
        if (
          writeVal !== null &&
          writeVal !== undefined &&
          !String(writeVal).includes('!important') &&
          (hasInternalConflict || hasExternalConflict)
        ) {
          writeVal = String(writeVal) + ' !important';
        }

        cssObj[targetKey][key] = writeVal;
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
        // 若被删除的属性在 data-style-info 里有静态内联偏移（如手写 style={{}} 的属性），
        // 需同步从 JSX inline style 中移除，否则 Less 侧删了但内联覆盖依然生效
        if (styleInfo !== null) {
          const inlineDelsForClass = deletions.filter(
            (key: string) => (styleInfo as any)[key]?.kind === 'static',
          );
          if (inlineDelsForClass.length > 0) {
            const jsxPathForDel = cn.files?.jsx as string | undefined;
            const jsxFileForDel = jsxPathForDel
              ? aiComParams.data.files?.find(
                  (f: { fileName: string; source: string }) => f.fileName === jsxPathForDel,
                )
              : undefined;
            if (jsxFileForDel && jsxPathForDel) {
              const jsxPrevForDel = decodeURIComponent(jsxFileForDel.source);
              const removeResult = removeFromInlineStyleAttr(
                jsxPrevForDel,
                styleInfo as Record<string, StyleInfoEntry>,
                inlineDelsForClass,
              );
              if (removeResult) {
                const { newSource: jsxNewSrc, newStyleInfo } = removeResult;
                updateStyleFileInBranch({
                  path: jsxPathForDel,
                  current: jsxNewSrc,
                  previous: jsxPrevForDel,
                  ele,
                  callback: () => { previousLess = null; },
                });
                if (ele) {
                  (ele as HTMLElement).dataset.styleInfo = newStyleInfo ? JSON.stringify(newStyleInfo) : '';
                }
              }
            }
          }
        }
        const expandedDeletions = filterExpandedDeletions(deletions, value);
        expandedDeletions.forEach(key => {
          delete cssObj[targetKey][key];
          delete cssObj[targetKey][kebabToCamelProp(key)];
          delete cssObj[targetKey][camelToKebab(key)];
        });

        // ── 逗号合并规则拆分删除 ──────────────────────────────────────────────
        // 例：.resetBtn, .queryBtn { min-width: 80px } 与更长路径的 .queryBtn 规则并存时，
        // resolveTargetKey 会命中长路径，delete 落不到逗号块。这里拆分后只删当前分支。
        deleteFromCommaMergedTopLevelRules(cssObj, fullSelector, expandedDeletions);

        // ── 短后缀选择器补充删除 ──────────────────────────────────────────────
        // 例：长路径 .contentArea ... .resetBtn 与短规则 .resetBtn { min-width } 并存时，
        // targetKey 是长路径，需同步删掉短规则上的同名属性。
        deleteFromShorterMatchingRules(cssObj, fullSelector, targetKey, expandedDeletions);

        // ── 补充删除：扫描所有适用于当前元素但被遗漏的规则 ──────────────────────
        // parseLess 直接解析 Less AST、保留嵌套结构（不经 less.render() 扁平化），
        // 因此 `.radioCard { &.checked { box-shadow } }` 在 cssObj 中的形态为：
        //   cssObj['.radioCard']['&.checked'] = { boxShadow: '...' }
        // 而非顶层的 cssObj['.radioCard.checked']。
        // resolveTargetKey 只扫描顶层 key，嵌套的 &.className 规则会被完全遗漏。
        // 注意：CSS Modules 编译后 eleClassList 中的类名形如 "pages_xxx--originalClass"，
        // 而 Less 里写的是原始短名（如 "radioCard"），需要兼容两种形态做匹配。
        if (eleClassList.length > 0) {
          const eleClassListFiltered = eleClassList.filter(c => c && c !== 'undefined');
          // 兼容 CSS Modules 哈希：同时支持精确匹配和 "--originalClass" 后缀匹配
          const elementHasClass = (cls: string): boolean =>
            eleClassListFiltered.some(c => c === cls || c.endsWith('--' + cls));

          Object.keys(cssObj).forEach(parentKey => {
            if (parentKey === targetKey) return;
            if (parentKey.includes(' ')) return; // 只处理无空格的父级选择器

            // 确认元素拥有父级选择器的全部类（兼容 CSS Modules 哈希类名）
            const parentClasses = (parentKey.match(/\.([^.#[:]+)/g) ?? []).map(c => c.slice(1));
            if (parentClasses.length === 0 || !parentClasses.every(elementHasClass)) return;

            const parentValue = cssObj[parentKey];
            if (!parentValue || typeof parentValue !== 'object') return;

            // 1. 处理 parseLess 保留的嵌套 &.className 规则
            //    例：.radioCard { &.checked { box-shadow: ... } }
            //    → cssObj['.radioCard']['&.checked'] = { boxShadow: '...' }
            Object.keys(parentValue).forEach(nestedKey => {
              if (!nestedKey.startsWith('&')) return;
              if (typeof parentValue[nestedKey] !== 'object') return;
              const nestedSuffix = nestedKey.slice(1); // "&.checked" → ".checked"
              if (!nestedSuffix.startsWith('.')) return; // 只处理 &.class，跳过 &:pseudo
              const nestedClasses = (nestedSuffix.match(/\.([^.#[:]+)/g) ?? []).map(c => c.slice(1));
              if (nestedClasses.length === 0 || !nestedClasses.every(elementHasClass)) return;
              expandedDeletions.forEach(k => { delete parentValue[nestedKey][k]; });
              if (Object.keys(parentValue[nestedKey]).length === 0) {
                delete parentValue[nestedKey];
              }
            });

            // 2. 处理顶层的复合类选择器（无空格、多类，如 .radioCard.checked）
            //    resolveTargetKey 通过 endsWith(' .checked') 匹配到后代选择器后，
            //    不含空格的复合选择器会被跳过。
            if (parentClasses.length >= 2) {
              expandedDeletions.forEach(k => { delete cssObj[parentKey][k]; });
              if (Object.keys(cssObj[parentKey] || {}).length === 0) {
                delete cssObj[parentKey];
              }
            }
          });
        }
      }

      if (Object.keys(cssObj[targetKey] || {}).length === 0) {
        // 这段代码会强制转为baseselector，导致误删selector尾部的:hover等伪类
        // const orphanKeys = findOrphanKeys(cssObj, targetKey);
        // orphanKeys.forEach(key => delete cssObj[key]);
        delete cssObj[targetKey];
      }

      const cssStr = stringifyLess(cssObj);
      console.log('cssStr', cssStr)
      console.log('lessPath', lessPath)
      updateStyleFileInBranch({
        path: lessPath,
        current: cssStr,
        previous: previousLess ?? '',
        ele,
        callback: () => {
          previousLess = null
        }
      });
    },
    previewBatch(params: any, value: any) {
      const deletions: string[] = ((window as any).__mybricks_style_deletions || []).slice();
      const hasDataZoneSelector = !!(params.focusArea?.ele as HTMLElement | null)?.dataset?.zoneSelector;
      const isAIOnlyNode = !!params.focusArea?.ele && !hasDataZoneSelector;
      batchEnabled = isAIOnlyNode;
      syncBatchBridge();
      if (!isAIOnlyNode) {
        return this.set(params, value);
      }
      upsertBatchSnapshot(params, value || {}, deletions);
    },
    commitBatch() {
      sendBatchAIRequest();
    },
    discardBatch() {
      clearBatchState();
    },
    getBatchMeta() {
      return {
        enabled: batchEnabled,
        dirtyCount: getDirtyCount(),
        submitting: batchSubmitting,
      };
    },
  };
}

let _imgAppliedCallback: ((src: string) => void) | null = null;

/** ImgPreview 组件注册回调，替换成功后立即更新预览 */
export function registerImgAppliedCallback(cb: ((src: string) => void) | null): void {
  _imgAppliedCallback = cb;
}

export function genImgSrcReplacer() {
  return {
    get(params: any) {
      const ele = params.focusArea?.ele ?? params.focusArea;
      return ele?.getAttribute?.('src') ?? '';
    },
    set(params: any) {
      const ele = (params.focusArea?.ele ?? params.focusArea) as HTMLElement | undefined;
      if (!ele) return;

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

        if (!newSrc) return;

        const locRaw = ele.dataset?.loc;
        let loc: any;
        try {
          loc = locRaw ? JSON.parse(locRaw) : undefined;
        } catch (_) {
          loc = undefined;
        }

        const jsxPath = loc?.files?.jsx;
        const jsxFile = jsxPath
          ? context.component?.params?.data?.files?.find(
              (f: { fileName: string; source: string }) => f.fileName === jsxPath
            )
          : undefined;
        const source = jsxFile ? decodeURIComponent(jsxFile.source) : '';
        const start = loc?.jsx?.start;
        const end = loc?.jsx?.end;
        const snippet =
          typeof start === 'number' && typeof end === 'number' && start >= 0 && end > start && end <= source.length
            ? source.slice(start, end)
            : '';
        const hasRepeatedLoc = !!locRaw && Array.from(getShadowDoc().querySelectorAll<HTMLElement>('[data-loc]'))
          .filter((item) => item.dataset.loc === locRaw)
          .length > 1;
        const previousSrc = ele.getAttribute('src');
        const previousPreviewSrc = previousSrc || (ele as HTMLImageElement).currentSrc || (ele as HTMLImageElement).src || '';
        const label = getElementLabel(ele, '图片');
        const actionId = randomUUID();
        const title = `修改 ${label} 图片`;

        const applyPreview = (src: string | null) => {
          if (src === null) {
            ele.removeAttribute('src');
          } else {
            ele.setAttribute('src', src);
          }
          _imgAppliedCallback?.(src ?? previousPreviewSrc);
        };

        if (jsxPath && jsxFile && STATIC_SRC_RE.test(snippet) && !hasRepeatedLoc) {
          const newSnippet = snippet.replace(STATIC_SRC_RE, `src="${newSrc}"`);
          const newSource = source.slice(0, start) + newSnippet + source.slice(end);

          undoRedoManager.executeBranch({
            execute() {
              context.updateFile({ fileName: jsxPath, content: newSource, type: undefined, noUpdateFileSystem: true });
              applyPreview(newSrc);
              context.component?.actions.addUserAction({
                id: actionId,
                type: 'update-image',
                title,
                refElement: ele,
              });
            },
            undo() {
              context.updateFile({ fileName: jsxPath, content: source, type: undefined, noUpdateFileSystem: true });
              applyPreview(previousSrc);
              context.component?.actions.removeUserAction(actionId);
            },
          });
        } else {
          const chip = {
            id: randomUUID(),
            type: 'element-image-update',
            label: title,
            data: buildElementImageUpdateChipData(ele, newSrc, label),
          };
          undoRedoManager.executeBranch({
            aiRequest: {
              message: `[[chip:${chip.id}]]`,
              chips: [chip],
            },
            execute() {
              applyPreview(newSrc);
              context.component?.actions.addUserAction({
                id: actionId,
                type: 'update-image',
                title,
                refElement: ele,
              });
            },
            undo() {
              applyPreview(previousSrc);
              context.component?.actions.removeUserAction(actionId);
            },
          });
        }
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
  allowIconComponent = false,
): { start: number; end: number } | null {
  if (allowIconComponent) {
    // 仅替换路径允许 data-loc 指向三方图标组件（如 <Icon />）。
    const componentRange = findActualIconTagRange(source, hintStart);
    if (componentRange) {
      const componentSource = source.slice(componentRange.start, componentRange.end);
      if (/^<[A-Z][A-Za-z0-9.]*(?:\s|\/?>)/.test(componentSource)) {
        return componentRange;
      }
    }
  }

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
  const ele = getFocusAreaEle(params)
  if (!ele) return

  let loc: any
  const locRaw = ele.dataset.loc
  try {
    loc = locRaw ? JSON.parse(locRaw) : undefined
  } catch (_) {
    loc = undefined
  }

  const jsxPath = loc?.files?.jsx
  const comId = params.id
  const jsxFile = jsxPath
    ? context.component?.params?.data?.files?.find(
        (file: { fileName: string; source: string }) => file.fileName === jsxPath
      )
    : undefined
  const source = jsxFile ? decodeURIComponent(jsxFile.source) : ''

  // 若本次目标与上次一致（同 comId + jsxPath + dataLocStart），
  // 且上次记录的位置处确实还是 <svg，则直接用精确记录的 range，
  // 避免 data-loc 因源码长度变化失效导致截断位置出错。
  let hintStart = loc?.jsx?.start
  let hintEnd = typeof loc?.jsx?.end === 'number' ? loc.jsx.end : hintStart
  if (
    typeof hintStart === 'number' &&
    _lastSvgState &&
    _lastSvgState.comId === comId &&
    _lastSvgState.jsxPath === jsxPath &&
    _lastSvgState.dataLocStart === loc.jsx?.start &&
    source.slice(_lastSvgState.start, _lastSvgState.start + 4) === '<svg'
  ) {
    hintStart = _lastSvgState.start;
    hintEnd = _lastSvgState.end;
  }

  const range = typeof hintStart === 'number' && hintStart >= 0
    ? findActualSvgRange(source, hintStart, hintEnd as number, true)
    : null
  const candidate = range ? source.slice(range.start, range.end) : ''
  const isSvg = candidate.startsWith('<svg') && candidate.trimEnd().endsWith('</svg>')
  const isIconComponent = /^<[A-Z][A-Za-z0-9.]*(?:\s|\/?>)/.test(candidate)
  const hasRepeatedLoc = !!locRaw && Array.from(getShadowDoc().querySelectorAll<HTMLElement>('[data-loc]'))
    .filter((item) => item.dataset.loc === locRaw)
    .length > 1

  // 原 SVG 替换时保持尺寸；组件图标没有可复用的 SVG 宽高属性。
  const sizeOverride: { width?: string; height?: string } = {};
  if (isSvg) {
    const widthMatch = candidate.match(/\bwidth="([^"]+)"/);
    const heightMatch = candidate.match(/\bheight="([^"]+)"/);
    if (widthMatch) sizeOverride.width = widthMatch[1];
    if (heightMatch) sizeOverride.height = heightMatch[1];
  }

  const jsxSvg = svgToJsx(rawSvg, sizeOverride)
  const label = getElementLabel(ele, 'SVG')
  const title = `修改 ${label} SVG`
  const actionId = randomUUID()

  // 保持 SVG 节点身份和平台注入的 data-* 定位属性，避免分支预览破坏后续编辑定位。
  const currentSvg = ele instanceof SVGElement ? ele : ele.querySelector('svg')
  const previousSvg = currentSvg?.cloneNode(true) as SVGElement | undefined
  const parser = new DOMParser()
  const nextSvg = parser.parseFromString(rawSvg, 'image/svg+xml').documentElement
  const applyPreview = (svg: SVGElement | undefined) => {
    if (!svg || !currentSvg) return
    const importedSvg = document.importNode(svg, true) as SVGElement
    const dataAttrs = Array.from(currentSvg.attributes)
      .filter((attr) => attr.name.startsWith('data-'))
      .map((attr) => [attr.name, attr.value] as const)
    Array.from(currentSvg.attributes).forEach((attr) => currentSvg.removeAttribute(attr.name))
    Array.from(importedSvg.attributes).forEach((attr) => currentSvg.setAttribute(attr.name, attr.value))
    dataAttrs.forEach(([name, value]) => currentSvg.setAttribute(name, value))
    currentSvg.replaceChildren(...Array.from(importedSvg.childNodes))
  }

  if (jsxPath && jsxFile && range && !hasRepeatedLoc && (isSvg || isIconComponent)) {
    const newSource = source.slice(0, range.start) + jsxSvg + source.slice(range.end)
    const nextSvgState = {
      comId,
      jsxPath,
      dataLocStart: loc?.jsx?.start,
      start: range.start,
      end: range.start + jsxSvg.length,
    }

    undoRedoManager.executeBranch({
      execute() {
        context.updateFile({ fileName: jsxPath, content: newSource, type: undefined, noUpdateFileSystem: true })
        _lastSvgState = nextSvgState
        applyPreview(nextSvg instanceof SVGElement ? nextSvg : undefined)
        _svgAppliedCallback?.(rawSvg)
        context.component?.actions.addUserAction({
          id: actionId,
          type: 'update-svg',
          title,
          refElement: ele,
        })
      },
      undo() {
        context.updateFile({ fileName: jsxPath, content: source, type: undefined, noUpdateFileSystem: true })
        if (_lastSvgState === nextSvgState) _lastSvgState = null
        applyPreview(previousSvg)
        context.component?.actions.removeUserAction(actionId)
      },
    })
    return
  }

  const chip = {
    id: randomUUID(),
    type: 'element-svg-update',
    label: title,
    data: buildElementSvgUpdateChipData(ele, jsxSvg, label),
  }

  undoRedoManager.executeBranch({
    aiRequest: {
      message: `[[chip:${chip.id}]]`,
      chips: [chip],
    },
    execute() {
      applyPreview(nextSvg instanceof SVGElement ? nextSvg : undefined)
      _svgAppliedCallback?.(rawSvg)
      context.component?.actions.addUserAction({
        id: actionId,
        type: 'update-svg',
        title,
        refElement: ele,
      })
    },
    undo() {
      applyPreview(previousSvg)
      context.component?.actions.removeUserAction(actionId)
    },
  })
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
      console.log("设置：svg")
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
  const ele = getFocusAreaEle(params)
  if (!ele) return

  let loc: any
  const locRaw = ele.dataset.loc
  try {
    loc = locRaw ? JSON.parse(locRaw) : undefined
  } catch (_) {
    loc = undefined
  }

  const jsxPath = loc?.files?.jsx
  const jsxFile = jsxPath
    ? context.component?.params?.data?.files?.find(
        (file: { fileName: string; source: string }) => file.fileName === jsxPath
      )
    : undefined
  const source = jsxFile ? decodeURIComponent(jsxFile.source) : ''
  const hintStart = loc?.jsx?.start
  const range = typeof hintStart === 'number' && hintStart >= 0
    ? findActualIconTagRange(source, hintStart)
    : null
  const hasRepeatedLoc = !!locRaw && Array.from(getShadowDoc().querySelectorAll<HTMLElement>('[data-loc]'))
    .filter((item) => item.dataset.loc === locRaw)
    .length > 1
  const jsxSvg = svgToJsx(rawSvg, {})
  const label = getElementLabel(ele, '图标')
  const title = `修改 ${label} SVG`
  const actionId = randomUUID()

  // 分支编辑不会触发完整重渲染，直接替换画布中可见的 SVG 以提供即时反馈。
  const currentSvg = ele instanceof SVGElement ? ele : ele.querySelector('svg')
  const previousSvg = currentSvg?.cloneNode(true) as SVGElement | undefined
  const parser = new DOMParser()
  const nextSvg = parser.parseFromString(rawSvg, 'image/svg+xml').documentElement
  let displayedSvg = currentSvg
  const applyPreview = (svg: SVGElement | undefined) => {
    if (!svg || !displayedSvg?.parentNode) return
    const importedSvg = document.importNode(svg, true) as SVGElement
    displayedSvg.parentNode.replaceChild(importedSvg, displayedSvg)
    displayedSvg = importedSvg
  }

  if (jsxPath && jsxFile && range && !hasRepeatedLoc && source.slice(range.start, range.end).startsWith('<')) {
    const newSource = source.slice(0, range.start) + jsxSvg + source.slice(range.end)

    undoRedoManager.executeBranch({
      execute() {
        context.updateFile({ fileName: jsxPath, content: newSource, type: undefined, noUpdateFileSystem: true })
        applyPreview(nextSvg instanceof SVGElement ? nextSvg : undefined)
        _svgAppliedCallback?.(rawSvg)
        context.component?.actions.addUserAction({
          id: actionId,
          type: 'update-svg',
          title,
          refElement: ele,
        })
      },
      undo() {
        context.updateFile({ fileName: jsxPath, content: source, type: undefined, noUpdateFileSystem: true })
        applyPreview(previousSvg)
        context.component?.actions.removeUserAction(actionId)
      },
    })
    return
  }

  const chip = {
    id: randomUUID(),
    type: 'element-svg-update',
    label: title,
    data: buildElementSvgUpdateChipData(ele, jsxSvg, label),
  }

  undoRedoManager.executeBranch({
    aiRequest: {
      message: `[[chip:${chip.id}]]`,
      chips: [chip],
    },
    execute() {
      applyPreview(nextSvg instanceof SVGElement ? nextSvg : undefined)
      context.component?.actions.addUserAction({
        id: actionId,
        type: 'update-svg',
        title,
        refElement: ele,
      })
    },
    undo() {
      applyPreview(previousSvg)
      context.component?.actions.removeUserAction(actionId)
    },
  })
}

/** 触发文件选择框，用户上传 SVG 后替换第三方图标组件 */
export function genIconReplacer() {
  return {
    set(params: any) {
      console.log("设置：icon")
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
    const size = parseFloat(fontSizeMatch[1]);
    if (size > 0) return { w: size, h: size };
  }

  // 非方形：读 width / height
  const widthMatch = snippet.match(/\bwidth\s*:\s*(\d+(?:\.\d+)?)/);
  const heightMatch = snippet.match(/\bheight\s*:\s*(\d+(?:\.\d+)?)/);
  const w = widthMatch ? parseFloat(widthMatch[1]) : 0;
  const h = heightMatch ? parseFloat(heightMatch[1]) : 0;
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

/**
 * 将任意聚焦元素替换为上传的图片（<img>）或 SVG 内联图标，通过 AI 完成替换。
 * SVG 分支：读取文件内容后交给 AI 生成替换代码。
 * 图片分支：先上传获取 URL，再交给 AI 生成替换代码。
 */
export function genElementReplacer() {
  return {
    set(params: any) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.svg,image/svg+xml';
      input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const plugins = context.plugins as any;
        const isSvg =
          file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');

        if (isSvg) {
          const rawSvg = await file.text();
          plugins?.showAIDialog?.();
          plugins?.aiService?.request({
            message: `将当前聚焦的元素替换为 svg 图标，SVG 内容如下：\n${rawSvg}`,
            mentionFocus: true,
            attachments: [],
          });
          return;
        }

        // 图片路径：先上传获取 URL，再让 AI 替换
        const uploadFn = params.env?.uploadFile;
        let url: string;
        if (typeof uploadFn === 'function') {
          const res = await uploadFn([file]);
          url = res?.url ?? '';
        } else {
          url = await new Promise<string>(resolve => {
            const fr = new FileReader();
            fr.readAsDataURL(file);
            fr.onload = ev =>
              resolve((ev.currentTarget as FileReader).result as string);
          });
        }

        if (!url) return;

        plugins?.showAIDialog?.();
        plugins?.aiService?.request({
          message: `将当前聚焦的元素替换为 img 标签，图片地址：${url}`,
          mentionFocus: true,
          attachments: [{ url }],
        });
      };
      input.click();
    },
  };
}
