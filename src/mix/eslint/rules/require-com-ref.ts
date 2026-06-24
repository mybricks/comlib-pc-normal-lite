import type { LintMessage } from '../types';

export const RULE_ID = 'require-com-ref';

/**
 * 检测 JSX 文件中所有「组件声明」是否均使用 comRef()/popupRef() 包裹。
 *
 * ─── 会触发报错的形态 ────────────────────────────────────────────────────────
 *
 *  【export default 直接导出函数组件】
 *   export default () => { return <div /> }               ← 箭头函数，block body
 *   export default function() { return <div /> }          ← 匿名函数声明
 *   export default function Foo() { return <div /> }      ← 命名函数声明
 *   export default () => <div />                          ← 箭头函数简写体，直接返回 JSXElement
 *   export default () => <></>                            ← 箭头函数简写体，直接返回 JSXFragment
 *
 *  【const/let/var 变量声明函数组件】（不区分 kind）
 *   const Foo = () => { return <div /> }                  ← 箭头函数
 *   const Foo = function() { return <div /> }             ← 函数表达式
 *   const Foo = () => <div />                             ← 箭头函数简写体
 *   let/var Foo = () => <div />                           ← let/var 同样触发
 *
 *  【函数体中"间接 JSX 返回"（通过 nodeContainsJSX 递归）】
 *   return flag ? <A /> : <B />                           ← 条件表达式
 *   return flag && <A />                                  ← 逻辑表达式
 *   return (<div />)                                      ← 括号表达式
 *   if (x) { return <A /> } else { return <B /> }        ← if/else 分支
 *   { return <div /> }                                    ← 嵌套 BlockStatement
 *
 * ─── 不会触发（豁免）的形态 ──────────────────────────────────────────────────
 *
 *  【已用 ref 包裹】
 *   export default comRef(() => <div />)                  ← comRef 调用
 *   export default popupRef(() => <div />)                ← popupRef 调用
 *   export default appRef(() => <div />)                  ← appRef 调用
 *   const Foo = comRef/popupRef/appRef(() => <div />)     ← 变量声明同上
 *
 *  【文件类型】
 *   .ts / .js 等非 JSX 文件                              ← 整个规则直接跳过
 *
 *  【非函数值】
 *   export default { a: 1 }                              ← 对象/字面量/标识符等
 *   const config = { name: 'x' }                         ← 变量初始值为非函数
 *
 *  【纯工具函数（无 JSX 返回）】
 *   const helper = () => { return { a: 1 } }             ← 返回非 JSX 值
 *   const handler = function(e) { console.log(e) }       ← 无返回 JSX
 *
 *  【内层嵌套函数含 JSX，外层无 JSX return（不穿透）】
 *   const Foo = () => {
 *     const renderItem = () => <div />   ← 内层函数含 JSX
 *     return renderItem                  ← 外层 return 不是 JSX → 不触发
 *   }
 *
 *  【当前实现盲区（try / switch / for 内的 JSX return）】
 *   const Foo = () => { try { return <div /> } catch(e) {} }   ← TryStatement 未处理
 *   const Foo = () => { switch(x) { case 1: return <A /> } }   ← SwitchStatement 未处理
 *   // blockContainsJSXReturn 仅递归 IfStatement 和 BlockStatement
 *
 * @returns { plugin, getMessages } plugin 注入 Babel，getMessages 在 transform 后读取
 */
