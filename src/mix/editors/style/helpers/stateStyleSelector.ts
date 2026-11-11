const EDITABLE_STATES = new Set([
  'hover', 'focus', 'focus-visible', 'focus-within', 'active', 'disabled',
  'checked', 'indeterminate', 'placeholder-shown', 'visited', 'target',
  'enabled', 'read-only', 'read-write', 'required', 'optional', 'valid', 'invalid',
]);

/** 只识别目标主体的状态，忽略祖先、属性字符串以及 :not/:is 等函数中的伪类。 */
export function isStateStyleSelector(selector: unknown): boolean {
  if (typeof selector !== 'string') return false;
  const text = selector.trim();
  let depth = 0;
  let quote = '';
  let state = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[') { depth++; continue; }
    if (ch === ')' || ch === ']') { depth--; continue; }
    if (depth) continue;
    // 编辑器按单一源码 selector 提交，逗号混合目标不推断为状态写入。
    if (ch === ',') return false;
    if (/[\s>+~]/.test(ch)) { state = false; continue; }
    if (ch !== ':') continue;
    const token = text.slice(i).match(/^(:{1,2})([\w-]+)/);
    if (!token) continue;
    const name = token[2].toLowerCase();
    state ||= token[1] === '::' || /^(before|after|first-line|first-letter)$/.test(name) || EDITABLE_STATES.has(name);
    i += token[0].length - 1;
  }
  return state;
}

/** 识别 .A:hover .B 等单个祖先状态，不改变原主体状态判断。 */
export function isAncestorStateStyleSelector(selector: unknown): boolean {
  if (typeof selector !== 'string' || isStateStyleSelector(selector)) return false;
  const text = selector.trim();
  let depth = 0;
  let quote = '';
  let stateEnd = -1;
  let hasDescendant = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[') { depth++; continue; }
    if (ch === ')' || ch === ']') { depth--; continue; }
    if (depth) continue;
    if (ch === ',') return false;
    if (stateEnd >= 0 && (ch === '+' || ch === '~')) return false;
    if (stateEnd >= 0 && i >= stateEnd && /[\s>]/.test(ch)) hasDescendant = true;
    if (ch !== ':') continue;
    const token = text.slice(i).match(/^:(hover|focus|active|disabled)(?![\w-(])/);
    if (!token) continue;
    if (stateEnd >= 0) return false;
    stateEnd = i + token[0].length;
    i = stateEnd - 1;
  }
  return stateEnd >= 0 && hasDescendant;
}
