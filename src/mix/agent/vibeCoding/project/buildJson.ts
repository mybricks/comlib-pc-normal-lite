/**
 * 从 runtime.jsx + style.less 内容构建 project.json 根数组
 * 使用与 transform-umd 相同的 window.Babel，无额外依赖
 */

import type { ProjectNode } from './index';

const RUNTIME_PATH = '/runtime.jsx';
const STYLE_PATH = '/style.less';

function getLineRange(node: { loc?: { start?: { line?: number }; end?: { line?: number } } }): [number, number] | null {
  if (!node?.loc?.start?.line || !node?.loc?.end?.line) return null;
  return [node.loc.start.line, node.loc.end.line];
}

/** 在节点行范围基础上纳入前导注释（如 JSDoc），使 contents 包含注释所在行 */
function getLineRangeIncludingComments(
  node: { loc?: { start?: { line?: number }; end?: { line?: number } } },
  leadingComments: any[] | undefined
): [number, number] | null {
  const range = getLineRange(node);
  if (!range) return null;
  if (!Array.isArray(leadingComments) || leadingComments.length === 0) return range;
  let startLine = range[0];
  for (const c of leadingComments) {
    const line = c?.loc?.start?.line;
    if (typeof line === 'number' && line < startLine) startLine = line;
  }
  return [startLine, range[1]];
}

function isComRefCall(callee: any): boolean {
  if (callee?.type === 'Identifier') return callee.name === 'comRef';
  if (callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier')
    return callee.property.name === 'comRef';
  return false;
}

function getComRefCallFromNode(node: any): any {
  if (node?.type === 'VariableDeclarator') return node.init;
  if (node?.type === 'ExportDefaultDeclaration') return node.declaration;
  return null;
}

/** 从 comRef 调用的 CallExpression 节点拿到「组件根 JSX」；与 babelPlugin getComponentRootJSXNode 逻辑一致 */
function getRootJSXFromComRefCall(call: any): any {
  if (!call || call.type !== 'CallExpression' || !call.arguments?.[0]) return null;
  const fn = call.arguments[0];
  const body = fn?.body;
  if (!body) return null;
  let returnExpr: any = null;
  if (fn.type === 'ArrowFunctionExpression') {
    if (body.type === 'BlockStatement') {
      const ret = body.body?.find((s: any) => s.type === 'ReturnStatement');
      returnExpr = ret?.argument ?? null;
    } else returnExpr = body;
  } else if (fn.type === 'FunctionExpression' && body.type === 'BlockStatement') {
    const ret = body.body?.find((s: any) => s.type === 'ReturnStatement');
    returnExpr = ret?.argument ?? null;
  }
  if (!returnExpr) return null;
  let unwraps = 0;
  while (returnExpr?.type === 'ParenthesizedExpression' && unwraps < 20) {
    returnExpr = returnExpr.expression;
    unwraps++;
  }
  return returnExpr?.type === 'JSXElement' ? returnExpr : returnExpr?.type === 'JSXFragment' ? returnExpr : null;
}

function parseJSDoc(raw: string): { summary?: string; props?: Record<string, string>; events?: Record<string, string> } | null {
  if (raw == null || typeof raw !== 'string') return null;
  const lines = raw.split(/\r?\n/).map((s) => s.replace(/^\s*\*\s?/, '').trim());
  let summary: string | undefined;
  const props: Record<string, string> = {};
  const events: Record<string, string> = {};
  for (const line of lines) {
    const summaryMatch = line.match(/^@summary\s+(.+)$/);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
      continue;
    }
    const propMatch = line.match(/^@(?:prop|param)\s+(?:\{([^}]*)\}\s+)?(\S+)(?:\s+-\s+(.+))?$/);
    if (propMatch) {
      props[propMatch[2].trim()] = propMatch[1]?.trim() || 'any';
      continue;
    }
    const eventMatch = line.match(/^@event\s+(?:\{(\S+)\}\s+)?(.+)$/);
    if (eventMatch) {
      const name = (eventMatch[1] || 'event').trim();
      events[name] = (eventMatch[2] || '').trim();
    }
  }
  if (!summary && Object.keys(props).length === 0 && Object.keys(events).length === 0) return null;
  const result: any = {};
  if (summary) result.summary = summary;
  if (Object.keys(props).length) result.props = props;
  if (Object.keys(events).length) result.events = events;
  return result;
}

