export const replaceNonAlphaNumeric = (string: string, replaceValue: string = "_") => {
  return string.replace(/[^0-9a-zA-Z]/g, replaceValue);
}

/**
 * 将驼峰式命名的字符串转换为连字符分隔的字符串。
 */
export const convertCamelToHyphen = (str: string) => {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

export const convertHyphenToCamel = (str: string) => {
  return str.replace(/-(\w)/g, (match, p1) => p1.toUpperCase());
}
