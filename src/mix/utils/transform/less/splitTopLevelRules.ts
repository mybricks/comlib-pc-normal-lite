/**
 * 失败恢复只按第一层规则分块，@media 等嵌套作用域作为整体处理。
 * 不能按换行或 `}` 切：压缩 CSS 没有换行，content: "}"、url(data:...)、
 * 注释、转义选择器和 @{name} 中的花括号也不是规则边界。
 * 边界不完整或存在顶层语句（变量、@import 等）时返回 null，保留原文件。
 */
export function splitTopLevelRules(code: string): string[] | null {
  const blocks: string[] = [];
  const stack: Array<{ close: string; block?: boolean; url?: boolean }> = [];
  let start = 0;
  let quote = "";

  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
      else if (quote !== "`" && /[\n\r\f]/.test(char)) return null;
      continue;
    }
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    const top = stack[stack.length - 1];
    if (top?.url) {
      if (char === ")") stack.pop();
      continue;
    }
    if (char === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end === -1) return null;
      if (start === i) start = end + 2;
      i = end + 1;
      continue;
    }
    if (char === "/" && code[i + 1] === "/") {
      let end = i + 2;
      while (end < code.length && code[end] !== "\n" && code[end] !== "\r") end++;
      if (start === i) start = end;
      i = end - 1;
      continue;
    }
    if (start === i && /\s/.test(char)) {
      start++;
      continue;
    }
    // 嵌套 @import 也不能重放，避免恢复时重复触发异步加载。
    if (char === "@" && /^@import\b/i.test(code.slice(i, i + 8))) return null;
    if ((char === "@" || char === "$") && code[i + 1] === "{") {
      stack.push({ close: "}" });
      i++;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      stack.push({
        close: char === "(" ? ")" : char === "[" ? "]" : "}",
        block: char === "{",
        url: char === "(" && /(?:^|[^\w-])url$/i.test(code.slice(Math.max(0, i - 4), i)),
      });
    } else if (char === ")" || char === "]" || char === "}") {
      if (!top || top.close !== char) return null;
      stack.pop();
      if (!stack.length && top.block) {
        blocks.push(code.slice(start, i + 1));
        start = i + 1;
      }
    } else if (char === ";" && !stack.length) {
      return null;
    }
  }
  return quote || stack.length || code.slice(start).trim() ? null : blocks;
}
