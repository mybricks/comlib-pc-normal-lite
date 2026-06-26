export type StyleInfoEntry = { kind: 'static'; valueStart: number; valueEnd: number };

/**
 * 向 JSX 源码中无 style 属性的开标签注入 `style={{ key: 'val', ... }}`。
 *
 * 注入位置：开标签结尾 `>` 之前（通过 data-loc.tag.end 得到的绝对偏移）。
 * 同时返回注入后各属性值在新源码中的绝对偏移，供调用方写入 data-style-info。
 *
 * @param source   JSX 文件源码（decoded）
 * @param tagEnd   data-loc.tag.end，即 node.openingElement.end（exclusive，指向 `>` 之后）
 * @param cssProps 驼峰 key → CSS 值字符串，值为 null/undefined/'' 时跳过该属性
 */
export function injectStyleAttrIntoJSX(
  source: string,
  tagEnd: number,
  cssProps: Record<string, string | null | undefined>,
): { newSource: string; styleInfo: Record<string, StyleInfoEntry> } | null {
  const filteredProps = Object.entries(cssProps).filter(
    (entry): entry is [string, string] => entry[1] != null && entry[1] !== '',
  );
  if (!filteredProps.length) return null;

  // tagEnd 是开标签的 exclusive end，tagEnd-1 指向 '>'
  const insertPos = tagEnd - 1;
  if (insertPos < 0 || insertPos >= source.length) return null;
  if (source[insertPos] !== '>') return null; // 安全校验，非法偏移时放弃

  const styleInfo: Record<string, StyleInfoEntry> = {};
  let attrStr = ' style={{ ';

  filteredProps.forEach(([key, val], i) => {
    const escaped = String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const valStr = `'${escaped}'`;
    const keyPart = `${key}: `;

    if (i > 0) attrStr += ', ';
    attrStr += keyPart;

    // 此时 attrStr.length 是 '值' 起始位置相对于 insertPos 的偏移
    const valueStart = insertPos + attrStr.length;
    attrStr += valStr;
    const valueEnd = insertPos + attrStr.length;

    styleInfo[key] = { kind: 'static', valueStart, valueEnd };
  });

  attrStr += ' }}';

  const newSource = source.slice(0, insertPos) + attrStr + source.slice(insertPos);
  return { newSource, styleInfo };
}

/**
 * 向 JSX 源码中已有 `style={{ ... }}` 的元素追加新属性。
 *
 * 策略：从 existingStyleInfo 里找到最靠后的 valueEnd，从该位置向后扫到第一个 `}`，
 * 在 `}}` 之前插入 `, newKey: 'newVal', ...`。
 * 插入点在所有已有属性的 valueEnd 之后，不影响已有偏移，无需调整 existingStyleInfo。
 *
 * @param source            JSX 文件源码（decoded）
 * @param existingStyleInfo 当前 DOM 上的 data-style-info 解析结果
 * @param cssProps          要追加的属性（驼峰 key → CSS 值字符串，null/''/undefined 时跳过）
 */
export function appendToInlineStyleAttr(
  source: string,
  existingStyleInfo: Record<string, StyleInfoEntry>,
  cssProps: Record<string, string | null | undefined>,
): { newSource: string; styleInfoUpdates: Record<string, StyleInfoEntry> } | null {
  const filteredProps = Object.entries(cssProps).filter(
    (entry): entry is [string, string] => entry[1] != null && entry[1] !== '',
  );
  if (!filteredProps.length) return null;

  // 找到 existingStyleInfo 中最靠后的 valueEnd
  const entries = Object.values(existingStyleInfo).filter(
    (e) => e.kind === 'static' && e.valueEnd != null,
  );
  if (!entries.length) return null;
  const lastValueEnd = entries.reduce((max, e) => (e.valueEnd > max ? e.valueEnd : max), 0);
  if (lastValueEnd <= 0 || lastValueEnd >= source.length) return null;

  // 从 lastValueEnd 向后扫描，找到第一个 '}' 即为 '}}' 的起始位置
  let insertPos = lastValueEnd;
  while (insertPos < source.length && source[insertPos] !== '}') insertPos++;
  if (insertPos >= source.length - 1 || source[insertPos] !== '}' || source[insertPos + 1] !== '}') {
    return null; // 没有找到 '}}' 结尾，偏移已失效
  }

  const styleInfoUpdates: Record<string, StyleInfoEntry> = {};
  let insertion = '';

  filteredProps.forEach(([key, val]) => {
    const escaped = String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const valStr = `'${escaped}'`;
    const keyPart = `${key}: `;

    insertion += ', ';
    insertion += keyPart;

    const valueStart = insertPos + insertion.length;
    insertion += valStr;
    const valueEnd = insertPos + insertion.length;

    styleInfoUpdates[key] = { kind: 'static', valueStart, valueEnd };
  });

  const newSource = source.slice(0, insertPos) + insertion + source.slice(insertPos);
  return { newSource, styleInfoUpdates };
}

