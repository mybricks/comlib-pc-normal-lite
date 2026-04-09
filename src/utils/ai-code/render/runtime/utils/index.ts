const replaceToUnderline = (str: string) => {
  // 正则含义：匹配 非(数字/大小写字母/下划线) 的所有字符
  // [^0-9a-zA-Z_] = 不是这些的字符
  // g = 全局匹配，替换所有符合条件的字符
  return str.replace(/[^0-9a-zA-Z_]/g, '_');
}

// 解析less文件内:frame数据
const parseFrameSize = (lessCode: string): { width: string | null; height: string | null } => {
  const frameMatch = lessCode.match(/:frame\s*\{([^}]*)\}/);
  if (!frameMatch) return { width: null, height: null };
  
  const block = frameMatch[1];
  const width = block.match(/width\s*:\s*([^;]+)/)?.[1]?.trim() ?? null;
  const height = block.match(/height\s*:\s*([^;]+)/)?.[1]?.trim() ?? null;
  
  return { width, height };
}

export { replaceToUnderline, parseFrameSize }
