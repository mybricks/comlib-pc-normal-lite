import context from '../../context';
import { parseLess, stringifyLess } from '../../utils/transform/less';
import { convertHyphenToCamel } from '../../../utils/string';
import type { FigmaImportItem } from '../types';
const MB_TAG_RE = /\[mb:([^\]]+)\]/i;

// ─── 非 flex DOM CSS 升级辅助 ─────────────────────────────────────────────────

/**
 * 在实时参考快照的所有文件中查找 selector 对应的属性 block。
 * 多文件编码格式：.filePrefix-className → 直接用 .className 查参考快照。
 */
function findLiveBaselineProps(
  selector: string,
  liveBaseline: FigmaSyncLiveBaseline | null
): Record<string, string> | null {
  if (!liveBaseline) return null;
  // 多文件编码格式：.filePrefix-className → 直接用 .className 查实时参考快照
  let effectiveSel = selector;
  if (selector.startsWith('.')) {
    const inner = selector.slice(1);
    const dashIdx = inner.indexOf('-');
    if (dashIdx > 0) effectiveSel = '.' + inner.substring(dashIdx + 1);
  }
  for (const fileName of Object.keys(liveBaseline)) {
    if (fileName === '_domComputed') continue;
    const fileObj = (liveBaseline as Record<string, Record<string, Record<string, string>>>)[fileName];
    if (!fileObj) continue;
    const key = Object.keys(fileObj).find(
      (k) => k === effectiveSel || k.endsWith(' ' + effectiveSel)
    );
    if (key && fileObj[key]) return fileObj[key];
  }
  return null;
}

function isFlexInLiveBaseline(selector: string, liveBaseline: FigmaSyncLiveBaseline | null): boolean {
  const props = findLiveBaselineProps(selector, liveBaseline);
  if (!props) return false;
  const d = props['display'];
  if (d === 'flex' || d === 'inline-flex') return true;
  if (props['flexDirection'] || props['flex-direction']) return true;
  return false;
}

function isGridInLiveBaseline(selector: string, liveBaseline: FigmaSyncLiveBaseline | null): boolean {
  const props = findLiveBaselineProps(selector, liveBaseline);
  if (!props) return false;
  const d = props['display'];
  return d === 'grid' || d === 'inline-grid';
}

function isAbsoluteInLiveBaseline(
  selector: string,
  liveBaseline: FigmaSyncLiveBaseline | null
): boolean {
  const props = findLiveBaselineProps(selector, liveBaseline);
  if (!props) return false;
  return props['position'] === 'absolute';
}

/** camelCase margin key → CSS hyphen key */
const MARGIN_CAMEL_TO_HYPHEN: Record<string, string> = {
  margin: 'margin',
  marginTop: 'margin-top',
  marginRight: 'margin-right',
  marginBottom: 'margin-bottom',
  marginLeft: 'margin-left',
};

/**
 * 找出该 selector 在实时参考快照中有实际值（非 0、非 var()）的 margin 属性，
 * 返回 CSS hyphen 格式（如 'margin-bottom'）。
 */
function findMarginKeysInLiveBaseline(
  selector: string,
  liveBaseline: FigmaSyncLiveBaseline | null
): string[] {
  const props = findLiveBaselineProps(selector, liveBaseline);
  if (!props) return [];
  const result: string[] = [];
  for (const camel of Object.keys(MARGIN_CAMEL_TO_HYPHEN)) {
    const val = props[camel];
    if (!val) continue;
    if (val === '0' || val === '0px') continue;
    if (val.includes('var(')) continue; // 保留 CSS 变量，不强制清零
    result.push(MARGIN_CAMEL_TO_HYPHEN[camel]);
  }
  return result;
}

type DimensionAxis = 'width' | 'height';

