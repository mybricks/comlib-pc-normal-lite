/**
 * stylePropInfoUtils
 *
 * 共享工具模块，供 injectStyleInfoPlugin 和 wrapReactNativeComponentPlugin 使用。
 *
 * 包含：
 *   - StylePropInfo 接口定义
 *   - 纯手写 AST 构建辅助函数
 *   - injectPositionInfoIntoObjectExpression：向 ObjectExpression 注入 _<propName> 位置信息
 *   - injectPositionInfoIntoStyleNode：按 style 节点类型分发注入
 *   - injectFilenameIntoObjectExpression：向 ObjectExpression 注入 _filename 字段
 *   - injectFilenameIntoStyleNode：按 style 节点类型分发 _filename 注入
 */

// ─── 类型定义 ───────────────────────────────────────────────────────────────

/**
 * 样式属性的源码位置信息。
 *
 *   - `line`：属性所在行号（1-based）
 *   - `propStart`：属性整体（key: value）在源文件中的起始字符偏移
 *   - `propEnd`：属性整体的结束字符偏移
 *   - `valueStart`：属性值的起始字符偏移
 *   - `valueEnd`：属性值的结束字符偏移
 */
export interface StylePropInfo {
  /** 属性所在行号（1-based） */
  line: number;
  /** 属性整体（key: value）在源文件中的起始字符偏移 */
  propStart: number;
  /** 属性整体的结束字符偏移 */
  propEnd: number;
  /** 属性值的起始字符偏移 */
  valueStart: number;
  /** 属性值的结束字符偏移 */
  valueEnd: number;
}

// ─── AST 构建辅助 ────────────────────────────────────────────────────────────

export function makeIdentifier(name: string) {
  return { type: 'Identifier', name };
}

export function makeNumericLiteral(value: number) {
  return { type: 'NumericLiteral', value, extra: { rawValue: value, raw: String(value) } };
}

export function makeObjectProperty(key: string, value: unknown) {
  return {
    type: 'ObjectProperty',
    key: makeIdentifier(key),
    value,
    computed: false,
    shorthand: false,
  };
}

export function makeObjectExpression(properties: unknown[]) {
  return { type: 'ObjectExpression', properties };
}

export function makeStringLiteral(value: string) {
  return { type: 'StringLiteral', value, extra: { rawValue: value, raw: JSON.stringify(value) } };
}

// ─── 构建单个属性的位置信息 AST 节点 ────────────────────────────────────────

/**
 * 将一个 StylePropInfo 对象编码为等价的 ObjectExpression AST 节点。
 *
 * 生成结构等价于：
 * `{ line: <n>, propStart: <n>, propEnd: <n>, valueStart: <n>, valueEnd: <n> }`
 */
export function buildStylePropInfoNode(info: StylePropInfo): unknown {
  return makeObjectExpression([
    makeObjectProperty('line', makeNumericLiteral(info.line)),
    makeObjectProperty('propStart', makeNumericLiteral(info.propStart)),
    makeObjectProperty('propEnd', makeNumericLiteral(info.propEnd)),
    makeObjectProperty('valueStart', makeNumericLiteral(info.valueStart)),
    makeObjectProperty('valueEnd', makeNumericLiteral(info.valueEnd)),
  ]);
}

// ─── 位置信息注入 ────────────────────────────────────────────────────────────

/**
 * 为一个 ObjectExpression AST 节点中的每个 ObjectProperty 注入 `_<propName>` 位置信息。
 *
 * 例如 `{ color: 'pink' }` 注入后变为：
 * `{ color: 'pink', _color: { line, propStart, propEnd, valueStart, valueEnd } }`
 *
 * 注意：
 * - 幂等：已存在 `_<propName>` key 则跳过
 * - 位置信息从 Babel AST 节点的 `start/end/loc` 中读取
 * - RN 渲染时会忽略未知的下划线前缀属性，不影响视觉
 *
 * @param objectNode - 要注入位置信息的 ObjectExpression AST 节点
 */
