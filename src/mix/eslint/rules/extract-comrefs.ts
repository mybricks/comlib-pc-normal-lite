import { deriveNameFromFilePath } from '../utils';
import {
  extractRefFromVariableDeclarator,
  extractRefFromExportDefault,
} from '../../../utils/ai-code/plugins/utils/comRef';
import { extractCssClassNames } from '../../../utils/ai-code/plugins/utils/css';

export const RULE_ID = 'extract-comrefs';

/**
 * 从 JSX 文件中提取所有 comRef、popupRef、appRef 的节点信息。
 * 用于跨文件校验 README.md 的节点一致性。
 *
 * 注意：不提取 Route 相关信息，因为 Route 不一定就是 page，page 无法确定。
 *
 * 识别函数由 src/utils/ai-code/plugins/utils/comRef.ts 统一维护：
 *   - extractRefFromVariableDeclarator：识别 const Xxx = comRef/popupRef(...)
 *   - extractRefFromExportDefault：识别 export default comRef/popupRef/appRef(...)
 *
 * @param fileName 文件名，用于 export default comRef/popupRef 时派生组件名
 * @returns { plugin, getResults } plugin 注入 Babel，getResults 在 transform 后读取结果
 */
export type ComRefInfo = {
  /** 节点变量名，如 'SignIn'、'HomePage'、'default' */
  name: string;
  /** 节点类型：comRef | popupRef | appRef */
  kind: 'comRef' | 'popupRef' | 'appRef';
  /** 组件内出现过的 className 标识 */
  classNames: string[];
  /** 组件内 JSX 事件：className -> onClick/onChange 等 */
  events: Record<string, string[]>;
  /** 组件内 datasource 调用：className/root -> api 名 */
  datasource: Record<string, string[]>;
  /** 组件内 JSX 消费 store 数据：className/root -> 字段路径 */
  store: Record<string, string[]>;
  /** 组件内触发的 store 方法：className/root -> 方法名 */
  storeCalls: Record<string, string[]>;
};

export type StoreDatasourceMap = Record<string, string[]>;

type ReadmeSignals = Pick<ComRefInfo, 'classNames' | 'events' | 'datasource' | 'store' | 'storeCalls'>;

function addToRecord(record: Record<string, Set<string>>, key: string, value: string) {
  if (!key || !value) return;
  if (!record[key]) record[key] = new Set<string>();
  record[key].add(value);
}

function toArrayRecord(record: Record<string, Set<string>>): Record<string, string[]> {
  return Object.entries(record).reduce<Record<string, string[]>>((acc, [key, value]) => {
    acc[key] = Array.from(value);
    return acc;
  }, {});
}

function getClassNamesFromJSXElement(node: any): string[] {
  const classNameAttr = node?.openingElement?.attributes?.find((attr: any) => attr?.name?.name === 'className');
  if (!classNameAttr) return [];

  if (classNameAttr.value?.type === 'StringLiteral') {
    return classNameAttr.value.value
      .split(/\s+/)
      .map((name: string) => name.trim())
      .filter(Boolean);
  }

  const expression = classNameAttr.value?.type === 'JSXExpressionContainer'
    ? classNameAttr.value.expression
    : null;

  return extractCssClassNames(expression)
    .map(item => item.name)
    .filter(Boolean);
}

function getFirstClassNameForPath(path: any): string | undefined {
  let current = path;
  while (current) {
    if (current.isJSXElement?.()) {
      const classNames = getClassNamesFromJSXElement(current.node);
      if (classNames.length > 0) return classNames[0];
    }
    current = current.parentPath;
  }
  return undefined;
}

function getMemberPropertyName(node: any): string | undefined {
  const prop = node?.property;
  if (!prop) return undefined;
  if (!node.computed && prop.type === 'Identifier') return prop.name;
  if (prop.type === 'StringLiteral') return prop.value;
  return undefined;
}

function getMemberChain(node: any): { root?: string; path: string[] } {
  if (!node || node.type !== 'MemberExpression') return { path: [] };
  const prop = getMemberPropertyName(node);
  const parent = node.object;
  if (parent?.type === 'Identifier') {
    return { root: parent.name, path: prop ? [prop] : [] };
  }
  if (parent?.type === 'MemberExpression') {
    const result = getMemberChain(parent);
    return { root: result.root, path: prop ? [...result.path, prop] : result.path };
  }
  return { path: prop ? [prop] : [] };
}

