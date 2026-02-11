
const SPA_DESIGNER_VERSION = (window as any).mybricks?.version;

const isSmallVersion = (a, b) => {
  if (typeof a !== 'string' || a.split('.').length < 3) {
    return true
  }

  // 将版本号字符串分割成数组
  const versionA = a.split('.').map(Number);
  const versionB = b.split('.').map(Number);

  // 依次比较每一位
  for (let i = 0; i < 3; i++) {
    if (versionA[i] < versionB[i]) {
      return true;
    }
    if (versionA[i] > versionB[i]) {
      return false;
    }
  }

  // 如果所有位都相等，返回false
  return false;
};

export const getStyleOptions = (options) => {
  if (isSmallVersion(SPA_DESIGNER_VERSION, '3.9.113')) { // 小于这个版本的话style编辑器没支持自动判断选项的能力
    return options
  }
  return
}