const LAYOUT_IGNORE_PROPS = new Set([
  'block-size', 'inline-size', 'width', 'height', 'display',
  'perspective-origin', 'transform-origin',
  'overflow-block', 'overflow-inline', 'overflow-x', 'overflow-y'
]);

/**
 * 获取元素与同标签默认元素相比不同的计算样式
 * 用于在设置布局时保留容器已有的非默认样式
 */
export function getNonDefaultStyles(element: Element): Record<string, string> {
  const result: Record<string, string> = {};
  const computed = window.getComputedStyle(element);

  const blank = document.createElement(element.tagName);
  blank.style.display = 'none';
  (element.parentNode || document.body).appendChild(blank);
  const defaults = window.getComputedStyle(blank);

  for (let i = 0; i < computed.length; i++) {
    const prop = computed[i];
    if (prop.startsWith('--') || LAYOUT_IGNORE_PROPS.has(prop)) continue;
    const val = computed.getPropertyValue(prop);
    if (val !== defaults.getPropertyValue(prop)) {
      result[prop] = val;
    }
  }

  blank.remove();
  return result;
}

export function getPosition(ele, relativeDom?) {
  const scrollBarTop = document.body.scrollTop || document.documentElement.scrollTop;
  const scrollBarLeft = document.body.scrollLeft || document.documentElement.scrollLeft;

  if (relativeDom) {
    const currPo = ele.getBoundingClientRect()
    const targetPo = relativeDom.getBoundingClientRect()

    return {
      x: currPo.left - targetPo.left + scrollBarLeft,
      y: currPo.top - targetPo.top + scrollBarTop,
      w: ele.offsetWidth,
      h: ele.offsetHeight
    }
  } else {
    const po = ele.getBoundingClientRect()
    return {
      x: po.left + scrollBarLeft,
      y: po.top + scrollBarTop,
      w: ele.offsetWidth,
      h: ele.offsetHeight
    }
  }
}

export function dragable(e, dragingFn, options?) {
  const doc = options?.document || document

  const dom = e.currentTarget, w = dom.offsetWidth, h = dom.offsetHeight,
    relDom = arguments.length == 3 && options && options['relDom'],
    po = getPosition(dom, relDom),
    parentPo = relDom ? getPosition(relDom) : {x: 0, y: 0};

  const scrollBarTop = document.body.scrollTop || document.documentElement.scrollTop;
  const scrollBarLeft = document.body.scrollLeft || document.documentElement.scrollLeft;

  let odx = e.pageX - po.x, ody = e.pageY - po.y;
  let x, y, ex, ey;
  let state;

  if (dragingFn) {
    const handleMouseMove = e => {
      const adx = e.pageX - odx, ady = e.pageY - ody;
      const dx = adx - x, dy = ady - y;
      x = e.pageX - odx;
      y = e.pageY - ody;
      ex = e.pageX - parentPo.x - scrollBarLeft;
      ey = e.pageY - parentPo.y - scrollBarTop;
      if (state === 'finish') {
        dragingFn({
          po: {x, y}, epo: {ex, ey}, dpo: {dx: 0, dy: 0}, adpo: {adx, ady},
          targetStyle: {x: po.x, y: po.y, w, h}
        }, state, dom)
      } else {
        if (dx != 0 || dy != 0) {
          state = state ? 'ing' : 'start';

          dragingFn({
            po: {x, y}, epo: {ex, ey}, dpo: {dx, dy}, adpo: {adx, ady},
            targetStyle: {x: po.x, y: po.y, w, h}
          }, state, dom)
        }
      }
    }

    let moving = false
    doc.onmousemove = e => {
      if (!moving) {
        moving = true
      }
      try {
        handleMouseMove(e)
      } catch (ex) {
        console.error(ex)
      }
    }

    doc.onmouseup = e => {
      state = 'finish'
      handleMouseMove(e)

      doc.onmousemove = null;
      doc.onmouseup = null;
    }
  } else {
    return po;
  }
}
