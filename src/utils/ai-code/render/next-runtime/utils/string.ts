const replaceToUnderline = (str: string) => {
  // 正则含义：匹配 非(数字/大小写字母/下划线) 的所有字符
  // [^0-9a-zA-Z_] = 不是这些的字符
  // g = 全局匹配，替换所有符合条件的字符
  return str.replace(/[^0-9a-zA-Z_]/g, '_')
}

export { replaceToUnderline }