export function injectPositionInfoIntoObjectExpression(objectNode: any): void {
  if (!objectNode || objectNode.type !== 'ObjectExpression') return;

  // 收集已有下划线 key（幂等保护）
  const existingInfoKeys = new Set<string>();
  for (const prop of objectNode.properties || []) {
    if (prop.type !== 'ObjectProperty') continue;
    let keyName: string | null = null;
    if (prop.key?.type === 'Identifier') keyName = prop.key.name;
    else if (prop.key?.type === 'StringLiteral') keyName = prop.key.value;
    if (keyName && keyName.startsWith('_')) existingInfoKeys.add(keyName);
  }

  const toInject: unknown[] = [];

  for (const prop of objectNode.properties || []) {
    if (prop.type === 'SpreadElement' || prop.type === 'RestElement') continue;
    if (prop.type !== 'ObjectProperty') continue;

    // 提取属性名
    let propName: string | null = null;
    if (prop.key?.type === 'Identifier') propName = prop.key.name;
    else if (prop.key?.type === 'StringLiteral') propName = prop.key.value;
    if (!propName) continue;

    // 跳过自身的下划线 key
    if (propName.startsWith('_')) continue;

    const infoKey = `_${propName}`;
    if (existingInfoKeys.has(infoKey)) continue;

    const info: StylePropInfo = {
      line: prop.loc?.start?.line ?? 0,
      propStart: prop.start ?? 0,
      propEnd: prop.end ?? 0,
      valueStart: prop.value?.start ?? 0,
      valueEnd: prop.value?.end ?? 0,
    };

    toInject.push({
      type: 'ObjectProperty',
      key: makeIdentifier(infoKey),
      value: buildStylePropInfoNode(info),
      computed: false,
      shorthand: false,
    });
  }

  for (const node of toInject) {
    objectNode.properties.push(node);
  }
}

/**
 * 对 style prop 的值 AST 节点注入 inline 位置信息。
 *
 * - `ArrayExpression`：遍历 elements，对每个 `ObjectExpression` 元素调用
 *   `injectPositionInfoIntoObjectExpression`
 * - `ObjectExpression`：直接注入
 * - 其他形式（`MemberExpression` / `Identifier` 等）：不处理，由 injectStyleInfoPlugin 负责
 *
 * @param styleNode - style prop 的值 AST 节点
 */
export function injectPositionInfoIntoStyleNode(styleNode: any): void {
  if (!styleNode) return;

  if (styleNode.type === 'ArrayExpression') {
    for (const element of styleNode.elements || []) {
      if (element?.type === 'ObjectExpression') {
        injectPositionInfoIntoObjectExpression(element);
      }
    }
    return;
  }

  if (styleNode.type === 'ObjectExpression') {
    injectPositionInfoIntoObjectExpression(styleNode);
  }
}

// ─── filename 注入 ──────────────────────────────────────────────────────────

/**
 * 向 ObjectExpression AST 节点注入 `_filename` 字段（幂等）。
 * `_filename` 标识该样式块所在的源文件路径，供编辑器定位 patch 目标。
 *
 * @param objectNode - 要注入的 ObjectExpression AST 节点
 * @param filename   - 当前编译文件路径（来自 Babel state.filename）
 */
export function injectFilenameIntoObjectExpression(objectNode: any, filename: string): void {
  if (!objectNode || objectNode.type !== 'ObjectExpression' || !filename) return;

  // 幂等：已存在 _filename 则跳过
  const alreadyInjected = (objectNode.properties || []).some((prop: any) => {
    if (prop.type !== 'ObjectProperty') return false;
    const keyName =
      prop.key?.type === 'Identifier' ? prop.key.name :
      prop.key?.type === 'StringLiteral' ? prop.key.value : null;
    return keyName === '_filename';
  });
  if (alreadyInjected) return;

  objectNode.properties.push({
    type: 'ObjectProperty',
    key: makeIdentifier('_filename'),
    value: makeStringLiteral(filename),
    computed: false,
    shorthand: false,
  });
}

/**
 * 对 style prop 的值 AST 节点注入 `_filename` 字段。
 *
 * - `ArrayExpression`：对每个 `ObjectExpression` element 调用 `injectFilenameIntoObjectExpression`
 * - `ObjectExpression`：直接注入
 * - 其他形式：不处理
 *
 * @param styleNode - style prop 的值 AST 节点
 * @param filename  - 当前编译文件路径
 */
export function injectFilenameIntoStyleNode(styleNode: any, filename: string): void {
  if (!styleNode || !filename) return;

  if (styleNode.type === 'ArrayExpression') {
    for (const element of styleNode.elements || []) {
      if (element?.type === 'ObjectExpression') {
        injectFilenameIntoObjectExpression(element, filename);
      }
    }
    return;
  }

  if (styleNode.type === 'ObjectExpression') {
    injectFilenameIntoObjectExpression(styleNode, filename);
  }
}
