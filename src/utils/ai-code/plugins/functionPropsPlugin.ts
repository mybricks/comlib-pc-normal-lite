/**
 * Babel 插件：只处理以下两类函数的第一个参数，将其替换为 _mybricks_props：
 *
 * 1. React 函数组件（函数名/变量名首字母大写）
 * 2. 被 appRef、comRef、popupRef 包裹的组件
 *
 * 例如：
 *   appRef(() => { return <div/> })        → 会处理
 *   comRef(({ name }) => { return <div/> }) → 会处理
 *   popupRef((props) => { return <div/> })  → 会处理
 *   function App(props) { return <div/> }   → 会处理（首字母大写）
 *   const handleClick = (e) => {}           → 不处理（首字母小写、无 ref 包裹）
 *
 * 处理三种参数情况：
 * 1. 解构参数：({ name, age }) => {} → (_mybricks_props) => { const { name, age } = _mybricks_props; ... }
 * 2. 无参数：() => {} → (_mybricks_props) => {}
 * 3. 具名参数：(props) => { props.name } → (_mybricks_props) => { _mybricks_props.name }
 */

const PROPS_PARAM_NAME = '_mybricks_props';
const REF_NAMES = ['appRef', 'comRef', 'popupRef'];

/**
 * 判断 callee 是否是 appRef/comRef/popupRef 的调用
 */
function isRefCall(callee: any): boolean {
  if (callee.type === 'Identifier') return REF_NAMES.includes(callee.name);
  if (callee.type === 'MemberExpression') return REF_NAMES.includes(callee.property?.name);
  return false;
}

/**
 * 判断名称是否是 React 组件名（首字母大写）
 */
function isReactComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

/**
 * 判断当前函数节点是否应该被处理：
 * - 被 appRef/comRef/popupRef 包裹（作为其第一个参数）
 * - 是 React 函数组件（首字母大写的函数名/变量名）
 */
function shouldTransform(path: any): boolean {
  const parent = path.parent;

  // 情况1：函数是 ref(...) 的第一个参数
  // ArrowFunctionExpression / FunctionExpression 作为 CallExpression 的 arguments[0]
  if (
    parent.type === 'CallExpression' &&
    parent.arguments[0] === path.node &&
    isRefCall(parent.callee)
  ) {
    return true;
  }

  // 情况2：React 函数组件 —— FunctionDeclaration 首字母大写
  if (path.type === 'FunctionDeclaration' && path.node.id?.name) {
    return isReactComponentName(path.node.id.name);
  }

  // 情况3：React 函数组件 —— const Xxx = function/箭头函数
  if (parent.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
    return isReactComponentName(parent.id.name);
  }

  // 情况4：export default function Xxx  —— 首字母大写
  if (
    parent.type === 'ExportDefaultDeclaration' &&
    path.node.id?.name
  ) {
    return isReactComponentName(path.node.id.name);
  }

  return false;
}

/**
 * 创建 `const { ... } = _mybricks_props;` 声明节点
 */
function buildDestructureDeclaration(properties: any[], t: any): any {
  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.objectPattern(properties),
      t.identifier(PROPS_PARAM_NAME)
    ),
  ]);
}

/**
 * 处理函数参数并在函数体开头插入解构声明（如需要）
 */
function transformFunctionParams(funcNode: any, t: any): void {
  const params: any[] = funcNode.params;

  if (params.length === 0) {
    // 情况2：无参数，直接注入 _mybricks_props
    funcNode.params = [t.identifier(PROPS_PARAM_NAME)];
    return;
  }

  const firstParam = params[0];
  const restParams = params.slice(1); // 保留除第一个参数外的其他参数

  if (firstParam.type === 'ObjectPattern') {
    // 情况1：解构参数 ({ name, age }) => {}
    const properties = firstParam.properties;
    funcNode.params = [t.identifier(PROPS_PARAM_NAME), ...restParams];

    // 在函数体首部插入 const { name, age } = _mybricks_props;
    const body = funcNode.body;
    if (body?.type === 'BlockStatement') {
      body.body.unshift(buildDestructureDeclaration(properties, t));
    }
  } else if (firstParam.type === 'Identifier') {
    // 情况3：具名参数 (props) => {}
    const originalName: string = firstParam.name;
    if (originalName === PROPS_PARAM_NAME) return; // 已经是目标名称，无需处理

    // 将参数名替换为 _mybricks_props，其他参数保持不变
    funcNode.params = [t.identifier(PROPS_PARAM_NAME), ...restParams];

    // 函数体内所有对旧参数名的引用都会由 Scope rename 处理（见下方 visitor）
    funcNode.__propsRename__ = { from: originalName, to: PROPS_PARAM_NAME };
  }
}

/**
 * 对符合条件的 path 执行 transform + rename
 */
function processPath(path: any): void {
  if (!shouldTransform(path)) return;

  transformFunctionParams(path.node, path.t);

  const rename = path.node.__propsRename__;
  if (rename) {
    delete path.node.__propsRename__;
    const binding = path.scope.getBinding(rename.from);
    if (binding) {
      path.scope.rename(rename.from, rename.to);
    }
  }
}

export default function functionPropsPlugin() {
  return function ({ types: t }: { types: any }) {
    return {
      visitor: {
        ArrowFunctionExpression(path: any) {
          try {
            // 注入 t 到 path 上，供 processPath 使用
            path.t = t;
            processPath(path);
          } catch (error) {
            console.error('[functionPropsPlugin]', error);
          }
        },

        FunctionDeclaration(path: any) {
          try {
            path.t = t;
            processPath(path);
          } catch (error) {
            console.error('[functionPropsPlugin]', error);
          }
        },

        FunctionExpression(path: any) {
          try {
            path.t = t;
            processPath(path);
          } catch (error) {
            console.error('[functionPropsPlugin]', error);
          }
        },
      },
    };
  };
}