function isInsideEventAttribute(path: any): boolean {
  let current = path.parentPath;
  while (current) {
    if (current.isJSXAttribute?.()) {
      const name = current.node?.name?.name;
      return typeof name === 'string' && /^on[A-Z]/.test(name);
    }
    if (current.isJSXElement?.()) return false;
    current = current.parentPath;
  }
  return false;
}

function isNestedMemberPrefix(path: any): boolean {
  const parent = path.parentPath?.node;
  return parent?.type === 'MemberExpression' && parent.object === path.node;
}

function isCalleeMember(path: any): boolean {
  const parent = path.parentPath?.node;
  return parent?.type === 'CallExpression' && parent.callee === path.node;
}

function createEmptySignals(): {
  classNames: Set<string>;
  events: Record<string, Set<string>>;
  datasource: Record<string, Set<string>>;
  store: Record<string, Set<string>>;
  storeCalls: Record<string, Set<string>>;
} {
  return {
    classNames: new Set<string>(),
    events: {},
    datasource: {},
    store: {},
    storeCalls: {},
  };
}

function collectReadmeSignals(rootPath: any): ReadmeSignals {
  const signals = createEmptySignals();

  rootPath.traverse({
    JSXElement(path: any) {
      const classNames = getClassNamesFromJSXElement(path.node);
      classNames.forEach(name => signals.classNames.add(name));

      const firstClassName = classNames[0];
      if (!firstClassName) return;

      for (const attr of path.node?.openingElement?.attributes ?? []) {
        const eventName = attr?.name?.name;
        if (typeof eventName === 'string' && /^on[A-Z]/.test(eventName)) {
          addToRecord(signals.events, firstClassName, eventName);
        }
      }
    },

    CallExpression(path: any) {
      const callee = path.node?.callee;
      if (callee?.type !== 'MemberExpression') return;

      const { root, path: memberPath } = getMemberChain(callee);
      if (!root) return;

      const api = memberPath[memberPath.length - 1];
      if (!api) return;

      const className = getFirstClassNameForPath(path) ?? 'root';
      if (/datasource/i.test(root)) {
        addToRecord(signals.datasource, className, api);
      }
      if (root === 'store') {
        addToRecord(signals.storeCalls, className, api);
      }
    },

    MemberExpression(path: any) {
      if (isNestedMemberPrefix(path)) return;
      if (isCalleeMember(path)) return;
      if (isInsideEventAttribute(path)) return;

      const { root, path: memberPath } = getMemberChain(path.node);
      if (root !== 'store' || memberPath.length === 0) return;

      const className = getFirstClassNameForPath(path) ?? 'root';
      addToRecord(signals.store, className, memberPath.join('.'));
    },
  });

  return {
    classNames: Array.from(signals.classNames),
    events: toArrayRecord(signals.events),
    datasource: toArrayRecord(signals.datasource),
    store: toArrayRecord(signals.store),
    storeCalls: toArrayRecord(signals.storeCalls),
  };
}

function withSignals(info: Pick<ComRefInfo, 'name' | 'kind'>, rootPath: any): ComRefInfo {
  return {
    ...info,
    ...collectReadmeSignals(rootPath),
  };
}

export function createExtractComRefsRule(fileName?: string): {
  plugin: (babel: any) => { visitor: Record<string, any> };
  getResults: () => ComRefInfo[];
} {
  const results: ComRefInfo[] = [];
  const fallbackName = deriveNameFromFilePath(fileName);

  function plugin(_babel: any) {
    return {
      visitor: {
        VariableDeclarator(path: any) {
          const info = extractRefFromVariableDeclarator(path.node);
          if (info) results.push(withSignals(info, path));
        },
        ExportDefaultDeclaration(path: any) {
          const info = extractRefFromExportDefault(path.node, fallbackName);
          if (info) results.push(withSignals(info, path));
        },
      },
    };
  }

  return {
    plugin,
    getResults: () => [...results],
  };
}