function extractCssClassNames(node: any): string[] {
  const result: string[] = [];
  if (!node) return result;
  if (node.type === 'MemberExpression') {
    if (node.object?.type === 'Identifier' && node.object.name === 'css' && node.property?.type === 'Identifier')
      result.push(node.property.name);
    return result;
  }
  if (node.type === 'TemplateLiteral') {
    for (const expr of node.expressions || []) result.push(...extractCssClassNames(expr));
    return result;
  }
  if (node.type === 'ConditionalExpression') {
    result.push(...extractCssClassNames(node.consequent), ...extractCssClassNames(node.alternate));
    return result;
  }
  if (node.type === 'LogicalExpression') {
    result.push(...extractCssClassNames(node.left), ...extractCssClassNames(node.right));
    return result;
  }
  if (node.type === 'BinaryExpression' && (node.operator === '+' || node.operator === '||')) {
    result.push(...extractCssClassNames(node.left), ...extractCssClassNames(node.right));
    return result;
  }
  if (node.type === 'CallExpression' && node.arguments) {
    for (const arg of node.arguments) result.push(...extractCssClassNames(arg));
    return result;
  }
  return result;
}

/** 从 JSX 开标签节点取标签名（兼容 JSXIdentifier / 不同 Babel 版本） */
function getJSXTagName(nameNode: any): string | undefined {
  if (!nameNode) return undefined;
  if (typeof nameNode.name === 'string') return nameNode.name;
  if (nameNode.type === 'JSXIdentifier' && typeof nameNode.name === 'string') return nameNode.name;
  return undefined;
}

/** 判断是否为 React.createElement / _jsx / _jsxs 调用，并返回“组件类型”的标识名（仅当首参为 Identifier 时） */
function getCreateElementTypeName(node: any): string | null {
  if (!node || node.type !== 'CallExpression' || !node.callee || !node.arguments?.length) return null;
  const callee = node.callee;
  let isCreateElement = false;
  if (callee.type === 'Identifier') {
    if (callee.name === 'createElement' || callee.name === '_jsx' || callee.name === '_jsxs') isCreateElement = true;
  } else if (callee.type === 'MemberExpression' && callee.property?.type === 'Identifier') {
    if (callee.property.name === 'createElement') isCreateElement = true;
  }
  if (!isCreateElement) return null;
  const firstArg = node.arguments[0];
  if (firstArg?.type === 'Identifier' && typeof firstArg.name === 'string') return firstArg.name;
  return null;
}

/**
 * 从组件函数体或根 JSX 节点收集子组件名、css 类、函数调用。
 * 与 babelPlugin 一致：优先从 rootJSXNode（getComponentRootJSXNode 得到的根 JSX）遍历，保证能走到所有 JSX 子节点。
 */
