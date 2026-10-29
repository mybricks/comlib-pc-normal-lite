import { parseExpression } from '@babel/parser';
import type { StyleInfoEntry } from './patchJsxInlineStyle';

/** freeform 批量写入的单节点补丁：支持 null 删除及带连字符的恢复标记，不改普通 inline 写入。 */
export function prepareFreedomInlineWrite(source: string, target: HTMLElement, patch: Record<string, any>) {
  const loc = JSON.parse(target.dataset.loc!);
  const start = loc.jsx.start;
  const end = loc.tag.end;
  const openingText = source.slice(start, end);
  const parseOpening = (text: string): any => {
    const jsx: any = parseExpression(text.endsWith('/>') ? text : text.slice(0, -1) + '/>', { plugins: ['jsx', 'typescript'] });
    return jsx.openingElement;
  };
  const opening = parseOpening(openingText);
  if (opening?.name?.name !== target.tagName.toLowerCase()) throw new Error('freeform JSX 定位已失效，请重新选择节点');
  const attributes = opening.attributes.filter((attr: any) => attr.name?.name === 'style');
  const attribute = attributes[0];
  const object = attribute?.value?.expression;
  if (attributes.length > 1 || (attribute && object?.type !== 'ObjectExpression') ||
    opening.attributes.some((attr: any) => attr.type === 'JSXSpreadAttribute')) {
    throw new Error('freeform inline 仅支持可独立修改的 style 对象');
  }
  const parts: string[] = [];
  const seen = new Set<string>();
  (object?.properties || []).forEach((prop: any) => {
    const key = prop.key?.type === 'Identifier' ? prop.key.name : prop.key?.value;
    if (prop.type !== 'ObjectProperty' || prop.computed || typeof key !== 'string' || seen.has(key)) {
      throw new Error('freeform inline 不支持展开或重复的 style 属性');
    }
    seen.add(key);
    if (!(key in patch)) parts.push(openingText.slice(prop.start, prop.end));
    else if (!['StringLiteral', 'NumericLiteral', 'NullLiteral'].includes(prop.value.type)) {
      throw new Error(`freeform 无法备份动态布局属性 ${key}`);
    }
  });
  Object.entries(patch).forEach(([key, value]) => {
    if (value != null) {
      const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
      parts.push(`${name}: ${JSON.stringify(value)}`);
    }
  });
  const text = parts.length ? `style={{ ${parts.join(', ')} }}` : '';
  // parseOpening 临时补了 /，原始 opening 是否自闭合以源码为准。
  const insertion = openingText.length - (openingText.endsWith('/>') ? 2 : 1);
  const patchStart = attribute?.start ?? insertion;
  const patchEnd = attribute?.end ?? insertion;
  const replacementText = attribute ? text : (text ? ` ${text}` : '');
  const nextOpening = openingText.slice(0, patchStart) + replacementText + openingText.slice(patchEnd);
  const styleInfo: Record<string, StyleInfoEntry> = {};
  const nextObject = parseOpening(nextOpening).attributes.find((attr: any) => attr.name?.name === 'style')?.value?.expression;
  (nextObject?.properties || []).forEach((prop: any) => {
    const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
    styleInfo[key] = {
      kind: ['StringLiteral', 'NumericLiteral', 'NullLiteral'].includes(prop.value.type) ? 'static' : 'dynamic',
      propertyStart: start + prop.start, propertyEnd: start + prop.end,
      valueStart: start + prop.value.start, valueEnd: start + prop.value.end,
    };
  });
  return {
    current: source.slice(0, start + patchStart) + replacementText + source.slice(start + patchEnd),
    replacement: { start: start + patchStart, end: start + patchEnd, newLength: replacementText.length,
      lineDelta: replacementText.split('\n').length - openingText.slice(patchStart, patchEnd).split('\n').length },
    styleInfo,
  };
}
