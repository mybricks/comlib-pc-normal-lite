/**
 * Babel 插件：将 process.env.xxxx ? A : 'B' 替换为 'B'
 * 
 * 原理：
 * 1. 遍历 ConditionalExpression 节点（三元表达式）
 * 2. 检测 test 部分是否为 process.env.xxx 形式
 * 3. 如果是，用 alternate（false 分支）替换整个表达式
 * 4. 生成替换后的代码
 */

/**
 * 判断节点是否为 process.env.xxx 形式
 */
function isProcessEnvMemberExpression(node: any): boolean {
  if (node?.type !== 'MemberExpression') return false;
  
  // 检查 process.env
  const obj = node.object;
  if (obj?.type !== 'MemberExpression') return false;
  if (obj.object?.type !== 'Identifier' || obj.object.name !== 'process') return false;
  if (obj.property?.type !== 'Identifier' || obj.property.name !== 'env') return false;
  
  // 检查 xxx 属性
  const prop = node.property;
  return prop?.type === 'Identifier' && typeof prop.name === 'string';
}

/**
 * 处理 process.env 条件表达式的转换
 * @param code 源代码
 * @returns 转换后的代码
 */
export function transformProcessEnv(code: string): string {
  const Babel = (window as any).Babel;
  if (!Babel) {
    throw new Error('window.Babel 未就绪，请先加载 Babel 编译器');
  }

  // 解析代码为 AST
  const ast = Babel.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });

  // 创建 Babel 插件
  const plugin = () => ({
    visitor: {
      ConditionalExpression(path: any) {
        const { test, alternate } = path.node;
        
        // 检测 test 是否为 process.env.xxx
        if (isProcessEnvMemberExpression(test)) {
          // 用 alternate（false 分支）替换整个条件表达式
          path.replaceWith(alternate);
        }
      },
    },
  });

  // 转换 AST 并生成代码
  const result = Babel.transformFromAst(ast, code, {
    plugins: [plugin],
    code: true,
    ast: false,
  });

  return result.code;
}

/**
 * 批量处理多个文件中的 process.env 条件表达式
 * @param files 文件映射 { fileName: code }
 * @returns 处理后的文件映射
 */
export function transformProcessEnvBatch(files: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  
  for (const [fileName, code] of Object.entries(files)) {
    try {
      result[fileName] = transformProcessEnv(code);
    } catch (error) {
      // console.error(`[transformProcessEnvBatch] 处理文件 ${fileName} 失败:`, error);
      result[fileName] = code; // 失败时保留原代码
    }
  }
  
  return result;
}

/**
 * 创建可复用的 Babel 插件（用于注入到 transformTsx 的 plugins 数组中）
 */
export default function processEnvPlugin() {
  return function () {
    return {
      visitor: {
        ConditionalExpression(path: any) {
          const { test, alternate } = path.node;
          
          if (isProcessEnvMemberExpression(test)) {
            path.replaceWith(alternate);
          }
        },
      },
    };
  };
}

// 使用示例：
// 
// // 方式1：单独使用
// const code = `
//   const a = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
//   const b = process.env.DEBUG ? debug() : 'production';
// `;
// const result = transformProcessEnv(code);
// console.log(result);
// // 输出：
// // const a = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';  // 不符合 process.env.xxx ? A : B 模式，不处理
// // const b = 'production';  // 符合条件，替换为 'B'
//
// // 方式2：作为 Babel 插件注入到 transformTsx
// import processEnvPlugin from './processEnvPlugin';
// 
// const options = {
//   presets: [...],
//   plugins: [
//     ...,
//     processEnvPlugin(),  // 注入插件
//   ],
// };
// const result = window.Babel.transform(code, options);