function collectFromBody(
  bodyNode: any,
  comRefNames: Set<string>,
  addChild: (name: string) => void,
  addCss: (c: string) => void,
  addCall: (name: string) => void,
  options?: {
    debugLabel?: string;
    rootJSXNode?: any;
    /** 当前组件名，用于排查日志 */
    compName?: string;
    /** 模块级变量名集合，遍历到这些标识符时记为该组件引用了该共享变量 */
    variableNames?: Set<string>;
    addVarRef?: (name: string) => void;
  }
) {
  const debugLabel = options?.debugLabel;
  const rootJSXNode = options?.rootJSXNode;
  const compName = options?.compName ?? '';
  const variableNames = options?.variableNames;
  const addVarRef = options?.addVarRef;

  const visit = (node: any) => {
    if (!node) return;
    // 任意标识符：若为模块级变量则记为引用，共享变量定义行会纳入 contents
    if (node.type === 'Identifier' && typeof node.name === 'string' && variableNames?.has(node.name) && addVarRef) addVarRef(node.name);
    if (node.type === 'ReturnStatement' && node.argument) {
      visit(node.argument);
      return;
    }
    if (node.type === 'ParenthesizedExpression' && node.expression) {
      visit(node.expression);
      return;
    }
    if (node.type === 'JSXFragment') {
      const fragChildren = node.children;
      if (fragChildren && typeof fragChildren.length === 'number') {
        for (let i = 0; i < fragChildren.length; i++) visit(fragChildren[i]);
      }
      return;
    }
    if (node.type === 'JSXExpressionContainer' && node.expression) {
      visit(node.expression);
      return;
    }
    // 任意 JSX 元素：子组件关系 + 该元素上的 className（含共享 class，不限于某几个）
    if (node.type === 'JSXElement' && node.openingElement?.name) {
      const name = getJSXTagName(node.openingElement.name);
      if (typeof name === 'string' && /^[A-Z]/.test(name) && comRefNames.has(name)) addChild(name);
      const classNameAttr = node.openingElement.attributes?.find((a: any) => a.name?.name === 'className');
      const expr = classNameAttr?.value?.type === 'JSXExpressionContainer' ? classNameAttr.value.expression : null;
      const classesFromJSX = extractCssClassNames(expr);
      classesFromJSX.forEach(addCss);
      // 兼容类数组：部分环境 node.children 非 Array，用 length + 下标遍历
      const children = node.children;
      if (children && typeof children.length === 'number') {
        for (let i = 0; i < children.length; i++) visit(children[i]);
      }
      return;
    }
    // createElement/_jsx：子组件关系 + 任意元素的 props.className（共享 class 统一纳入当前组件 contents）
    if (node.type === 'CallExpression') {
      const elemTypeName = getCreateElementTypeName(node);
      if (elemTypeName && /^[A-Z]/.test(elemTypeName) && comRefNames.has(elemTypeName)) {
        addChild(elemTypeName);
      }
      // 任意 createElement(type, props, ...) 的 props.className 都提取，不特殊处理某类组件
      const propsArg = node.arguments?.[1];
      if (propsArg && propsArg.type === 'ObjectExpression' && Array.isArray(propsArg.properties)) {
        for (const prop of propsArg.properties) {
          if (prop.type !== 'ObjectProperty' || !prop.key) continue;
          const keyName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'StringLiteral' ? prop.key.value : null;
          if (keyName === 'className' && prop.value) {
            const classes = extractCssClassNames(prop.value);
            classes.forEach(addCss);
            break;
          }
        }
      }
      // 任意函数调用都收集，后续 metaToNode 会做传递闭包，共享函数行会进 contents
      if (node.callee?.type === 'Identifier') addCall(node.callee.name);
      // 继续遍历 arguments，以便递归到嵌套元素和表达式中的调用
      const args = node.arguments;
      if (args && typeof args.length === 'number') {
        for (let i = 0; i < args.length; i++) visit(args[i]);
      }
      return;
    }
    for (const key of Object.keys(node)) {
      const val = (node as any)[key];
      if (Array.isArray(val)) val.forEach(visit);
      else if (val && typeof val === 'object' && val.type) visit(val);
    }
  };

  // 统一遍历整个函数体：无论有无 rootJSXNode，都要扫描所有语句（变量声明、条件、循环等）
  // 因为函数调用、变量引用可能散布在函数体的任何地方，不只是 return 的 JSX 里
  if (!bodyNode) return;
  if (bodyNode.type === 'BlockStatement' && Array.isArray(bodyNode.body)) {
    bodyNode.body.forEach(visit);
  } else {
    // ArrowFunction 的 body 可能直接是 Expression
    visit(bodyNode);
  }
}