/**
 * 从 JSX 源码中已有的 `style={{ ... }}` 属性里移除指定属性。
 *
 * - 若移除后仍有剩余属性：重建 `style={{ remaining... }}`，并返回新的 styleInfo 偏移。
 * - 若移除后属性全部为空：删除整个 `style={{ ... }}` 属性，返回 `newStyleInfo = null`。
 *
 * 定位边界的方式：
 *  - 从所有 entry 中取 minValueStart，向前扫描找到 ` style={` 起始（styleAttrStart）
 *  - 从 maxValueEnd 向后扫描找到 `}}` 末尾（styleAttrEnd）
 *
 * @param source            JSX 文件源码（decoded）
 * @param existingStyleInfo 当前 DOM 的 data-style-info 解析结果
 * @param keysToRemove      要删除的驼峰 key 列表
 */
export function removeFromInlineStyleAttr(
  source: string,
  existingStyleInfo: Record<string, StyleInfoEntry>,
  keysToRemove: string[],
): { newSource: string; newStyleInfo: Record<string, StyleInfoEntry> | null } | null {
  const removeSet = new Set(keysToRemove);
  const allEntries = Object.entries(existingStyleInfo).filter(
    ([, e]) => e.kind === 'static' && e.valueStart != null && e.valueEnd != null,
  );
  if (!allEntries.length) return null;

  // 定位 style 属性在源码中的边界
  const minValueStart = allEntries.reduce((min, [, e]) => Math.min(min, e.valueStart), Infinity);
  const maxValueEnd = allEntries.reduce((max, [, e]) => Math.max(max, e.valueEnd), -Infinity);

  // 用 lastIndexOf 向前定位 ' style=' 起始，避免被属性值内的空格误停
  const styleAttrStart = source.lastIndexOf(' style=', minValueStart);
  if (styleAttrStart === -1 || !source.slice(styleAttrStart + 1).startsWith('style=')) return null;

  // 向后扫描找 '}}' 末尾
  let scanPos = maxValueEnd;
  while (scanPos < source.length - 1 && !(source[scanPos] === '}' && source[scanPos + 1] === '}')) {
    scanPos++;
  }
  if (scanPos >= source.length - 1) return null; // 没找到 '}}'
  const styleAttrEnd = scanPos + 2; // 跳过 '}}'

  // 剩余属性（按 valueStart 排序，保持原顺序）
  const remainingEntries = allEntries
    .filter(([key]) => !removeSet.has(key))
    .sort(([, a], [, b]) => a.valueStart - b.valueStart);

  if (remainingEntries.length === 0) {
    // 全部删除：移除整个 style 属性（含前面的空格）
    const newSource = source.slice(0, styleAttrStart) + source.slice(styleAttrEnd);
    return { newSource, newStyleInfo: null };
  }

  // 部分保留：重建 style 属性，从当前源码中读取各属性的现有值
  const newStyleInfo: Record<string, StyleInfoEntry> = {};
  let rebuilt = ' style={{ ';

  remainingEntries.forEach(([key, entry], i) => {
    if (i > 0) rebuilt += ', ';
    rebuilt += `${key}: `;
    const currentVal = source.slice(entry.valueStart, entry.valueEnd); // e.g. "'red'"
    const valueStart = styleAttrStart + rebuilt.length;
    rebuilt += currentVal;
    const valueEnd = styleAttrStart + rebuilt.length;
    newStyleInfo[key] = { kind: 'static', valueStart, valueEnd };
  });

  rebuilt += ' }}';

  const newSource = source.slice(0, styleAttrStart) + rebuilt + source.slice(styleAttrEnd);
  return { newSource, newStyleInfo };
}