export function createRequireComRefRule(fileName?: string): {
  plugin: (babel: any) => { visitor: Record<string, any> };
  getMessages: () => LintMessage[];
} {
  const messages: LintMessage[] = [];

  // 只校验 .tsx / .jsx 文件，其他文件（.ts/.js 等）直接跳过
  const shouldSkip = !(typeof fileName === 'string' && /\.(tsx|jsx)$/.test(fileName));

  function plugin(_babel: any) {
    return {
      visitor: {
        // 处理 export default (() => { ... }) 形式
        ExportDefaultDeclaration(path: any) {
          if (shouldSkip) return;

          const decl = path.node.declaration;
          if (!decl) return;

          // 已经是 comRef/popupRef/appRef 调用 → 跳过
          if (isRefCall(decl)) return;

          // 匿名箭头函数 / 普通函数声明 / 函数表达式
          if (isFunctionNode(decl)) {
            if (functionBodyContainsJSX(decl)) {
              const loc = path.node.loc;
              messages.push({
                ruleId: RULE_ID,
                severity: 2,
                message:
                  '[组件规范] export default 导出的函数组件必须使用 comRef() 或 popupRef() 包裹，例如：export default comRef(() => { ... })',
                line: loc?.start?.line ?? 1,
                column: loc?.start?.column ?? 0,
                endLine: loc?.end?.line,
                endColumn: loc?.end?.column,
                nodeType: 'ExportDefaultDeclaration',
              });
            }
            return;
          }
        },

        // 处理 const Foo = (...) => / const Foo = function(...) 形式
        VariableDeclaration(path: any) {
          if (shouldSkip) return;

          for (const declarator of path.node.declarations ?? []) {
            const init = declarator.init;
            if (!init) continue;

            // 已经是 comRef/popupRef/appRef 调用 → 跳过
            if (isRefCall(init)) continue;

            // 箭头函数 / 函数表达式
            if (isFunctionNode(init)) {
              if (functionBodyContainsJSX(init)) {
                const loc = declarator.loc;
                const name: string = declarator.id?.name ?? '(anonymous)';
                messages.push({
                  ruleId: RULE_ID,
                  severity: 2,
                  message:
                    `[组件规范] "${name}" 返回了 JSX，已被识别为 React 组件，但必须用 comRef() 或 popupRef() 包裹才能正常注册。请将声明改为：const ${name} = comRef(() => { ... }) 或 const ${name} = popupRef(() => { ... })，函数体内容保持不变。`,
                  line: loc?.start?.line ?? 1,
                  column: loc?.start?.column ?? 0,
                  endLine: loc?.end?.line,
                  endColumn: loc?.end?.column,
                  nodeType: 'VariableDeclarator',
                });
              }
            }
          }
        },
      },
    };
  }

  return { plugin, getMessages: () => messages };
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

/** 判断节点是否为 comRef / popupRef / appRef 调用 */
function isRefCall(node: any): boolean {
  if (!node || node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (!callee) return false;

  // 直接调用：comRef(...) / popupRef(...) / appRef(...)
  if (callee.type === 'Identifier') {
    return ['comRef', 'popupRef', 'appRef'].includes(callee.name);
  }

  // 成员调用：React.memo(comRef(...)) 等内层不归这里，外层 callee 直接是 Identifier 即可
  return false;
}

/** 判断节点是否为函数节点（箭头函数 or 函数表达式 or 函数声明） */
function isFunctionNode(node: any): boolean {
  return (
    node?.type === 'ArrowFunctionExpression' ||
    node?.type === 'FunctionExpression' ||
    node?.type === 'FunctionDeclaration'
  );
}

/** 递归检测函数体（包括嵌套箭头函数的表达式体）是否含有 JSX 返回值 */
function functionBodyContainsJSX(fn: any): boolean {
  const body = fn?.body;
  if (!body) return false;

  // 箭头函数简写体：() => <div>...</div>
  if (
    body.type === 'JSXElement' ||
    body.type === 'JSXFragment'
  ) {
    return true;
  }

  // BlockStatement：搜索 return <JSX>
  if (body.type === 'BlockStatement') {
    return blockContainsJSXReturn(body.body ?? []);
  }

  return false;
}

/** 在语句数组里递归查找包含 JSX 的 return */
function blockContainsJSXReturn(stmts: any[]): boolean {
  for (const stmt of stmts) {
    if (!stmt) continue;

    if (stmt.type === 'ReturnStatement') {
      if (nodeContainsJSX(stmt.argument)) return true;
    }

    // if/else/try 等块内也检查
    if (stmt.type === 'IfStatement') {
      if (
        blockContainsJSXReturn(toStmts(stmt.consequent)) ||
        blockContainsJSXReturn(toStmts(stmt.alternate))
      ) {
        return true;
      }
    }

    if (stmt.type === 'BlockStatement') {
      if (blockContainsJSXReturn(stmt.body ?? [])) return true;
    }
  }
  return false;
}

function toStmts(node: any): any[] {
  if (!node) return [];
  if (node.type === 'BlockStatement') return node.body ?? [];
  return [node];
}

/** 判断表达式节点（或其嵌套）是否是/包含 JSX */
function nodeContainsJSX(node: any): boolean {
  if (!node) return false;
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true;
  // 括号表达式
  if (node.type === 'ParenthesizedExpression') return nodeContainsJSX(node.expression);
  // 条件表达式：expr ? <A/> : <B/>
  if (node.type === 'ConditionalExpression') {
    return nodeContainsJSX(node.consequent) || nodeContainsJSX(node.alternate);
  }
  // 逻辑表达式：flag && <A/>
  if (node.type === 'LogicalExpression') {
    return nodeContainsJSX(node.left) || nodeContainsJSX(node.right);
  }
  return false;
}
