/** 单段文本在 DOM 摘要中的最大字符数 */
const DOM_SUMMARY_SINGLE_TEXT_MAX = 20;
/** 选区 DOM 摘要总最大字符数，超出时裁剪中间部分 */
const DOM_SUMMARY_TOTAL_MAX = 300;

/**
 * 从 DOM 元素提取结构化摘要，用于描述用户选区，控制 token 消耗。
 * - 按层级输出 tag、class、role 及文本摘要，不输出完整 HTML。
 * - 单段文本会截断到一定长度；若总长度超出上限，会裁剪中间部分并插入省略提示。
 * @param el 要摘要的根元素
 * @param options.singleTextMax 单段文本最大字符数，默认 80
 * @param options.totalMax 总摘要最大字符数，超出时裁剪中间，默认 300
 * @returns 多行结构化文本摘要
 */
export function extractDomSummary(
  el: Element,
  options?: { singleTextMax?: number; totalMax?: number }
): string {
  const singleTextMax = options?.singleTextMax ?? DOM_SUMMARY_SINGLE_TEXT_MAX;
  const totalMax = options?.totalMax ?? DOM_SUMMARY_TOTAL_MAX;
  const lines: string[] = [];

  function walk(node: Element, indent: number) {
    const tag = node.tagName.toLowerCase();
    const text = Array.from(node.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, singleTextMax);
    const role = node.getAttribute('role') || '';
    const cls = (node.className || '')
      .toString()
      .split(' ')
      .filter((c) => c && c.length < 20)
      .slice(0, 3)
      .join(' ');
    const desc = [tag, cls && `(.${cls})`, role && `[role=${role}]`, text && `"${text}"`]
      .filter(Boolean)
      .join(' ');
    lines.push('  '.repeat(indent) + desc);
    if (indent < 3) {
      Array.from(node.children)
        .slice(0, 8)
        .forEach((child) => walk(child, indent + 1));
      if (node.children.length > 8) {
        lines.push('  '.repeat(indent + 1) + `... ${node.children.length - 8} more children`);
      }
    }
  }

  walk(el, 0);
  let result = lines.join('\n');
  if (result.length <= totalMax) return result;
  const half = Math.floor((totalMax - 30) / 2);
  result =
    result.slice(0, half) + '\n... [中间内容已省略] ...\n' + result.slice(result.length - half);
  return result;
}

/**
 * 若当前聚焦处于「列表」中（兄弟节点拥有相同的 data-com-name 或 data-zone-selector），
 * 返回当前项在列表中的序号与总数；否则返回 null。
 */
export function getListFocusIndex(el: Element): { index: number; total: number } | null {
  for (const attrKey of ['data-com-name', 'data-zone-selector'] as const) {
    const itemEl = el.closest(`[${attrKey}]`);
    if (!itemEl) continue;

    const parent = itemEl.parentElement;
    if (!parent) continue;

    const value = itemEl.getAttribute(attrKey);
    if (value == null) continue;

    const siblings = Array.from(parent.children).filter(
      (child) => child.getAttribute(attrKey) === value
    );
    if (siblings.length <= 1) continue;

    const index = siblings.indexOf(itemEl);
    if (index === -1) continue;
    return { index: index + 1, total: siblings.length };
  }
  return null;
}

/**
 * 根据当前聚焦的 DOM 元素生成完整的选区信息文本（含组件名、列表序号、DOM 摘要），
 * 用于填入 agent 的上下文。
 * @param el 用户聚焦的 DOM 元素
 * @returns 格式化的 <选区信息>...</选区信息> 字符串
 */
export function buildFocusInfo(el: Element): string {
  const comName = el.closest(`[data-com-name]`)?.getAttribute('data-com-name') ?? '';
  const domSummary = extractDomSummary(el);
  const listInfo = getListFocusIndex(el);
  const listInfoLine = listInfo
    ? `当前聚焦: 第 ${listInfo.index} 项 / 共 ${listInfo.total} 项\n`
    : '';
  return `
<选区信息>
Component Name: ${comName}
${listInfoLine}DOM 摘要（tag / class / role / 文本）:
${domSummary}

注意：选区消息是当前用户聚焦的组件，仅用于参考。
</选区信息>
  `.trim();
}
