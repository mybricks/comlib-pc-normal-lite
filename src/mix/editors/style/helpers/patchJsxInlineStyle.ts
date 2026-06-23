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
