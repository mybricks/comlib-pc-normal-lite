export const replaceNonAlphaNumeric = (string: string, replaceValue: string = "_") => {
  return string.replace(/[^0-9a-zA-Z]/g, replaceValue);
}

export const convertCamelToHyphen = (str: string) => {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

export const convertHyphenToCamel = (str: string) => {
  return str.replace(/-(\w)/g, (match, p1) => p1.toUpperCase());
}
