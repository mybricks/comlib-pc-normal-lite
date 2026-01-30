interface ComStyle {
  width?: string | number;
  height?: string | number;
  zIndex?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
}

export function transformComStyle(style: ComStyle) {
  let styleStr = "";
  const { width, height, zIndex, marginTop, marginRight, marginBottom, marginLeft, ...other } = style;

  if (width !== undefined) {
    styleStr += `width: ${typeof width === "number" ? width : `'${width}'`},`;
  }
  if (height !== undefined) {
    styleStr += `height: ${typeof height === "number" ? height : `'${height}'`},`;
  }
  if (zIndex !== undefined) {
    styleStr += `zIndex: ${zIndex},`;
  }
  const hasMargin =
    marginTop !== undefined ||
    marginRight !== undefined ||
    marginBottom !== undefined ||
    marginLeft !== undefined;
  if (hasMargin) {
    const top = marginTop ?? 0;
    const right = marginRight ?? 0;
    const bottom = marginBottom ?? 0;
    const left = marginLeft ?? 0;
    if (top || right || bottom || left) {
      // CSS margin 简写：1 值全同；2 值 上下/左右；3 值 上/左右/下；4 值 上/右/下/左
      let marginValue: string;
      if (top === right && right === bottom && bottom === left) {
        marginValue = `${top}px`;
      } else if (top === bottom && right === left) {
        marginValue = `${top}px ${right}px`;
      } else if (right === left) {
        marginValue = `${top}px ${right}px ${bottom}px`;
      } else {
        marginValue = `${top}px ${right}px ${bottom}px ${left}px`;
      }
      styleStr += `margin: '${marginValue}',`;
    }
  }
  
  Object.entries(other).forEach(([key, value]) => {
    styleStr += `${key}: ${typeof value === "number" ? value : `'${value}'`},`;
  });

  if (styleStr) {
    styleStr = `style={{${styleStr}}}`
  }
  return styleStr;
}
