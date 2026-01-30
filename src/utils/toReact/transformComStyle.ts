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
  const top = marginTop ?? 0;
  const right = marginRight ?? 0;
  const bottom = marginBottom ?? 0;
  const left = marginLeft ?? 0;
  const nonZeroMargins = [
    top && "marginTop",
    right && "marginRight",
    bottom && "marginBottom",
    left && "marginLeft",
  ].filter(Boolean) as string[];
  if (nonZeroMargins.length === 1) {
    const key = nonZeroMargins[0];
    const val = key === "marginTop" ? top : key === "marginRight" ? right : key === "marginBottom" ? bottom : left;
    styleStr += `${key}: '${val}px',`;
  } else if (nonZeroMargins.length > 1) {
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
  
  Object.entries(other).forEach(([key, value]) => {
    styleStr += `${key}: ${typeof value === "number" ? value : `'${value}'`},`;
  });

  if (styleStr) {
    styleStr = `style={{${styleStr}}}`
  }
  return styleStr;
}