function hasExplicitDimensionInLiveBaseline(
  selector: string,
  axis: DimensionAxis,
  liveBaseline: FigmaSyncLiveBaseline | null
): boolean {
  const props = findLiveBaselineProps(selector, liveBaseline);
  if (!props) return false;
  const raw = props[axis];
  if (raw == null) return false;
  const value = String(raw).trim();
  if (!value) return false;
  // auto/initial/inherit/unset 不是显式固定尺寸意图
  if (value === 'auto' || value === 'initial' || value === 'inherit' || value === 'unset') return false;
  return true;
}

function parsePositiveNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const n = Number.parseFloat(value.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseFlexGrowFromShorthand(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  if (v === 'none') return 0;
  if (v === 'auto') return 1;
  const first = v.split(/\s+/)[0];
  return parsePositiveNumber(first);
}

function isElasticItemInLiveBaseline(
  selector: string,
  _axis: DimensionAxis,
  liveBaseline: FigmaSyncLiveBaseline | null
): boolean {
  const props = findLiveBaselineProps(selector, liveBaseline);
  if (!props) return false;
  const growVal = props['flexGrow'] ?? props['flex-grow'];
  if (parsePositiveNumber(growVal) != null) return true;
  const flexVal = props['flex'];
  const growFromFlex = parseFlexGrowFromShorthand(flexVal);
  if (growFromFlex != null && growFromFlex > 0) return true;
  return false;
}

function shouldApplyDimension(options: {
  selector: string;
  cssKey: string;
  figmaValue: string;
  item: FigmaImportItem;
  liveBaseline: FigmaSyncLiveBaseline | null;
}): boolean {
  const { selector, cssKey, figmaValue, item, liveBaseline } = options;
  if (cssKey !== 'width' && cssKey !== 'height') return true;
  const axis: DimensionAxis = cssKey;

  // 实时参考快照显示是弹性项（如 flex:1 / flex-grow>0）时，不回写尺寸，避免把分配结果固化为像素。
  if (isElasticItemInLiveBaseline(selector, axis, liveBaseline)) return false;

  const dimensionMeta = item.meta?.dimension;
  const sizingMode = axis === 'width'
    ? dimensionMeta?.sizingHorizontal
    : dimensionMeta?.sizingVertical;

  // Auto Layout 的 FILL 是“由父容器分配空间”，不应固化成 width/height。
  if (dimensionMeta?.hasAutoLayout && sizingMode === 'FILL') return false;

  // 该轴在实时参考快照有显式尺寸声明，则允许回写（代表用户本来就有尺寸意图）。
  if (hasExplicitDimensionInLiveBaseline(selector, axis, liveBaseline)) return true;

  // 实时参考快照无显式声明时，仅保留明确 FIXED + 像素值的尺寸意图。
  if (sizingMode === 'FIXED' && /px$/i.test(figmaValue.trim())) return true;

  return false;
}

/**
 * 对「非 flex DOM 容器在 Figma 中修改了 AutoLayout」的场景：
 * 1. 给父容器追加 display:flex（非 flex/grid 实时参考快照 → CSS 升级）
 * 2. 给子节点 emit margin 清零 items（仅清实时参考快照中有实际值的 margin 属性）
 *
 * 依赖 FigmaImportItem.childSelectors（由 to-import-items.ts 填充）。
 */
function expandNonFlexUpgradeItems(
  items: FigmaImportItem[],
  liveBaseline: FigmaSyncLiveBaseline | null
): FigmaImportItem[] {
  // 构建 selector→items 反查 Map（支持同 selector 多 item，merge 时写入所有）
  const selectorToItems = new Map<string, FigmaImportItem[]>();
  for (const item of items) {
    const sel = item.selectors[0];
    if (sel) {
      if (!selectorToItems.has(sel)) selectorToItems.set(sel, []);
      selectorToItems.get(sel)!.push(item);
    }
  }

  // 父容器 display:flex 追加仍用单条（selector 唯一），保留兼容
  const selectorToItem = new Map<string, FigmaImportItem>();
  for (const [sel, arr] of selectorToItems) selectorToItem.set(sel, arr[arr.length - 1]);

  const additionalItems: FigmaImportItem[] = [];

  for (const item of items) {
    if (!item.childSelectors?.length) continue;   // 无子节点信息，跳过
    if (!item.value['flex-direction']) continue;  // 无 stackMode，跳过

    const parentSelector = item.selectors[0];
    if (!parentSelector) continue;

    // 已是 flex 或 grid → 跳过（方案 D 实时 diff 已处理）
    if (isFlexInLiveBaseline(parentSelector, liveBaseline)) continue;
    if (isGridInLiveBaseline(parentSelector, liveBaseline)) continue;

    // 非 flex 容器：在已有 item 的 value 里追加 display:flex，若无则新建
    let parentItem = selectorToItem.get(parentSelector);
    if (parentItem) {
      parentItem.value['display'] = 'flex';
    } else {
      parentItem = { selectors: [parentSelector], value: { 'display': 'flex' } };
      selectorToItem.set(parentSelector, parentItem);
      additionalItems.push(parentItem);
    }

    // 遍历直接子节点，emit margin 清零
    for (const childSelector of item.childSelectors) {
      if (isAbsoluteInLiveBaseline(childSelector, liveBaseline)) continue;

      const marginKeys = findMarginKeysInLiveBaseline(childSelector, liveBaseline);
      if (!marginKeys.length) continue;

      const clearValue: Record<string, string> = {};
      for (const prop of marginKeys) clearValue[prop] = '0';

      // 合并到所有同 selector 的 item，避免 pickBestCandidate 选中没有 margin-clear 的那个
      const existingItemsForChild = selectorToItems.get(childSelector);
      if (existingItemsForChild?.length) {
        for (const ei of existingItemsForChild) Object.assign(ei.value, clearValue);
      } else {
        const newItem = { selectors: [childSelector], value: clearValue };
        selectorToItems.set(childSelector, [newItem]);
        additionalItems.push(newItem);
      }
    }
  }

  return [...items, ...additionalItems];
}

/** Context 上未必挂载 addVersion（版本能力由 sandbox 注入时才有） */
function safeAddEditorVersion(comId: string): void {
  const fn = (context as { addVersion?: (id: string, ...args: unknown[]) => void }).addVersion;
  if (typeof fn === 'function') {
    try {
      fn.call(context, comId, 'editor');
    } catch (e) {}
  }
}

function pickPrimaryLessFile(
  files: Array<{ fileName: string; source?: string }>
): { fileName: string; source: string } | null {
  const ordered =
    files.find((f) => f.fileName === 'index.less' && f.source) ||
    files.find((f) => f.fileName === 'style.less' && f.source) ||
    files.find((f) => /\.less$/i.test(f.fileName) && f.source);
  return ordered ? { fileName: ordered.fileName, source: ordered.source! } : null;
}

/** 去掉 Figma 选择器前可能带的组件 ID classname，便于与组件 less 的 key 匹配 */
export function normalizeFigmaSelector(selector: string, comId: string): string {
  if (!comId || !selector.startsWith('.')) return selector;
  const escaped = comId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\.${escaped}(\\.|\\s+)?`);
  return selector.replace(re, (_, suffix) => (suffix === '.' ? '.' : '')).trim();
}

/**
 * 解析多文件格式的 Figma 选择器：`.{encodedFilePath}-{className}`
 * encodedFilePath = fileName.replace(/[^0-9a-zA-Z_]/g, '_')
 * 返回 null 表示是旧格式选择器，走兼容逻辑。
 */
function parseMultiFileSelector(
  rawSelector: string,
  files: Array<{ fileName: string }>
): { fileName: string; cssClass: string } | null {
  if (!rawSelector.startsWith('.')) return null;
  const inner = rawSelector.slice(1);
  const dashIdx = inner.indexOf('-');
  if (dashIdx === -1) return null;

  const prefix = inner.substring(0, dashIdx);
  const className = '.' + inner.substring(dashIdx + 1);

  const matchedFile = files?.find(
    (f) => f.fileName.replace(/[^0-9a-zA-Z_]/g, '_') === prefix
  );
  if (!matchedFile) return null;

  return { fileName: matchedFile.fileName, cssClass: className };
}

/** 多文件同步场景下，antd 等第三方 class 应写入 :global(.ant-*)，便于覆盖组件库样式 */
function isMultiFileScopedAntClass(selector: string): boolean {
  if (/^\.ant-/.test(selector)) return true;
  const bare = bareSelectorInsideGlobalKey(selector);
  return !!(bare && /^\.ant-/.test(bare));
}

function bareSelectorInsideGlobalKey(cssObjKey: string): string | null {
  if (!cssObjKey.startsWith(':global(') || !cssObjKey.endsWith(')')) return null;
  return cssObjKey.slice(':global('.length, -1);
}

function resolveLessMergeCssObjKey(
  cssObj: Record<string, Record<string, unknown>>,
  selector: string,
  useGlobalAntWrapper: boolean
): string {
  if (useGlobalAntWrapper && isMultiFileScopedAntClass(selector)) {
    const bareSelector =
      selector.startsWith('.')
        ? selector
        : (bareSelectorInsideGlobalKey(selector) ?? selector);
    const globalKey = `:global(${bareSelector})`;
    // 简化策略：写入阶段只产出 :global(.ant-*)，不对历史裸 .ant-* 做迁移/清理。
    return globalKey;
  }
  let cssObjKey =
    Object.keys(cssObj).find((key) => key === selector || key.endsWith(' ' + selector)) ?? null;
  if (!cssObjKey || !cssObj[cssObjKey]) {
    // 不在此处提前创建空 block，交给写入时惰性创建
    cssObjKey = selector;
  }
  return cssObjKey;
}

/** 从字符串中优先提取 [mb:...] 里的选择器；没有则回退原值 */
function extractPreferredSelector(rawSelector: string): string {
  if (!rawSelector) return rawSelector;
  const m = rawSelector.match(MB_TAG_RE);
  if (m && m[1]) return m[1].trim();
  return rawSelector.trim();
}

/** 判断是否符合"多文件编码前缀"形态：`.encodedFilePrefix-className` 且 prefix 命中现有文件 */
function looksLikeMultiFileEncodedSelector(
  rawSelector: string,
  encodedFilePrefixes: Set<string>
): boolean {
  if (!rawSelector || !rawSelector.startsWith('.')) return false;
  const inner = rawSelector.slice(1);
  const dashIdx = inner.indexOf('-');
  if (!(dashIdx > 0 && dashIdx < inner.length - 1)) return false;
  const prefix = inner.slice(0, dashIdx);
  return encodedFilePrefixes.has(prefix);
}

/** 与 Figma extractSimpleStyles 同维度的稳定计算属性子集，排除 width/height 等布局噪音 */
const DOM_COMPUTED_STABLE_PROPS = ['backgroundColor', 'color', 'fontSize', 'fontFamily'] as const;

type DomComputedSnapshot = Record<string, Record<string, string>>;

type FigmaSyncLiveBaseline = {
  _domComputed?: DomComputedSnapshot;
  [fileName: string]: Record<string, Record<string, string>> | undefined;
};

function buildLiveBaseline(
  files: Array<{ fileName: string; source?: string }>,
  rootEl?: Element | null
): FigmaSyncLiveBaseline {
  const liveBaseline: FigmaSyncLiveBaseline = {};

  for (const file of files) {
    if (!file.fileName.endsWith('.less') || !file.source) continue;
    try {
      liveBaseline[file.fileName] = parseLess(decodeURIComponent(file.source));
    } catch {}
  }

  if (rootEl) {
    try {
      const domComputed: DomComputedSnapshot = {};
      // 优先穿透 shadowRoot（MyBricks 组件渲染在 shadow DOM 内）
      const rootNode = typeof rootEl.getRootNode === 'function' ? rootEl.getRootNode() : null;
      const shadowHostRoot = rootNode instanceof ShadowRoot ? rootNode : null;
      const queryRoot: Element | ShadowRoot =
        (rootEl as any).shadowRoot || shadowHostRoot || rootEl;

      const antEls = queryRoot.querySelectorAll('[class*="ant-"]');
      const seenSelectors = new Set<string>();
      antEls.forEach((el) => {
        const className = (el as HTMLElement).className;
        if (!className || typeof className !== 'string') return;
        const classes = className.trim().split(/\s+/);
        classes
          .filter((c) => c.startsWith('ant-'))
          .forEach((cls) => {
            const sel = '.' + cls;
            if (seenSelectors.has(sel)) return;
            seenSelectors.add(sel);
            try {
              const cs = window.getComputedStyle(el);
              const snap: Record<string, string> = {};
              DOM_COMPUTED_STABLE_PROPS.forEach((prop) => {
                const raw = (cs as unknown as Record<string, string>)[prop] || '';
                snap[prop] = /color/i.test(prop) ? normalizeColorForCompare(raw) : raw;
              });
              domComputed[sel] = snap;
            } catch {}
          });
      });
      liveBaseline._domComputed = domComputed;
    } catch {}
  }

  return liveBaseline;
}

/** 把 #RRGGBB / #RGB 等 hex 色值统一转为 rgb(r, g, b)，其余原样返回 */
function normalizeColorForCompare(v: string): string {
  if (!v) return v;
  const s = v.trim().toLowerCase();
  const hex6 = s.match(/^#([0-9a-f]{6})$/i);
  if (hex6) {
    const n = parseInt(hex6[1], 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  }
  const hex3 = s.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    const [r, g, b] = hex3[1].split('').map((c) => parseInt(c + c, 16));
    return `rgb(${r}, ${g}, ${b})`;
  }
  const rgbLike = s.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbLike) {
    const parts = rgbLike[1].split(',').map((p) => p.trim());
    if (parts.length >= 3) {
      const r = Math.round(Number(parts[0]));
      const g = Math.round(Number(parts[1]));
      const b = Math.round(Number(parts[2]));
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return s;
      if (parts.length === 3) return `rgb(${r}, ${g}, ${b})`;
      const a = Number(parts[3]);
      if (!Number.isFinite(a)) return s;
      if (a >= 1 - 1e-4) return `rgb(${r}, ${g}, ${b})`;
      return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
    }
  }
  return s;
}

/** 归一化 font-family，去引号、统一大小写与空格。 */
function normalizeFontFamilyForCompare(v: string): string {
  if (!v) return '';
  return v
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      let out = part;
      if (
        (out.startsWith("'") && out.endsWith("'")) ||
        (out.startsWith('"') && out.endsWith('"'))
      ) {
        out = out.slice(1, -1);
      }
      return out.trim().toLowerCase().replace(/\s+/g, ' ');
    })
    .join(',');
}

/**
 * 语义化比较两个 CSS 属性值是否相等：颜色走 normalizeColorForCompare，其余字符串直接比较。
 */
function valuesEqualForSync(
  camelKey: string,
  a: string | undefined,
  b: string | undefined
): boolean {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  if (camelKey === 'fontFamily') {
    const fa = normalizeFontFamilyForCompare(sa);
    const fb = normalizeFontFamilyForCompare(sb);
    if (fa === fb) return true;
    // 容忍 fallback 差异：主字体一致就视为未变更（如 "PingFang SC" vs "'PingFang SC', sans-serif"）。
    const faPrimary = fa.split(',')[0] || '';
    const fbPrimary = fb.split(',')[0] || '';
    return !!faPrimary && faPrimary === fbPrimary;
  }
  const isColor =
    /color/i.test(camelKey) ||
    /^(#|rgb\b|rgba\b)/.test(sa) ||
    /^(#|rgb\b|rgba\b)/.test(sb);
  if (isColor) return normalizeColorForCompare(sa) === normalizeColorForCompare(sb);
  return sa === sb;
}

/** 将 item.value 按 key 排序后序列化，用于去重比较 */
function stableValueSignature(value: Record<string, string>): string {
  const sorted = Object.keys(value)
    .sort()
    .reduce(
      (acc, k) => {
        acc[k] = value[k];
        return acc;
      },
      {} as Record<string, string>
    );
  return JSON.stringify(sorted);
}

interface ResolvedItem {
  item: FigmaImportItem;
  /** 逻辑选择器，如 .ant-table-cell */
  selector: string;
}

/** 从单个 item 中解析出逻辑选择器（不修改 cssObj） */
function resolveLogicSelector(
  item: FigmaImportItem,
  groupFileName: string | null,
  files: Array<{ fileName: string }>,
  comId: string
): string | null {
  const { selectors } = item;
  if (!Array.isArray(selectors) || selectors.length === 0) return null;
  const rawSelector = extractPreferredSelector(selectors[0]);
  if (!rawSelector) return null;

  if (groupFileName === null) {
    return normalizeFigmaSelector(rawSelector, comId) || null;
  }
  const parsed = parseMultiFileSelector(rawSelector, files);
  if (!parsed) {
    return null;
  }
  return parsed.cssClass;
}

/**
 * 多候选择一：按优先级返回「应写入」的那条，null 表示整组跳过。
 *
 * 优先级：
 *   1. liveBaseline._domComputed[selector]  → 与 DOM 快照相比不同的第一条
 *   2. liveBaseline[targetFileName][selector] → 与 Less 快照相比不同的第一条
 *   3. 无法用 1/2 区分时不猜测（不再使用频次启发式），整组跳过并 warn，避免误改无关样式。
 */
function pickBestCandidate(
  group: ResolvedItem[],
  selector: string,
  targetFileName: string,
  liveBaseline: FigmaSyncLiveBaseline | null
): ResolvedItem | null {
  // Priority 1: DOM computed live baseline
  const domSnap = liveBaseline?._domComputed?.[selector];
  if (domSnap) {
    for (const ri of group) {
      const differs = Object.entries(ri.item.value).some(([cssKey, figmaValue]) => {
        const camelKey = convertHyphenToCamel(cssKey);
        const snapVal = domSnap[camelKey];
        if (snapVal === undefined) return false;
        return !valuesEqualForSync(camelKey, figmaValue, snapVal);
      });
      if (differs) return ri;
    }
    return null;
  }

  // Priority 2: Less live baseline for targetFileName
  const liveBaselineFileObj = (liveBaseline as Record<string, Record<string, Record<string, string>>> | null)?.[targetFileName];
  if (liveBaselineFileObj) {
    const liveBaselineSelectorKey = Object.keys(liveBaselineFileObj).find(
      (k) =>
        k === selector ||
        k.endsWith(' ' + selector) ||
        k === `:global(${selector})` ||
        k.endsWith(` :global(${selector})`)
    );
    if (liveBaselineSelectorKey) {
      const liveBaselineSnap = liveBaselineFileObj[liveBaselineSelectorKey];
      for (const ri of group) {
        const differs = Object.entries(ri.item.value).some(([cssKey, figmaValue]) => {
          const camelKey = convertHyphenToCamel(cssKey);
          return !valuesEqualForSync(camelKey, figmaValue, liveBaselineSnap[camelKey]);
        });
        if (differs) return ri;
      }
      return null;
    }
  }

  return null;
}

/** 从 Figma JSON（含 selectors）同步样式到组件各 less 文件，只同步有差异的部分 */
export function syncStylesFromFigmaJson(
  comId: string,
  figmaItems: FigmaImportItem[],
  options?: { rootEl?: Element | null }
): number {
  const aiComParams = context.getAiComParams(comId);
  if (!aiComParams?.data) return 0;
  const files: Array<{ fileName: string; source: string }> = aiComParams.data.files || [];
  // 同步时实时采样当前 less + DOM computed 作为参考快照，不再使用持久化快照
  const liveBaseline = buildLiveBaseline(files, options?.rootEl ?? null);

  // 非 flex DOM 升级：检测有 AutoLayout 但实时参考快照里不是 flex 的容器，追加 display:flex 及子节点 margin 清零
  const hasChildSelectors = figmaItems.some(it => it.childSelectors?.length);
  if (hasChildSelectors) {
    figmaItems = expandNonFlexUpgradeItems(figmaItems, liveBaseline);
  }

  const encodedFilePrefixes = new Set(
    files.map((f) => f.fileName.replace(/[^0-9a-zA-Z_]/g, '_'))
  );

  // 按目标文件名分组；null 表示旧格式，走兼容逻辑
  const fileGroups = new Map<string | null, FigmaImportItem[]>();

  figmaItems.forEach((item) => {
    const { selectors } = item;
    if (!Array.isArray(selectors) || selectors.length === 0) return;
    const rawSelector = extractPreferredSelector(selectors[0]);
    const parsed = parseMultiFileSelector(rawSelector, files);
    // 稳态多文件策略：前缀看起来是编码格式，就必须命中文件，否则明确报错并跳过
    if (!parsed && looksLikeMultiFileEncodedSelector(rawSelector, encodedFilePrefixes)) {
      return;
    }
    const groupKey = parsed ? parsed.fileName : null;
    if (!fileGroups.has(groupKey)) fileGroups.set(groupKey, []);
    fileGroups.get(groupKey)!.push(item);
  });

  let anyChange = false;
  let actualChangedCount = 0;
  const hasExplicitFileGroup = Array.from(fileGroups.keys()).some((k) => k !== null);
  const updateFiles = new Set<string>()

  fileGroups.forEach((items, groupFileName) => {
    // 多文件模式下，跳过 null 回退分组，避免后续覆盖明确分组结果
    if (hasExplicitFileGroup && groupFileName === null) {
      return;
    }
    let sourceContent: string | null = null;
    let targetFileName: string;

    if (groupFileName === null) {
      if (aiComParams.data.styleSource) {
        sourceContent = decodeURIComponent(aiComParams.data.styleSource);
        targetFileName = 'style.less';
      } else {
        const picked = pickPrimaryLessFile(files);
        if (!picked) {
          return;
        }
        sourceContent = decodeURIComponent(picked.source);
        targetFileName = picked.fileName;
      }
    } else {
      const file = files.find((f) => f.fileName === groupFileName);
      if (!file?.source) {
        return;
      }
      sourceContent = decodeURIComponent(file.source);
      targetFileName = groupFileName;
    }

    const cssObj = parseLess(sourceContent);
    let hasChange = false;
    const appliedChanges: Array<{
      selector: string;
      cssKey: string;
      camelKey: string;
      before: unknown;
      after: unknown;
    }> = [];

    // ── Step 1: 解析逻辑选择器（不修改 cssObj）──
    const resolvedItems: ResolvedItem[] = [];
    items.forEach((item) => {
      if (
        !item.value ||
        typeof item.value !== 'object' ||
        Object.keys(item.value).length === 0
      ) return;
      const selector = resolveLogicSelector(item, groupFileName, files, comId);
      if (!selector) return;
      resolvedItems.push({ item, selector });
    });

    // ── Step 2: 按 (selector, valueSignature) 去重 ──
    const seenSigs = new Set<string>();
    const dedupedItems = resolvedItems.filter(({ selector, item }) => {
      const sig = selector + '|' + stableValueSignature(item.value);
      if (seenSigs.has(sig)) return false;
      seenSigs.add(sig);
      return true;
    });

    // ── Step 3: 按逻辑选择器分组 ──
    const selectorGroups = new Map<string, ResolvedItem[]>();
    dedupedItems.forEach((ri) => {
      if (!selectorGroups.has(ri.selector)) selectorGroups.set(ri.selector, []);
      selectorGroups.get(ri.selector)!.push(ri);
    });

    // ── Step 4: 对每组择一并写入 ──
    selectorGroups.forEach((group, selector) => {
      const useGlobal = isMultiFileScopedAntClass(selector);
      const cssObjKey = resolveLessMergeCssObjKey(
        cssObj as Record<string, Record<string, unknown>>,
        selector,
        useGlobal
      );

      const pickedItem =
        group.length === 1
          ? group[0]
          : pickBestCandidate(group, selector, targetFileName, liveBaseline);

      if (!pickedItem) return;

      Object.entries(pickedItem.item.value).forEach(([cssKey, figmaValue]) => {
        if (
          !shouldApplyDimension({
            selector,
            cssKey,
            figmaValue,
            item: pickedItem.item,
            liveBaseline,
          })
        ) {
          return;
        }
        const camelKey = convertHyphenToCamel(cssKey);
        // 惰性读取：block 可能尚未创建（还没写入过），此时 currentValue 视为 undefined
        const existingBlock = cssObj[cssObjKey] as Record<string, unknown> | undefined;
        const currentValue = existingBlock?.[camelKey];

        const liveBaselineFileObj = (liveBaseline as Record<string, Record<string, Record<string, string>>> | null)?.[targetFileName];
        const globalBare = bareSelectorInsideGlobalKey(cssObjKey);
        const liveBaselineSelectorKey =
          liveBaselineFileObj
            ? (Object.keys(liveBaselineFileObj).find(
                (k) =>
                  k === cssObjKey ||
                  k.endsWith(' ' + cssObjKey) ||
                  (globalBare != null &&
                    (k === globalBare || k.endsWith(' ' + globalBare)))
              ) ?? cssObjKey)
            : cssObjKey;
        const referenceVal = liveBaselineFileObj?.[liveBaselineSelectorKey]?.[camelKey];

        // `:global(.ant-*)` 选择器：始终优先用 _domComputed 判断 Figma 是否真的改过。
        // 这条规则对单条/多条候选都生效，避免多候选场景整块噪音覆写。
        if (cssObjKey.startsWith(':global(.ant-')) {
          const globalBare = bareSelectorInsideGlobalKey(cssObjKey);
          const domSnap = globalBare ? liveBaseline?._domComputed?.[globalBare] : null;
          if (domSnap) {
            const domVal = domSnap[camelKey as keyof typeof domSnap] as string | undefined;
            if (domVal !== undefined) {
              if (valuesEqualForSync(camelKey, figmaValue, domVal)) return; // Figma = DOM computed，未改
              // Figma ≠ DOM computed，用户改过 → 继续走写入逻辑
            } else {
              return; // _domComputed 里没有这个属性（antd 内部属性），跳过
            }
          } else if (referenceVal == null || referenceVal === '') {
            return; // 无任何参考值，跳过防止噪音注入
          }
        }

        // 参考值存在时，逐属性判断是否为真实变更：
        // 仅当「Figma 未改」且「当前 Less 也未偏离参考」时跳过。
        if (liveBaseline && referenceVal != null && referenceVal !== '') {
          const isChangedInFigma = !valuesEqualForSync(camelKey, figmaValue, referenceVal);
          const isCurrentDeviatedFromReference =
            !valuesEqualForSync(camelKey, String(currentValue ?? ''), referenceVal);
          if (!isChangedInFigma && !isCurrentDeviatedFromReference) {
            return;
          }
        }

        if (currentValue !== figmaValue) {
          // 惰性创建 block：只有真正要写属性时才建立 cssObj 条目，避免空 block 污染 Less
          if (!cssObj[cssObjKey]) cssObj[cssObjKey] = {};
          (cssObj[cssObjKey] as Record<string, unknown>)[camelKey] = figmaValue;
          hasChange = true;
          actualChangedCount += 1;
          appliedChanges.push({
            selector: cssObjKey,
            cssKey,
            camelKey,
            before: currentValue,
            after: figmaValue,
          });
        }
      });
    });

    if (hasChange) {
      const cssStr = stringifyLess(cssObj);
      context.updateFile(comId, { fileName: targetFileName, content: cssStr, type: undefined });
      anyChange = true;
      updateFiles.add(targetFileName)
    }
  });

  if (anyChange) {
    context.saveManualVersion(comId, Array.from(updateFiles));
  }
  return actualChangedCount;
}