export type JsxStylePatchEntry = {
  val: string | number;
  valueStart: number;
  valueEnd: number;
  /**
   * 为 true 时，val 以 JS 字符串字面量写入（例如 '16px'）；
   * 省略或 false 时，直接写数字（例如 16）。
   */
  asString?: boolean;
};

/** 判断字符串是否是合法的 JS 字面量（字符串 / 数字 / 模板字符串） */
function isJsLiteral(s: string): boolean {
  const t = s.trim();
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith('`') && t.endsWith('`'))
  ) return true;
  if (/^-?\d+(\.\d+)?$/.test(t)) return true;
  return false;
}

/**
 * 将 JSX 内联 style 中的静态属性值按字符偏移原位替换。
 *
 * - 从大到小按 valueStart 排序，避免前面替换影响后面偏移。
 * - 对每处偏移做安全校验：必须指向合法 JS 字面量，否则整体返回 null，调用方应降级处理。
 */
export function patchJsxInlineStyle(
  source: string,
  entries: JsxStylePatchEntry[],
): string | null {
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => b.valueStart - a.valueStart);
  let result = source;
  for (const { val, valueStart, valueEnd, asString } of sorted) {
    if (valueStart < 0 || valueEnd > result.length || valueStart >= valueEnd) return null;
    const original = result.slice(valueStart, valueEnd);
    if (!isJsLiteral(original)) return null;
    const escapedVal = asString ? String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'") : val;
    const newVal = asString ? `'${escapedVal}'` : `${val}`;
    result = result.slice(0, valueStart) + newVal + result.slice(valueEnd);
  }
  return result;
}

/**
 * 每次 patch 成功后，将 DOM 元素上 data-style-info 的偏移量同步更新。
 *
 * 背景：data-style-info 是 Babel 编译时写入的静态偏移，patch 后若写入值长度
 * 与原值不同，后续所有属性的偏移量都会漂移，导致连续第二次编辑时替换错误位置。
 * 本函数在每次 patch 成功后直接修改 DOM attribute，让下次 set() 读到正确偏移。
 *
 * @param ele          被编辑的 DOM 元素
 * @param replacements 本次 patch 的替换信息（排列顺序不限，内部按 valueStart 排序）
 */
export function patchDataStyleInfo(
  ele: HTMLElement,
  replacements: Array<{ valueStart: number; valueEnd: number; newLen: number }>,
): void {
  const raw = ele.dataset.styleInfo;
  if (!raw) return;
  let info: Record<string, { kind: string; valueStart?: number; valueEnd?: number }>;
  try { info = JSON.parse(raw); } catch { return; }

  // 从前到后逐条处理，维护累计偏移量
  const sorted = [...replacements].sort((a, b) => a.valueStart - b.valueStart);
  let delta = 0;

  for (const { valueStart, valueEnd, newLen } of sorted) {
    const adjustedStart = valueStart + delta;
    const shift = newLen - (valueEnd - valueStart);

    for (const key of Object.keys(info)) {
      const entry = info[key];
      if (entry.kind !== 'static' || entry.valueStart == null || entry.valueEnd == null) continue;
      if (entry.valueStart === adjustedStart) {
        // 当前被替换的 key：更新 valueEnd
        entry.valueEnd = adjustedStart + newLen;
      } else if (entry.valueStart > adjustedStart) {
        // 替换点之后的 key：整体偏移
        entry.valueStart += shift;
        entry.valueEnd += shift;
      }
    }
    delta += shift;
  }

  ele.dataset.styleInfo = JSON.stringify(info);
}
