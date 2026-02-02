interface ComStyle {
  width?: string | number;
  height?: string | number;
  zIndex?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
}

/** 将 top/right/bottom/left 四边值生成为简写的 CSS 样式字符串（如 margin、padding） */
function buildBoxStyle(
  top: number,
  right: number,
  bottom: number,
  left: number,
  prefix: "margin" | "padding"
): string {
  const keys = [`${prefix}Top`, `${prefix}Right`, `${prefix}Bottom`, `${prefix}Left`] as const;
  const values = [top, right, bottom, left];
  const nonZero = keys.filter((_, i) => values[i]) as string[];
  if (nonZero.length === 0) return "";
  if (nonZero.length === 1) {
    const key = nonZero[0];
    const val = values[keys.indexOf(key as (typeof keys)[number])];
    return `${key}: '${val}px',`;
  }
  let value: string;
  if (top === right && right === bottom && bottom === left) {
    value = `${top}px`;
  } else if (top === bottom && right === left) {
    value = `${top}px ${right}px`;
  } else if (right === left) {
    value = `${top}px ${right}px ${bottom}px`;
  } else {
    value = `${top}px ${right}px ${bottom}px ${left}px`;
  }
  return `${prefix}: '${value}',`;
}

export function transformComStyle(style: ComStyle) {
  let styleStr = "";
  const {
    width,
    height,
    zIndex,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    ...other
  } = style;

  if (width !== undefined) {
    styleStr += `width: ${typeof width === "number" ? width : `'${width}'`},`;
  }
  if (height !== undefined) {
    styleStr += `height: ${typeof height === "number" ? height : `'${height}'`},`;
  }
  if (zIndex !== undefined) {
    styleStr += `zIndex: ${zIndex},`;
  }
  styleStr += buildBoxStyle(marginTop ?? 0, marginRight ?? 0, marginBottom ?? 0, marginLeft ?? 0, "margin");
  styleStr += buildBoxStyle(paddingTop ?? 0, paddingRight ?? 0, paddingBottom ?? 0, paddingLeft ?? 0, "padding");

  Object.entries(other).forEach(([key, value]) => {
    styleStr += `${key}: ${typeof value === "number" ? value : `'${value}'`},`;
  });

  if (styleStr) {
    styleStr = `style={{${styleStr}}}`
  }
  return styleStr;
}
