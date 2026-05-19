/**
 * checkVisibility 兼容补丁（Polyfill）
 *
 * Element.checkVisibility() 是一个较新的 DOM API（Chrome 105+、Firefox 116+），
 * 用于综合判断一个元素是否可见，涵盖 CSS visibility、display、
 * content-visibility 以及 opacity 等多个维度。
 *
 * 本补丁在浏览器原生不支持该方法时，自动挂载到 Element.prototype，
 * 通过向上遍历 DOM 树并调用 getComputedStyle 来模拟等效行为。
 *
 * 规范参考：
 *   https://drafts.csswg.org/cssom-view/#dom-element-checkvisibility
 *
 * 支持的选项（与规范保持一致）：
 *   - checkOpacity          {boolean} – 若元素或祖先的 opacity 计算值为 0，则判定为不可见
 *   - checkVisibilityCSS    {boolean} – 若元素或祖先的 visibility 为 hidden/collapse，则判定为不可见
 *   - contentVisibilityAuto {boolean} – 若元素因 content-visibility:auto 而跳过渲染，则判定为不可见
 *   - opacityProperty       {boolean} – checkOpacity 的新规范别名
 *   - visibilityProperty    {boolean} – checkVisibilityCSS 的新规范别名
 */

/**
 * checkVisibility 方法的可选参数类型定义，镜像自 W3C 规范。
 */
export interface CheckVisibilityOptions {
  /** 若元素或其任意祖先设置了 `opacity: 0`，则返回 false */
  checkOpacity?: boolean;
  /** 若元素或其任意祖先设置了 `visibility: hidden` 或 `visibility: collapse`，则返回 false */
  checkVisibilityCSS?: boolean;
  /**
   * 若元素因 `content-visibility: auto` 被浏览器跳过渲染，则返回 false。
   * 属于尽力而为（best-effort）实现：通过布局尺寸是否为零来近似判断。
   */
  contentVisibilityAuto?: boolean;
  /** checkOpacity 在新版规范中的别名 */
  opacityProperty?: boolean;
  /** checkVisibilityCSS 在新版规范中的别名 */
  visibilityProperty?: boolean;
}

/**
 * 可见性检测的核心逻辑，可直接调用，也可通过 polyfill 间接调用。
 *
 * 算法：从目标元素出发，沿 parentElement 向上遍历到文档根节点，
 * 对每个祖先节点依次检查以下 CSS 条件：
 *   1. display: none         —— 必检，元素从布局中完全移除
 *   2. content-visibility: hidden —— 必检，元素渲染被强制跳过
 *   3. content-visibility: auto  —— 可选，元素可能因离屏被浏览器跳过渲染
 *   4. visibility: hidden/collapse —— 可选（checkVisibilityCSS / visibilityProperty）
 *   5. opacity: 0            —— 可选（checkOpacity / opacityProperty）
 * 任一条件满足即立即返回 false；全部通过则返回 true。
 *
 * @param element  要检测的目标元素
 * @param options  可选的附加检测开关
 * @returns        元素可见返回 `true`，不可见返回 `false`
 */
export function checkVisibility(
  element: Element,
  options: CheckVisibilityOptions = {}
): boolean {
  const {
    checkOpacity = false,
    checkVisibilityCSS = false,
    contentVisibilityAuto = false,
    opacityProperty = false,
    visibilityProperty = false,
  } = options;

  // 合并新旧规范中功能相同的两个选项名
  const checkOp = checkOpacity || opacityProperty;   // 是否检测 opacity
  const checkVis = checkVisibilityCSS || visibilityProperty; // 是否检测 visibility

  // 从目标元素开始，向上逐层检查，直到文档根节点（<html>）为止
  const node: Element | null = element;
  const style = window.getComputedStyle(node);

  // 检测点 1：display: none —— 元素不占据任何空间且完全不可见，必检
  if (style.display === 'none') {
    return false;
  }

  // 检测点 2：content-visibility: hidden —— 浏览器强制跳过该元素的渲染，必检
  if ((style as any).contentVisibility === 'hidden') {
    return false;
  }

  // 检测点 3：content-visibility: auto —— 仅在调用方传入 contentVisibilityAuto 时生效
  // 规范语义：元素"与用户无关"（如完全离屏）时浏览器可跳过其渲染。
  // 由于无法直接查询"是否被跳过"，此处用布局尺寸为零来近似：
  // 当浏览器跳过渲染时，getBoundingClientRect 通常会返回宽高均为 0 的矩形。
  if (
    contentVisibilityAuto &&
    (style as any).contentVisibility === 'auto'
  ) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }
  }

  // 检测点 4：visibility: hidden / collapse —— 元素不可见但仍占据布局空间，可选检测
  if (checkVis) {
    const vis = style.visibility;
    if (vis === 'hidden' || vis === 'collapse') {
      return false;
    }
  }

  // 检测点 5：opacity: 0 —— 元素完全透明，视觉上不可见，可选检测
  if (checkOp) {
    if (parseFloat(style.opacity) === 0) {
      return false;
    }
  }

  // 所有检测均通过，元素可见
  return true;
}