interface ComponentMeta {
  name: string;
  startLine: number;
  endLine: number;
  jsdoc: ReturnType<typeof parseJSDoc>;
  fnBodyNode: any;
  /** 组件根 JSX 节点（return 的最外层 JSXElement/JSXFragment），与 babelPlugin getComponentRootJSXNode 一致，用于从此节点遍历子组件 */
  rootJSXNode: any;
  childNames: string[];
  cssClasses: string[];
  calledFunctionNames: string[];
  /** 本组件内引用到的模块级变量名（共享变量），其定义行会纳入 contents */
  referencedVariableNames: string[];
}

interface FunctionMeta {
  name: string;
  startLine: number;
  endLine: number;
  calledNames: string[];
}

interface VariableMeta {
  name: string;
  startLine: number;
  endLine: number;
}

interface CollectorState {
  importRange: { start: number; end: number } | null;
  components: ComponentMeta[];
  rootComponent: ComponentMeta | null;
  functions: FunctionMeta[];
  /** 模块级变量（const/let/var，不含 comRef 组件），被组件引用时其定义行纳入该组件 contents */
  variables: VariableMeta[];
  comRefNames: Set<string>;
}

function createCollectorPlugin(state: CollectorState) {
  return function collectorPlugin() {
    return {
      visitor: {
        ImportDeclaration(path: any) {
          const range = getLineRange(path.node);
          if (!range) return;
          if (!state.importRange) state.importRange = { start: range[0], end: range[1] };
          else {
            state.importRange.start = Math.min(state.importRange.start, range[0]);
            state.importRange.end = Math.max(state.importRange.end, range[1]);
          }
        },
        FunctionDeclaration(path: any) {
          const node = path.node;
          const comments = node.leadingComments;
          const range = getLineRangeIncludingComments(node, comments) ?? getLineRange(node);
          if (!range || !node.id?.name) return;
          const calledNames: string[] = [];
          const visit = (n: any) => {
            if (!n) return;
            if (n.type === 'CallExpression' && n.callee?.type === 'Identifier') calledNames.push(n.callee.name);
            for (const k of Object.keys(n)) {
              const v = (n as any)[k];
              if (Array.isArray(v)) v.forEach(visit);
              else if (v && typeof v === 'object' && v.type) visit(v);
            }
          };
          if (node.body?.type === 'BlockStatement') node.body.body.forEach(visit);
          state.functions.push({
            name: node.id.name,
            startLine: range[0],
            endLine: range[1],
            calledNames: [...new Set(calledNames)],
          });
        },
        VariableDeclarator(path: any) {
          const node = path.node;
          const init = node.init;
          const isProgramLevel = path.parentPath?.parentPath?.node?.type === 'Program';
          const isComRef = init && init.type === 'CallExpression' && isComRefCall(init.callee) && init.arguments?.[0];
          if (isComRef && node.id?.type === 'Identifier') {
            const comments = path.parentPath?.node?.leadingComments ?? node.leadingComments;
            const range = getLineRangeIncludingComments(node, comments) ?? getLineRange(node);
            if (!range) return;
            const fn = init.arguments[0];
            const body = fn?.body;
            let jsdoc: ReturnType<typeof parseJSDoc> = null;
            if (Array.isArray(comments)) {
              const block = comments.find((c: any) => c.type === 'CommentBlock');
              if (block?.value) jsdoc = parseJSDoc(block.value);
            }
            state.components.push({
              name: node.id.name,
              startLine: range[0],
              endLine: range[1],
              jsdoc,
              fnBodyNode: body,
              rootJSXNode: getRootJSXFromComRefCall(init),
              childNames: [],
              cssClasses: [],
              calledFunctionNames: [],
              referencedVariableNames: [],
            });
            return;
          }
          // 模块级非 comRef 变量（const/let/var），供组件引用时将其定义行纳入 contents
          if (isProgramLevel && node.id?.type === 'Identifier') {
            const parentNode = path.parentPath?.node;
            const comments = parentNode?.leadingComments;
            const range = getLineRangeIncludingComments(parentNode ?? node, comments) ?? getLineRange(node);
            if (range) state.variables.push({ name: node.id.name, startLine: range[0], endLine: range[1] });
          }
        },
        ExportDefaultDeclaration(path: any) {
          const node = path.node;
          const decl = node.declaration;
          if (!decl || decl.type !== 'CallExpression' || !isComRefCall(decl.callee) || !decl.arguments?.[0]) return;
          const comments = node.leadingComments;
          const range = getLineRangeIncludingComments(node, comments) ?? getLineRange(node);
          if (!range) return;
          const fn = decl.arguments[0];
          const body = fn?.body;
          let jsdoc: ReturnType<typeof parseJSDoc> = null;
          if (Array.isArray(comments)) {
            const block = comments.find((c: any) => c.type === 'CommentBlock');
            if (block?.value) jsdoc = parseJSDoc(block.value);
          }
          state.rootComponent = {
            name: 'root',
            startLine: range[0],
            endLine: range[1],
            jsdoc,
            fnBodyNode: body,
            rootJSXNode: getRootJSXFromComRefCall(decl),
            childNames: [],
            cssClasses: [],
            calledFunctionNames: [],
            referencedVariableNames: [],
          };
        },
        Program: {
          exit() {
            state.comRefNames = new Set(state.components.map((c) => c.name));
            if (state.rootComponent) state.comRefNames.add('root');
            const variableNames = new Set(state.variables.map((v) => v.name));
            const allComponents = state.rootComponent
              ? [state.rootComponent, ...state.components]
              : [...state.components];
            for (const comp of allComponents) {
              collectFromBody(
                comp.fnBodyNode,
                state.comRefNames,
                (name) => comp.childNames.push(name),
                (c) => comp.cssClasses.push(c),
                (name) => comp.calledFunctionNames.push(name),
                {
                  debugLabel: comp.name === 'root' ? 'root' : undefined,
                  compName: comp.name,
                  rootJSXNode: comp.rootJSXNode || undefined,
                  variableNames,
                  addVarRef: (name) => comp.referencedVariableNames.push(name),
                }
              );
              comp.childNames = [...new Set(comp.childNames)];
              comp.cssClasses = [...new Set(comp.cssClasses)];
              comp.calledFunctionNames = [...new Set(comp.calledFunctionNames)];
              comp.referencedVariableNames = [...new Set(comp.referencedVariableNames)];
            }
          },
        },
      },
    };
  };
}

