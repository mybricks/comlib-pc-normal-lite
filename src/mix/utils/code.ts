/**
 * 执行已编译的配置 JS 字符串，返回其 export default 的值。
 * 编译产物中的 `export default` 会被替换为赋值语句后 eval 执行。
 */
export function evalConfigJsCompiled(code: string) {
  const evalStr = `
    let result;
    ${code.replace('export default', 'result =')};
    result;
  `;
  try {
    return eval(evalStr);
  } catch (error) {
    // console.error('eval执行失败：', error);
    return null;
  }
}

/**
 * 检测 JSON 字符串使用的缩进字符（空格数或 tab），
 * 用于序列化时保持原始格式一致。
 */
export function detectJsonIndent(jsonStr: string): string | number {
  const match = jsonStr.match(/\n([ \t]+)/);
  if (match) return match[1];
  return 2;
}
