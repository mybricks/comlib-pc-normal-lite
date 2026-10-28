/**
 * 读取本地图片文件，按元素当前布局宽度和图片比例计算 CSS 宽高，返回像素数值。
 * 不修改元素；加载失败或尺寸无效时返回 null，测量及加载异常由调用方处理。
 */
export async function getImageSizeAtElementWidth(
  ele: HTMLElement,
  file: File,
): Promise<{ width: number; height: number } | null> {
  // 使用未受画布缩放影响的布局宽度；border-box 下按图片内容区计算比例。
  const computedStyle = getComputedStyle(ele);
  const width = parseFloat(computedStyle.width);
  const horizontalBox = computedStyle.boxSizing === 'border-box'
    ? ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
      .reduce((sum, key) => sum + parseFloat(computedStyle[key]), 0)
    : 0;
  const verticalBox = computedStyle.boxSizing === 'border-box'
    ? ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((sum, key) => sum + parseFloat(computedStyle[key]), 0)
    : 0;
  if (Number.isFinite(width) && width > horizontalBox) {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    let image: HTMLImageElement | null;
    try {
      image = await new Promise<HTMLImageElement | null>(resolve => {
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = objectUrl;
      });
    } finally {
      img.onload = null;
      img.onerror = null;
      URL.revokeObjectURL(objectUrl);
    }
    if (image?.naturalWidth && image.naturalHeight) {
      const height = (width - horizontalBox) * image.naturalHeight / image.naturalWidth + verticalBox;
      if (Number.isFinite(height) && height > 0) {
        return { width, height };
      }
    }
  }
  return null;
}