function transitiveCalls(functions: FunctionMeta[]): Map<string, Set<string>> {
  const nameToFn = new Map<string, FunctionMeta>();
  functions.forEach((f) => nameToFn.set(f.name, f));
  const result = new Map<string, Set<string>>();
  function closure(name: string): Set<string> {
    if (result.has(name)) return result.get(name)!;
    const set = new Set<string>();
    const fn = nameToFn.get(name);
    if (fn) {
      fn.calledNames.forEach((c) => {
        set.add(c);
        closure(c).forEach((x) => set.add(x));
      });
    }
    result.set(name, set);
    return set;
  }
  functions.forEach((f) => closure(f.name));
  return result;
}

/** LESS 行范围：key 为完整选择器路径（顶层.嵌套.类名），避免不同块下同名 class 串用 */
function parseLessRanges(styleContent: string): Map<string, [number, number]> {
  const map = new Map<string, [number, number]>();
  const lines = styleContent.split(/\r?\n/);

  function findBlockEnd(startIdx: number): number {
    let depth = 1;
    let j = startIdx + 1;
    while (j < lines.length && depth > 0) {
      const l = lines[j];
      for (const c of l) {
        if (c === '{') depth++;
        else if (c === '}') depth--;
      }
      j++;
    }
    return j - 1;
  }

  function parseBlock(startIdx: number, endIdx: number, pathPrefix: string[]): void {
    let i = startIdx;
    while (i <= endIdx) {
      const line = lines[i];
      const match = line.match(/\.([a-zA-Z0-9_-]+)\s*\{/);
      if (match) {
        const className = match[1];
        const endLineIdx = findBlockEnd(i);
        const path = pathPrefix.concat(className);
        const pathKey = path.join('.');
        map.set(pathKey, [i + 1, endLineIdx + 1]);
        parseBlock(i + 1, endLineIdx - 1, path);
        i = endLineIdx + 1;
        continue;
      }
      i++;
    }
  }

  parseBlock(0, lines.length - 1, []);
  return map;
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export const defaultRoot: ProjectNode = {
  name: 'root',
  specs: { summary: '', props: {}, events: {} },
  contents: [],
  children: [],
};

/**
 * 从 runtime.jsx 和 style.less 内容构建 project.json 根数组
 * 使用与 transform-umd 相同的 window.Babel，无额外依赖
 */
export function buildProjectJson(runtimeContent: string, styleContent: string): ProjectNode[] {
  if (typeof runtimeContent !== 'string') return [defaultRoot];
  const trimmed = runtimeContent.trim();
  if (!trimmed) return [defaultRoot];

  const win = typeof window !== 'undefined' ? (window as any) : undefined;
  if (!win?.Babel?.transform) {
    console.log('[buildProjectJson] no window.Babel.transform');
    return [defaultRoot];
  }

  const state: CollectorState = {
    importRange: null,
    components: [],
    rootComponent: null,
    functions: [],
    variables: [],
    comRefNames: new Set(),
  };

  try {
    win.Babel.transform(trimmed, {
      presets: [
        ['env', { modules: 'commonjs' }],
        'react',
      ],
      plugins: [
        ['proposal-decorators', { legacy: true }],
        'proposal-class-properties',
        ['transform-typescript', { isTSX: true }],
        createCollectorPlugin(state),
      ],
    });
  } catch (e) {
    console.log('[buildProjectJson] Babel.transform error', e);
    return [defaultRoot];
  }

  const rootMeta = state.rootComponent;
  const allComponents = rootMeta ? [rootMeta, ...state.components] : state.components;
  if (allComponents.length === 0) {
    console.log('[buildProjectJson] no components');
    return [defaultRoot];
  }

  const fnTransitive = transitiveCalls(state.functions);
  /** key = 完整选择器路径（顶层.嵌套.类名），用于按作用域匹配 */
  const lessRangesByPath = parseLessRanges(styleContent || '');

  /** 组件名转为 LESS 选择器 segment：首字母小写（PascalCase -> camelCase） */
  function componentScopeSegment(name: string): string {
    if (!name || name === 'root') return '';
    return name.charAt(0).toLowerCase() + name.slice(1);
  }

  /** 路径列表的最长公共前缀，用于推断组件样式所在的 LESS 作用域 */
  function longestCommonPrefix(paths: string[]): string {
    if (paths.length === 0) return '';
    if (paths.length === 1) return paths[0];
    let prefix = paths[0];
    for (let i = 1; i < paths.length; i++) {
      const p = paths[i];
      while (prefix && !(p === prefix || p.startsWith(prefix + '.'))) {
        const last = prefix.lastIndexOf('.');
        prefix = last >= 0 ? prefix.slice(0, last) : '';
      }
    }
    return prefix;
  }

  /**
   * 根据组件名推断 LESS 作用域前缀：在 pathToRange 中找包含「组件名对应 segment」的路径，取最长公共前缀。
   * 组件可能对应顶层块或嵌套块，均由此推导，不依赖具体业务类名。
   */
  function inferLessScopePrefix(
    componentName: string,
    pathToRange: Map<string, [number, number]>
  ): string {
    const segment = componentScopeSegment(componentName);
    if (!segment) return '';
    const candidatePaths: string[] = [];
    for (const pathKey of pathToRange.keys()) {
      if (pathKey === segment || pathKey.endsWith('.' + segment) || pathKey.includes('.' + segment + '.'))
        candidatePaths.push(pathKey);
    }
    const prefix = longestCommonPrefix(candidatePaths);
    return prefix || segment;
  }

  /**
   * 只取「最顶层」LESS 块的范围：样式有继承关系，必须从上找到最上层整块。
   * 由 inferLessScopePrefix 得到的前缀取首段即顶层块名；root 则用其 cssClasses 中的顶层块。
   */
  function getLessRootBlockRanges(
    meta: ComponentMeta,
    pathToRange: Map<string, [number, number]>
  ): [number, number][] {
    const lessScopePrefix = inferLessScopePrefix(meta.name, pathToRange);
    const rootBlocks: string[] = [];

    if (lessScopePrefix) {
      rootBlocks.push(lessScopePrefix.split('.')[0]);
    } else {
      // root 组件：用到的 class 里属于顶层块（path 无 .）的
      for (const cn of meta.cssClasses) {
        if (pathToRange.has(cn) && cn.indexOf('.') < 0) rootBlocks.push(cn);
      }
    }

    const ranges: [number, number][] = [];
    for (const block of [...new Set(rootBlocks)]) {
      const range = pathToRange.get(block);
      if (range) ranges.push(range);
    }
    return ranges;
  }

  function metaToNode(meta: ComponentMeta): ProjectNode {
    // 本组件自身：定义行 + 用到的函数（含传递闭包）+ 引用的变量；不合并子节点 contents
    const runtimeLocs: [number, number][] = [[meta.startLine, meta.endLine]];
    const addedFns: string[] = [];
    for (const fnName of meta.calledFunctionNames) {
      const deps = fnTransitive.get(fnName);
      if (deps) {
        for (const d of deps) {
          const f = state.functions.find((x) => x.name === d);
          if (f) {
            runtimeLocs.push([f.startLine, f.endLine]);
            addedFns.push(d);
          }
        }
      }
      const f = state.functions.find((x) => x.name === fnName);
      if (f) {
        runtimeLocs.push([f.startLine, f.endLine]);
        addedFns.push(fnName);
      }
    }
    for (const varName of meta.referencedVariableNames || []) {
      const v = state.variables.find((x) => x.name === varName);
      if (v) runtimeLocs.push([v.startLine, v.endLine]);
    }
    const runtimeMerged = mergeRanges(runtimeLocs);

    // LESS 粗暴策略：只取最顶层块整块范围（样式有继承，必须从上找到最上层）
    const styleLocs = getLessRootBlockRanges(meta, lessRangesByPath);
    const styleMerged = mergeRanges(styleLocs);

    const contents: Array<{ path: string; locs: number[][] }> = [];
    if (runtimeMerged.length) contents.push({ path: RUNTIME_PATH, locs: runtimeMerged });
    if (styleMerged.length) contents.push({ path: STYLE_PATH, locs: styleMerged });

    const specs = {
      summary: meta.jsdoc?.summary ?? '',
      props: meta.jsdoc?.props ?? {},
      events: meta.jsdoc?.events ?? {},
    };

    const childNames = [...new Set(meta.childNames)];
    const children = childNames
      .map((name) => allComponents.find((c) => c.name === name))
      .filter(Boolean)
      .map((c) => metaToNode(c!));

    const node: ProjectNode = {
      name: meta.name,
      specs,
      contents,
      children,
    };

    if (meta.name === 'root' && state.importRange) {
      node.commonImports = [{ path: RUNTIME_PATH, locs: [[state.importRange.start, state.importRange.end]] }];
    }
    return node;
  }

  const root = metaToNode(allComponents[0]);
  const hasContent = (root.contents?.length ?? 0) > 0 || (root.children?.length ?? 0) > 0;
  if (!hasContent) return [defaultRoot];
  return [root];
}
