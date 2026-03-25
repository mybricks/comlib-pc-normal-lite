/**
 * dom-to-json.js — 浏览器内执行，从 Shadow DOM 画布生成 MyBricks-Figma 用 JSON。
 *
 * 入口:
 *   domToMybricksJson(frameId, styleTagId?) — 按画布容器 id 导出
 *   comToMybricksJson(comId) — 按组件 id 导出：从 #comId 向上找 class artboard- 开头的祖先，取其 id 作为 frameId，styleTagId 用 comId
 * 转换规则: gap→itemSpacing；linear-gradient→fills；class selection- 过滤；
 *          frame 标题取自 boardTitle- 下 tt- 文本；SVG path 空格规范化；text-align start/end→LEFT/RIGHT；
 *          grid 的 grid-template-columns 解析为 layoutGridColumns，并设 layoutWrap: WRAP 以启用 Figma 自动换行，row-gap→counterAxisSpacing。
 */
var SHADOW_HOST_ID = '_mybricks-geo-webview_';
var GEOVIEW_WRAPPER_ID = '_geoview-wrapper_';

/**
 * 从 id=_geoview-wrapper_ 的节点上读取 transform: scale(n)，并返回设计稿坐标系参数。
 * 该节点通常包在画布外层，getBoundingClientRect() 得到的是缩放后的视口坐标，需换算成设计稿坐标。
 * @param {Document|ShadowRoot} [searchRoot] - 可选，先在此内查 #_geoview-wrapper_，没有再在 document 查
 * @returns {{ scale: number, originLeft: number, originTop: number }}
 */
function getGeoviewScaleAndOrigin(searchRoot) {
  var wrapper = null;
  if (searchRoot && searchRoot.querySelector) {
    try {
      wrapper = searchRoot.querySelector('#' + CSS.escape(GEOVIEW_WRAPPER_ID));
    } catch (_) {}
  }
  if (!wrapper && typeof document !== 'undefined') {
    try {
      wrapper = document.getElementById(GEOVIEW_WRAPPER_ID);
    } catch (_) {}
  }
  if (!wrapper) return { scale: 1, originLeft: 0, originTop: 0 };
  var computed = window.getComputedStyle(wrapper);
  var transform = computed && computed.transform ? computed.transform : '';
  var scale = 1;
  if (transform && transform !== 'none') {
    var m = transform.match(/matrix\(([^)]+)\)/);
    if (m) {
      var parts = m[1].split(',').map(function (s) { return parseFloat(s.trim()); });
      if (parts.length >= 4) scale = parts[0];
      if (scale <= 0 || !Number.isFinite(scale)) scale = 1;
    }
  }
  var r = wrapper.getBoundingClientRect();
  return { scale: scale, originLeft: r.left, originTop: r.top };
}

/**
 * 封装 getBoundingClientRect：返回「设计稿坐标」下的 rect（受 _geoview-wrapper_ 的 scale 影响时自动除以 scale）。
 * @param {Element|DOMRect|{ left: number, top: number, right?: number, bottom?: number, width?: number, height?: number }} elOrRect - 元素或视口 rect 对象
 * @param {{ scale: number, originLeft: number, originTop: number }} geo - 来自 getGeoviewScaleAndOrigin()
 * @returns {{ left: number, top: number, right: number, bottom: number, width: number, height: number }}
 */
function getDesignRect(elOrRect, geo) {
  var r;
  if (elOrRect && typeof elOrRect.getBoundingClientRect === 'function') {
    r = elOrRect.getBoundingClientRect();
  } else if (elOrRect && typeof elOrRect.left === 'number' && typeof elOrRect.top === 'number') {
    r = elOrRect;
  } else {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  var s = geo.scale || 1;
  var oL = geo.originLeft || 0;
  var oT = geo.originTop || 0;
  return {
    left: (r.left - oL) / s,
    top: (r.top - oT) / s,
    right: (r.right - oL) / s,
    bottom: (r.bottom - oT) / s,
    width: (r.width || r.right - r.left) / s,
    height: (r.height || r.bottom - r.top) / s
  };
}

/** 元素是否有任意 class 以 prefix 开头 */
function hasClassPrefix(el, prefix) {
  if (!el.className || typeof el.className !== 'string') return false;
  return el.className.trim().split(/\s+/).some(function (c) { return c.indexOf(prefix) === 0; });
}

/** 判断元素是否匹配单个选择器（支持 .class、#id、tag、.a.b、div.foo 等，不含组合符） */
function simpleSelectorMatches(el, sel) {
  var s = sel.trim();
  if (!s) return false;
  if (s.indexOf(',') >= 0) {
    var parts = s.split(',');
    for (var i = 0; i < parts.length; i++) if (simpleSelectorMatches(el, parts[i].trim())) return true;
    return false;
  }
  var tagPart = s.match(/^([a-zA-Z][\w-]*)/);
  if (tagPart && (el.tagName || '').toLowerCase() !== tagPart[1].toLowerCase()) return false;
  var idM = s.match(/#([\w-]+)/);
  if (idM && el.id !== idM[1]) return false;
  var classParts = s.match(/\.[\w-]+/g);
  if (classParts) {
    for (var j = 0; j < classParts.length; j++) {
      if (!el.classList || !el.classList.contains(classParts[j].slice(1))) return false;
    }
  }
  return true;
}

/** 从 style 标签里收集匹配当前元素的所有 selector 字符串（用于挂到节点额外信息） */
function getMatchedSelectorsForElement(el, cssRuleMap) {
  if (!el || !cssRuleMap || typeof el.matches !== 'function') return [];
  var out = [];
  for (var selector in cssRuleMap) {
    try {
      if (el.matches(selector)) out.push(selector);
    } catch (_) {}
  }
  return out;
}

/** 从 style 标签规则里收集匹配当前元素的所有声明（后匹配的覆盖前面的）
 *
 * 修复：优先用 el.matches(selector)（支持后代/多类等所有 CSS 选择器）；
 * 仅在 el.matches 不可用时降级到 simpleSelectorMatches。
 * 原先只用 simpleSelectorMatches 无法处理 .a.b、.parent .child 等复合选择器，
 * 导致 ant-pagination 等多类节点的 align-items: center 读不到。
 */
function getDeclaredStyleForElement(el, cssRuleMap) {
  var declared = {};
  var canUseMatches = el && typeof el.matches === 'function';
  for (var selector in cssRuleMap) {
    var matched = false;
    if (canUseMatches) {
      try { matched = el.matches(selector); } catch (_) { matched = simpleSelectorMatches(el, selector); }
    } else {
      matched = simpleSelectorMatches(el, selector);
    }
    if (!matched) continue;
    var cssText = cssRuleMap[selector];
    if (!cssText) continue;
    var parts = cssText.split(';');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      var colon = part.indexOf(':');
      if (colon <= 0) continue;
      var key = part.slice(0, colon).trim();
      var val = part.slice(colon + 1).trim().replace(/\s*!important\s*$/i, '');
      if (key) declared[key] = val;
    }
  }
  return declared;
}

/** 从 frame 的 DOM 中取标题：子元素 class 以 boardTitle- 开头，其下 class 以 tt- 开头的元素文本 */
function getFrameTitleFromElement(el) {
  if (!el || !el.children) return '';
  for (var i = 0; i < el.children.length; i++) {
    var child = el.children[i];
    if (!hasClassPrefix(child, 'boardTitle-')) continue;
    var tt = child.querySelector('[class^="tt-"], [class*=" tt-"]');
    if (tt) return (tt.textContent || '').trim();
  }
  return '';
}

/**
 * 将 SVG path 的 d 规范为 Figma 要求：命令与数字之间用空格分隔。
 * Figma 报 "Invalid command at M14" 是因为 d 里常有 "M14" 这种无空格写法。
 */
function normalizeSvgPathForFigma(d) {
  if (!d || typeof d !== 'string') return '';
  return d
    .replace(/,/g, ' ')
    // 命令字母（大写和小写）与数字之间加空格
    .replace(/([MmLlCcQqSsAaZzHhVvTt])([-\d.])/g, '$1 $2')
    .replace(/([\d.])([MmLlCcQqSsAaZzHhVvTt])/g, '$1 $2')
    // 数字紧跟负号（如 10-5 → 10 -5）
    .replace(/(\d)(-)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解析 CSS background-image 中的 url(...) → 提取出的 URL 字符串，用于导出为图片 fill。
 */
function parseUrlFromBgImage(bgImage) {
  if (!bgImage || typeof bgImage !== 'string') return null;
  var m = bgImage.trim().match(/url\s*\(\s*['"]?([^'")\s]+)['"]?\s*\)/);
  return m ? m[1].trim() : null;
}

/**
 * 解析 CSS background-image 中的 linear-gradient → { type: 'GRADIENT_LINEAR', gradientStops, angle }。
 *
 * 修复 1（正则不够宽松）：原正则 /linear-gradient\s*\(\s*([\d.]+)?deg\s*,\s*(.+)\)/ 只能匹配
 *   Ndeg 形式，无法处理 "to right"/"to bottom right" 等 CSS 方向关键字写法，导致 computed 值里
 *   出现方向关键字时 gradientFill 返回 null，渐变丢失。
 *   修复：改用逐字符括号匹配提取括号内完整内容，再分别处理角度和色标。
 *
 * 修复 2（色标 split 切断 rgba）：原来用 /\s*,\s*(?=#|rgb)/ 分割色标，但 rgba(255,0,0,0.5) 里
 *   的逗号也满足 (?=rgb) 前面是 0 的条件，会把 rgba 切断为碎片，导致 cssColorToRgba 无法解析，
 *   stops < 2，gradientFill 为 null。
 *   修复：改为逐字符扫描，遇到括号内的逗号不拆分，只在括号外的逗号处分割色标。
 */
function parseLinearGradientFromBgImage(bgImage) {
  if (!bgImage || typeof bgImage !== 'string') return null;
  var str = bgImage.trim();
  // 找到 linear-gradient( 的起始位置
  var idx = str.indexOf('linear-gradient');
  if (idx < 0) return null;
  // 逐字符提取括号内全部内容
  var start = str.indexOf('(', idx);
  if (start < 0) return null;
  var depth = 0;
  var end = -1;
  for (var i = start; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  var inner = str.slice(start + 1, end).trim();

  // 按括号感知的逗号分割，括号内的逗号不分割
  function splitTopLevel(s) {
    var parts = [];
    var cur = '';
    var d = 0;
    for (var j = 0; j < s.length; j++) {
      var ch = s[j];
      if (ch === '(' || ch === '[') { d++; cur += ch; }
      else if (ch === ')' || ch === ']') { d--; cur += ch; }
      else if (ch === ',' && d === 0) { parts.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  }

  var parts = splitTopLevel(inner);
  if (parts.length < 2) return null;

  // 解析角度：第一段可能是 "135deg"、"to right"、"to bottom right" 等
  var angle = 0;
  var stopsStartIndex = 0;
  var firstPart = parts[0].trim().toLowerCase();
  var degMatch = firstPart.match(/^(-?[\d.]+)deg$/);
  if (degMatch) {
    angle = parseFloat(degMatch[1]);
    stopsStartIndex = 1;
  } else if (firstPart.startsWith('to ')) {
    // 方向关键字 → 转换为角度（CSS 规范：to top=0, to right=90, to bottom=180, to left=270）
    var dirMap = {
      'to top': 0, 'to top right': 45, 'to right top': 45,
      'to right': 90, 'to bottom right': 135, 'to right bottom': 135,
      'to bottom': 180, 'to bottom left': 225, 'to left bottom': 225,
      'to left': 270, 'to top left': 315, 'to left top': 315,
    };
    angle = dirMap[firstPart] != null ? dirMap[firstPart] : 180;
    stopsStartIndex = 1;
  } else {
    // 没有角度/方向，第一段直接是色标
    stopsStartIndex = 0;
  }

  var stops = [];
  for (var k = stopsStartIndex; k < parts.length; k++) {
    var seg = parts[k].trim();
    // 末尾的百分比位置（可能是 "50%" 或 "0.5"）
    var pctMatch = seg.match(/\s+([\d.]+)%\s*$/);
    var pos;
    if (pctMatch) {
      pos = parseFloat(pctMatch[1]) / 100;
      seg = seg.slice(0, seg.length - pctMatch[0].length).trim();
    } else {
      var stopIdx = k - stopsStartIndex;
      var total = parts.length - stopsStartIndex - 1;
      pos = total > 0 ? stopIdx / total : 0;
    }
    var outColor = cssColorToRgba(seg);
    if (outColor) stops.push({ position: pos, color: outColor });
  }

  if (stops.length < 2) return null;
  return { type: 'GRADIENT_LINEAR', gradientStops: stops, angle: angle };
}

/**
 * 解析 CSS box-shadow → [{ offsetX, offsetY, blur, spread?, color }]。
 * 仅解析外阴影（不含 inset），与 Figma DROP_SHADOW 对应。
 * 语法：none | (inset? (color? offset-x offset-y blur-radius spread-radius? | offset-x offset-y blur-radius spread-radius? color?))#
 * 支持 "0 4px 12px rgba(255,77,106,0.2)" 与 "rgba(255,77,106,0.2) 0 4px 12px" 两种顺序。
 */
function parseBoxShadow(boxShadowStr) {
  if (!boxShadowStr || typeof boxShadowStr !== 'string') return [];
  var str = boxShadowStr.trim();
  if (str === '' || str === 'none') return [];
  var result = [];
  var i = 0;
  function skipWs() { while (i < str.length && /\s/.test(str[i])) i++; }
  function parseLength() {
    skipWs();
    if (i >= str.length) return null;
    var start = i;
    if (str[i] === '-') i++;
    while (i < str.length && /[\d.]/.test(str[i])) i++;
    var num = parseFloat(str.slice(start, i));
    if (Number.isNaN(num)) return null;
    skipWs();
    if (str.substr(i, 2) === 'px') i += 2;
    else if (str.substr(i, 2) === 'em') i += 2;
    else if (str.substr(i, 3) === 'rem') i += 3;
    skipWs();
    return num;
  }
  function parseColor() {
    skipWs();
    if (i >= str.length) return null;
    var colorStart = i;
    if (str[i] === '#') {
      i++; while (i < str.length && /[a-fA-F0-9]/.test(str[i])) i++;
      return str.slice(colorStart, i).trim();
    }
    if (str.substr(i, 4).toLowerCase() === 'rgba') {
      i += 4;
      skipWs();
      if (str[i] === '(') { i++; var depth = 1; while (i < str.length && depth > 0) { if (str[i] === '(') depth++; else if (str[i] === ')') { depth--; if (depth === 0) { i++; break; } } i++; } }
      return str.slice(colorStart, i).trim();
    }
    if (str.substr(i, 3).toLowerCase() === 'rgb') {
      i += 3;
      skipWs();
      if (str[i] === '(') { i++; var d = 1; while (i < str.length && d > 0) { if (str[i] === '(') d++; else if (str[i] === ')') { d--; if (d === 0) { i++; break; } } i++; } }
      return str.slice(colorStart, i).trim();
    }
    var word = /^[a-zA-Z][\w-]*/.exec(str.slice(i));
    if (word) { i += word[0].length; return word[0]; }
    return null;
  }
  function looksLikeColor() {
    skipWs();
    if (i >= str.length) return false;
    if (str[i] === '#') return true;
    if (str.substr(i, 4).toLowerCase() === 'rgba') return true;
    if (str.substr(i, 3).toLowerCase() === 'rgb') return true;
    return /^[a-zA-Z]/.test(str[i]);
  }
  while (i < str.length) {
    skipWs();
    if (i >= str.length) break;
    var inset = false;
    if (str.substr(i, 5) === 'inset') { inset = true; i += 5; skipWs(); }
    var colorFirst = looksLikeColor();
    var color = null;
    if (colorFirst) color = parseColor();
    var offsetX = parseLength();
    var offsetY = parseLength();
    if (offsetX == null || offsetY == null) break;
    var blur = parseLength();
    if (blur == null) blur = 0;
    var spread = parseLength();
    if (!colorFirst) {
      skipWs();
      if (i < str.length && str[i] !== ',') color = parseColor();
    }
    if (!inset) {
      // 统一转 rgba 格式
      var resolvedColor = color ? (cssColorToRgba(String(color).trim()) || 'rgba(0, 0, 0, 1)') : 'rgba(0, 0, 0, 1)';
      var one = {
        offsetX: Math.round(offsetX),
        offsetY: Math.round(offsetY),
        blur: Math.round(blur),
        spread: spread != null ? Math.round(spread) : 0,
        color: resolvedColor
      };
      result.push(one);
    }
    skipWs();
    if (str[i] === ',') i++;
  }
  return result;
}

/**
 * 解析 CSS border 简写，如 "1px solid transparent" → { width, style, color }。
 * 用于 style 标签里只写了 border 未写 border-width/color 的情况。
 */
function parseBorderShorthand(borderStr) {
  if (!borderStr || typeof borderStr !== 'string') return null;
  var s = borderStr.trim();
  if (s === '' || s === 'none' || s === '0') return { width: 0, style: 'none', color: 'transparent' };
  var width = 0;
  var style = 'solid';
  var color = 'transparent';
  var rest = s;
  var lenMatch = rest.match(/^(\d+(?:\.\d+)?)\s*(px|em|rem)?\s+/i);
  if (lenMatch) {
    width = parseFloat(lenMatch[1]);
    if (lenMatch[2] && (lenMatch[2].toLowerCase() === 'em' || lenMatch[2].toLowerCase() === 'rem')) width = Math.round(width * 16);
    rest = rest.slice(lenMatch[0].length).trim();
  } else if (/^thin\s+/i.test(rest)) { width = 1; rest = rest.slice(5).trim(); }
  else if (/^medium\s+/i.test(rest)) { width = 3; rest = rest.slice(6).trim(); }
  else if (/^thick\s+/i.test(rest)) { width = 5; rest = rest.slice(5).trim(); }
  var styleMatch = rest.match(/^(none|solid|dashed|dotted|double|groove|ridge|inset|outset)\s+/i);
  if (styleMatch) {
    style = styleMatch[1].toLowerCase();
    rest = rest.slice(styleMatch[0].length).trim();
  }
  if (rest) color = rest;
  return { width: width, style: style, color: color };
}

/**
 * 从 grid-template-columns 解析出列数，用于 Figma 侧按列换行。
 * 支持：repeat(3, 1fr)、repeat(3, minmax(0, 1fr))、1fr 1fr 1fr（computed 多段）等。
 * @param {string} str - 声明或 computed 的 grid-template-columns 值
 * @returns {number|null} 列数，解析失败返回 null
 */
function parseGridTemplateColumnsCount(str) {
  if (!str || typeof str !== 'string') return null;
  var s = str.trim();
  if (!s || s === 'none') return null;
  var repeatMatch = s.match(/repeat\s*\(\s*(\d+)\s*,/);
  if (repeatMatch) return parseInt(repeatMatch[1], 10);
  var autoFillMatch = s.match(/repeat\s*\(\s*auto-fill\s*,/);
  if (autoFillMatch) return null;
  var autoFitMatch = s.match(/repeat\s*\(\s*auto-fit\s*,/);
  if (autoFitMatch) return null;
  var parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 1) return parts.length;
  return null;
}

/**
 * 序列化 SVG 元素为字符串，供 Figma createNodeFromSVG() 使用。
 * - 把 currentColor 替换为实际 computed color
 * - 把 width/height 替换为 DOM 实测像素值（避免 1em 等相对单位）
 * @param {SVGElement} svgEl
 * @param {number} domWidth  - DOM 实测宽度（设计稿坐标）
 * @param {number} domHeight - DOM 实测高度（设计稿坐标）
 * @returns {string|null}
 */
function serializeSvgElement(svgEl, domWidth, domHeight) {
  if (!svgEl) return null;
  var html = svgEl.outerHTML;
  if (!html) return null;
  // 取实际渲染颜色，用于替换 currentColor
  var comp = window.getComputedStyle && window.getComputedStyle(svgEl);
  var color = (comp && comp.color) || '#000000';
  // currentColor → 实际颜色
  html = html.replace(/currentColor/gi, color);
  // 替换/补充 width、height 为 DOM 实测像素值
  var w = Math.ceil(domWidth) || 16;
  var h = Math.ceil(domHeight) || 16;
  if (/width="[^"]*"/.test(html)) {
    html = html.replace(/width="[^"]*"/, 'width="' + w + '"');
  } else {
    html = html.replace(/^<svg/, '<svg width="' + w + '"');
  }
  if (/height="[^"]*"/.test(html)) {
    html = html.replace(/height="[^"]*"/, 'height="' + h + '"');
  } else {
    html = html.replace(/^<svg/, '<svg height="' + h + '"');
  }
  return html;
}

/**
 * DOM to MyBricks-Figma JSON (browser script)
 *
 * 画布一定在固定 id 的 Shadow DOM 下，从其中取画布根:
 *   const json = domToMybricksJson('u_NuKJ9');
 *   const json = domToMybricksJson('u_NuKJ9', 'app-styles');
 *
 * @param {string} frameId - 画布容器 div 的 id（在 shadowRoot 内）。其下 class 以 "body-" 开头的节点为画布根（背景、宽高）。
 * @param {string} [styleTagId] - 可选，<style> 的 id，在 shadowRoot 内查找。
 * @returns {{ page: { name?: string, "component-def"?: any[], content: any[] } }}
 */
/** 始终返回插件可接受的根结构，保证 parser 不会报 "missing page object"。 */
function emptyRoot() {
  return { page: { name: undefined, 'component-def': [], content: [] } };
}

/** 从元素 el 向上查找，返回第一个 class 以 "artboard-" 开头的祖先元素的 id；找不到返回 null。 */
function findArtboardIdFromElement(el) {
  var node = el && el.parentElement;
  while (node) {
    if (hasClassPrefix(node, 'artboard-')) {
      return node.id || null;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * 绝对/固定定位的叶子 text：导出宽高常为整盒，浏览器用 flex 将一行字居中，Figma 需 textAlignVertical。
 * 如 ant Pagination 的 .ant-pagination-item-ellipsis（•••）。
 */
function shouldSetTextAlignVerticalCenterForAbsoluteTextLeaf(textStyle, computed) {
  if (!textStyle || !computed) return false;
  var pt = textStyle.positionType;
  if (pt !== 'absolute' && pt !== 'fixed') return false;
  var gv = computed.getPropertyValue
    ? function (k) { return (computed.getPropertyValue(k) || '').trim().toLowerCase(); }
    : function (k) { return String(computed[k] || '').trim().toLowerCase(); };
  var disp = gv('display');
  var ai = gv('align-items');
  if ((disp === 'flex' || disp === 'inline-flex') && ai === 'center') return true;
  if (textStyle.singleLine !== true) return false;
  var h = textStyle.height;
  var fs = textStyle.fontSize;
  if (h != null && fs != null && fs > 0 && h >= fs * 1.75) return true;
  var lhRaw = computed.lineHeight;
  var lh = (lhRaw && lhRaw !== 'normal') ? parseFloat(lhRaw) : null;
  if (h != null && lh != null && !Number.isNaN(lh) && lh > 0 && h > lh * 1.25) return true;
  return false;
}

/**
 * 从指定 DOM 元素直接导出，不需要通过 comId 查找 Shadow DOM。
 * 样式表通过 styleTagId（组件 ID）在 Shadow DOM 内查找 <style id="styleTagId">。
 * @param {Element} el - 要导出的 DOM 元素（如 focusArea.ele）
 * @param {string} [styleTagId] - 可选，<style> 的 id，用于获取组件样式表（通常为组件 id）
 * @returns {{ page: { name?: string, "component-def"?: any[], content: any[] } }}
 */
function elementToMybricksJson(el, styleTagId) {
  if (!el) return emptyRoot();

  var host = getShadowHost();
  var shadowRoot = host && host.shadowRoot ? host.shadowRoot : null;

  var cssRuleMap = styleTagId ? getCssRulesBySelector(styleTagId, shadowRoot || document) : null;

  var geo = getGeoviewScaleAndOrigin(shadowRoot || document);
  var rootComputed = window.getComputedStyle(el);
  var globalFont = getGlobalFont(el, rootComputed, cssRuleMap);

  function walk(node, parentRect) {
    var rect = getDesignRect(node, geo);
    var computed = window.getComputedStyle(node);
    var tag = (node.tagName || '').toLowerCase();

    var isDisplayContents = computed.display === 'contents';
    if (!isDisplayContents && rect.width <= 0 && rect.height <= 0 && tag !== 'svg') return null;
    if (computed.display === 'none' || computed.visibility === 'hidden') return null;

    if (hasClassPrefix(node, 'selection-')) return null;
    if (hasClassPrefix(node, 'append-')) return null;
    if (hasClassPrefix(node, 'boardTitle-')) return null;

    if (isDisplayContents) {
      var childNodes = [];
      for (var i = 0; i < node.childNodes.length; i++) {
        var child = node.childNodes[i];
        if (child.nodeType === 1) {
          var elChild = child;
          var skipTag = (elChild.tagName || '').toLowerCase();
          if (skipTag === 'script' || skipTag === 'style' || skipTag === 'link') continue;
          if (hasClassPrefix(elChild, 'selection-')) continue;
          if (hasClassPrefix(elChild, 'append-')) continue;
          if (hasClassPrefix(elChild, 'boardTitle-')) continue;
          var childNode = walk(elChild, parentRect);
          if (childNode) childNodes.push(childNode);
        }
      }
      if (childNodes.length === 0) return null;
      if (childNodes.length === 1) return childNodes[0];
      return { type: 'group', name: 'contents-wrapper', style: undefined, children: childNodes };
    }

    var nodeType = inferNodeType(node, computed, tag);
    var style = buildStyleJSON(node, computed, rect, parentRect, cssRuleMap, globalFont);

    // [debug] elementToMybricksJson walk - 追踪 input
    if (tag === 'input') {
    }

    var nodeJson = {
      type: nodeType,
      name: node.getAttribute('aria-label') || (node.className && typeof node.className === 'string' ? node.className.trim().split(/\s+/)[0] : null) || tag,
      className: node.className && typeof node.className === 'string' ? node.className.trim().split(/\s+/)[0] || undefined : undefined,
      style: style && Object.keys(style).length ? style : undefined,
      content: undefined,
      children: undefined,
    };
    // 标记 radio-button-wrapper-checked（className 字段只存第一个 class，需从 DOM 全类名单独判断）
    if (node.className && typeof node.className === 'string' && node.className.indexOf('ant-radio-button-wrapper-checked') !== -1) {
      nodeJson._checkedWrapper = true;
    }

    var matchedSelectors = cssRuleMap ? getMatchedSelectorsForElement(node, cssRuleMap) : [];
    if (matchedSelectors.length) nodeJson.selectors = matchedSelectors;

    if (nodeType === 'text') {
      nodeJson.content = getTextContent(node);
      if (nodeJson.content === '' && !node.querySelector('img, svg')) return null;
      // input/textarea 正在显示 placeholder 时，用 ::placeholder 伪类的颜色替换文字颜色
      if (isShowingPlaceholder(node) && nodeJson.style) {
        try {
          var placeholderColor = window.getComputedStyle(node, '::placeholder').color;
          if (placeholderColor && placeholderColor !== 'rgba(0, 0, 0, 0)') {
            nodeJson.style.color = placeholderColor;
          }
        } catch (e) {}
      }
      // 文本节点不需要 frame 专属的布局属性，清除避免消费端误处理
      if (nodeJson.style) {
        delete nodeJson.style.layoutMode;
        delete nodeJson.style.layoutWrap;
        delete nodeJson.style.itemSpacing;
        delete nodeJson.style.counterAxisSpacing;
        // input/textarea：paddingLeft/Right 影响文字可见区域，转成 x 偏移和宽度收窄，而非直接删除
        var _itag2pre = (node.tagName || '').toLowerCase();
        if (_itag2pre === 'input' || _itag2pre === 'textarea') {
          var _pl = nodeJson.style.paddingLeft || 0;
          var _pr = nodeJson.style.paddingRight || 0;
          if (nodeJson.style.x != null) nodeJson.style.x = nodeJson.style.x + _pl;
          if (nodeJson.style.width != null) nodeJson.style.width = Math.max(1, nodeJson.style.width - _pl - _pr);
        }
        delete nodeJson.style.paddingTop;
        delete nodeJson.style.paddingRight;
        delete nodeJson.style.paddingBottom;
        delete nodeJson.style.paddingLeft;
        delete nodeJson.style.primaryAxisAlignItems;
        delete nodeJson.style.counterAxisAlignItems;
        delete nodeJson.style.layoutSizingHorizontal;
        delete nodeJson.style.layoutSizingVertical;
        delete nodeJson.style.layoutGridColumns;
        // 判断 DOM 里是否单行：用 lineHeight 判断（单行高度约等于一个 lineHeight），fallback 到 height < fontSize * 2
        var _h = nodeJson.style.height;
        var _fs = nodeJson.style.fontSize;
        if (_h != null && _fs != null && _fs > 0) {
          var _lhRaw = computed && computed.lineHeight;
          var _lh = (_lhRaw && _lhRaw !== 'normal') ? parseFloat(_lhRaw) : null;
          if (_lh != null && !Number.isNaN(_lh) && _lh > 0) {
            // 高度在一个行高范围内（允许 20% 误差）→ 单行
            nodeJson.style.singleLine = _h <= _lh * 1.2;
          } else {
            nodeJson.style.singleLine = _h < _fs * 2;
          }
        }
        // 判断是否容器约束宽度：用 Range 测量文字内容的自然渲染宽度，若内容宽度 < 元素宽度 × 0.9
        // 则说明容器 CSS 约束了宽度（文字未撑满），固定宽度不会导致 Figma 换行
        // 也检测 text-overflow: ellipsis，文字超出被截断同样需要固定容器宽度
        if (nodeJson.style.singleLine && nodeJson.style.width != null) {
          var _textOverflowVal2 = (computed && computed.textOverflow) || '';
          var _overflowXVal2 = (computed && (computed.overflowX || computed.overflow)) || '';
          if (_textOverflowVal2 === 'ellipsis' && _overflowXVal2 !== 'visible') {
            nodeJson.style.widthConstrained = true;
            nodeJson.style.textOverflow = 'ellipsis';
          } else {
            var _contentW2 = 0;
            var _geoScale2 = geo.scale || 1;
            for (var _ci2 = 0; _ci2 < node.childNodes.length; _ci2++) {
              var _cn2 = node.childNodes[_ci2];
              if (_cn2.nodeType === 3 && (_cn2.textContent || '').trim()) {
                var _tr2 = getTextNodeRect(_cn2);
                if (_tr2 && _tr2.width > 0) _contentW2 += _tr2.width / _geoScale2;
              }
            }
            if (_contentW2 > 0 && _contentW2 < nodeJson.style.width * 0.9) {
              nodeJson.style.widthConstrained = true;
            }
          }
        }
      }
      // input/textarea 浏览器默认垂直居中，Figma text 节点需要显式设置
      var _itag2 = (node.tagName || '').toLowerCase();
      if (_itag2 === 'input' || _itag2 === 'textarea') {
        if (nodeJson.style) {
          nodeJson.style.textAlignVertical = 'CENTER';
          if (!nodeJson.style.textAlignHorizontal) {
            var _taRaw2 = computed && computed.textAlign;
            var _taMap2 = { left: 'LEFT', right: 'RIGHT', center: 'CENTER', justify: 'JUSTIFIED', start: 'LEFT', end: 'RIGHT' };
            nodeJson.style.textAlignHorizontal = _taMap2[String(_taRaw2 || 'left').toLowerCase()] || 'LEFT';
          }
        }
      } else if (nodeJson.style && shouldSetTextAlignVerticalCenterForAbsoluteTextLeaf(nodeJson.style, computed)) {
        nodeJson.style.textAlignVertical = 'CENTER';
      }
      // 对 text 节点检测伪元素：若 ::before/::after 有内容，升级为 frame，原文本 + 伪元素作为子节点
      var _pseudoBefore2 = getPseudoTextNode(node, '::before', geo, parentRect, rect, cssRuleMap, globalFont);
      var _pseudoAfter2 = getPseudoTextNode(node, '::after', geo, parentRect, rect, cssRuleMap, globalFont);
      if (_pseudoBefore2 || _pseudoAfter2) {
        // 浅拷贝 style，避免直接修改原始对象（可能被冻结导致 object is not extensible）
        var _textStyle2 = nodeJson.style ? Object.assign({}, nodeJson.style) : {};
        delete _textStyle2.x; delete _textStyle2.y;
        delete _textStyle2.width; delete _textStyle2.height;
        var _textChild2 = { type: 'text', name: nodeJson.name, content: nodeJson.content, style: _textStyle2, className: nodeJson.className };
        if (_pseudoBefore2) _pseudoBefore2 = { type: _pseudoBefore2.type, name: _pseudoBefore2.name, content: _pseudoBefore2.content, style: Object.assign({}, _pseudoBefore2.style, { x: undefined, y: undefined }) };
        if (_pseudoAfter2) _pseudoAfter2 = { type: _pseudoAfter2.type, name: _pseudoAfter2.name, content: _pseudoAfter2.content, style: Object.assign({}, _pseudoAfter2.style, { x: undefined, y: undefined }) };
        var _pseudoChildren2 = [];
        if (_pseudoBefore2) _pseudoChildren2.push(_pseudoBefore2);
        _pseudoChildren2.push(_textChild2);
        if (_pseudoAfter2) _pseudoChildren2.push(_pseudoAfter2);
        nodeJson.type = 'frame';
        nodeJson.content = undefined;
        nodeJson.children = _pseudoChildren2;
        nodeJson.style = { x: nodeJson.style && nodeJson.style.x, y: nodeJson.style && nodeJson.style.y, width: nodeJson.style && nodeJson.style.width, layoutMode: 'HORIZONTAL', itemSpacing: 0, counterAxisAlignItems: 'CENTER', layoutSizingVertical: 'HUG' };
      }
    }

    if (nodeType === 'image') {
      var src = (node.tagName || '').toLowerCase() === 'img' ? (node.currentSrc || node.src || node.getAttribute('src')) : null;
      if (!src) return null;
      nodeJson.content = src;
    }

    var childNodesList = [];
    var isLibrarySource = !!(node.getAttribute && node.getAttribute('data-library-source') != null);
    if (nodeType !== 'text' && nodeType !== 'image' && !(tag === 'svg')) {
      var _mergedTextBr2 = '';
      var _didMergeTextBr2 = false;
      if (shouldMergeTextAndBrChildren(node)) {
        _mergedTextBr2 = mergeTextAndBrChildNodesContent(node);
        if (_mergedTextBr2) {
          var _mergeRectVp2 = getElementContentsTextBlockRect(node);
          var _mergeRect2 = _mergeRectVp2 ? getDesignRect(_mergeRectVp2, geo) : null;
          var _mergeInline2 = buildInlineTextStyle(node, window.getComputedStyle(node), _mergeRect2, rect, cssRuleMap, globalFont);
          var _mergeTextJson2 = {
            type: 'text',
            name: 'Text',
            content: _mergedTextBr2,
            style: _mergeInline2 && Object.keys(_mergeInline2).length ? _mergeInline2 : undefined,
          };
          if (nodeJson.selectors && nodeJson.selectors.length) _mergeTextJson2.selectors = nodeJson.selectors.slice();
          if (nodeJson.className) _mergeTextJson2.className = nodeJson.className;
          childNodesList.push(_mergeTextJson2);
          _didMergeTextBr2 = true;
        }
      }
      if (!_didMergeTextBr2) {
      for (var ci = 0; ci < node.childNodes.length; ci++) {
        var cchild = node.childNodes[ci];
        if (cchild.nodeType === 1) {
          var celChild = cchild;
          var cskip = (celChild.tagName || '').toLowerCase() === 'script' ||
            (celChild.tagName || '').toLowerCase() === 'style' ||
            (celChild.tagName || '').toLowerCase() === 'link';
          if (cskip) continue;
          if (hasClassPrefix(celChild, 'selection-')) continue;
          if (hasClassPrefix(celChild, 'append-')) continue;
          if (hasClassPrefix(celChild, 'boardTitle-')) continue;
          var cn = walk(celChild, rect);
          if (cn) childNodesList.push(cn);
        } else if (cchild.nodeType === 3) {
          var textContent = (cchild.textContent || '').trim();
          if (textContent) {
            var textRectViewport = getTextNodeRect(cchild);
            var textRect = textRectViewport ? getDesignRect(textRectViewport, geo) : null;
            var inlineStyle = buildInlineTextStyle(node, window.getComputedStyle(node), textRect, rect, cssRuleMap, globalFont);
            var textNodeJson = {
              type: 'text',
              name: 'Text',
              content: textContent.replace(/\s+/g, ' '),
              style: inlineStyle && Object.keys(inlineStyle).length ? inlineStyle : undefined,
            };
            if (nodeJson.selectors && nodeJson.selectors.length) textNodeJson.selectors = nodeJson.selectors.slice();
            if (nodeJson.className) textNodeJson.className = nodeJson.className;
            childNodesList.push(textNodeJson);
          }
        }
      }
      }
      // 伪元素处理：::before 插到最前，::after 追加到最后
      var pseudoBefore = getPseudoTextNode(node, '::before', geo, parentRect, rect, cssRuleMap, globalFont);
      if (pseudoBefore) childNodesList.unshift(pseudoBefore);
      var pseudoAfter = getPseudoTextNode(node, '::after', geo, parentRect, rect, cssRuleMap, globalFont);
      if (pseudoAfter) childNodesList.push(pseudoAfter);
      if (childNodesList.length) {
        var layoutMode = nodeJson.style && (nodeJson.style.layoutMode === 'VERTICAL' || nodeJson.style.layoutMode === 'HORIZONTAL') ? nodeJson.style.layoutMode : null;
        if (layoutMode) {
          // 任意子节点有负值 margin 说明间距不均匀，无法用 Auto Layout 还原，直接降级为绝对定位
          if (anyChildHasMargin(childNodesList)) {
            delete nodeJson.style.layoutMode;
            delete nodeJson.style.itemSpacing;
            for (var si = 0; si < childNodesList.length; si++) {
              var ss = childNodesList[si].style || {};
              if (ss.marginTop != null) delete ss.marginTop;
              if (ss.marginRight != null) delete ss.marginRight;
              if (ss.marginBottom != null) delete ss.marginBottom;
              if (ss.marginLeft != null) delete ss.marginLeft;
            }
          } else {
            // WRAP 容器：在所有 margin 清理操作之前，先提取子节点 marginBottom 作为行间距
            if (nodeJson.style && nodeJson.style.layoutWrap === 'WRAP' && !nodeJson.style.counterAxisSpacing) {
              for (var _wEarly = 0; _wEarly < childNodesList.length; _wEarly++) {
                var _wEarlyC = childNodesList[_wEarly];
                if (_wEarlyC && _wEarlyC.style && _wEarlyC.style.marginBottom > 0) {
                  nodeJson.style.counterAxisSpacing = _wEarlyC.style.marginBottom;
                  break;
                }
              }
            }
            if (childrenHaveUniformMargin(childNodesList, layoutMode)) {
              applyUniformMarginAsGap(nodeJson, childNodesList, layoutMode);
            }
            ensureItemSpacingFromPositions(nodeJson, childNodesList, layoutMode);
            var finalSpacing = (nodeJson.style && nodeJson.style.itemSpacing != null) ? nodeJson.style.itemSpacing : null;
            var _isRadioWrapperNode = nodeJson.className && nodeJson.className.indexOf('radio-button-wrapper') !== -1;
            var _isMenuNode = nodeJson.className && nodeJson.className.indexOf('ant-menu') !== -1;
            if (_isRadioWrapperNode) {
            }
            if (finalSpacing == null || finalSpacing < 0) {
              var s = nodeJson.style || {};
              var hasAlignment = (s.primaryAxisAlignItems && s.primaryAxisAlignItems !== 'MIN') ||
                                 (s.counterAxisAlignItems && s.counterAxisAlignItems !== 'MIN');
              var hasPadding = s.paddingTop || s.paddingRight || s.paddingBottom || s.paddingLeft;
              // 若子节点中有绝对定位节点，其 x/y 不参与流式排布，不应影响间距计算结论，保留 layoutMode
              var hasAbsoluteChild = childNodesList.some(function(c) { return c.style && c.style.positionType === 'absolute'; });
              if (_isMenuNode) {
              }
              if (_isRadioWrapperNode) {
              }
              if (hasAlignment || hasPadding || hasAbsoluteChild) {
                nodeJson.style.itemSpacing = 0;
              } else {
                delete nodeJson.style.layoutMode;
                delete nodeJson.style.itemSpacing;
              }
            } else {
              // itemSpacing 已从子节点 margin 中推断出来，清理子节点 margin
              // 但若父容器是 WRAP，marginBottom 是行间距来源，先提取再删
              var _isWrapContainer = nodeJson.style && nodeJson.style.layoutWrap === 'WRAP';
              if (_isWrapContainer && !nodeJson.style.counterAxisSpacing) {
                for (var _wPre = 0; _wPre < childNodesList.length; _wPre++) {
                  var _wPreC = childNodesList[_wPre];
                  if (_wPreC && _wPreC.style && _wPreC.style.marginBottom > 0) {
                    nodeJson.style.counterAxisSpacing = _wPreC.style.marginBottom;
                    break;
                  }
                }
              }
              for (var si = 0; si < childNodesList.length; si++) {
                var ss = childNodesList[si].style || {};
                if (ss.marginTop != null) delete ss.marginTop;
                if (ss.marginRight != null) delete ss.marginRight;
                if (ss.marginBottom != null) delete ss.marginBottom;
                if (ss.marginLeft != null) delete ss.marginLeft;
              }
            }
          }
        }
        // 绝对定位子节点（position: absolute）在 CSS 里靠 z-index 浮于普通流之上，
        // Figma 没有 z-index，层叠顺序由 children 数组决定（后面的在上层）。
        // 将 positionType: absolute 的节点移到数组末尾，保证它们始终渲染在最上层。
        var _absNodes = [];
        var _flowNodes = [];
        for (var _zi = 0; _zi < childNodesList.length; _zi++) {
          var _zn = childNodesList[_zi];
          if (_zn && _zn.style && _zn.style.positionType === 'absolute') {
            _absNodes.push(_zn);
          } else {
            _flowNodes.push(_zn);
          }
        }
        if (_absNodes.length > 0) childNodesList = _flowNodes.concat(_absNodes);
        // ant-radio-group：过滤掉各 wrapper 内的 pseudo-before 竖线（Figma 里不需要，边框各自渲染）
        // 注意：选中态 wrapper（ant-radio-button-wrapper-checked）的 ::before 是左侧高亮边，不能过滤
        if (nodeJson.className && nodeJson.className.indexOf('ant-radio-group') !== -1) {
          for (var _rgi = 0; _rgi < childNodesList.length; _rgi++) {
            var _rgChild = childNodesList[_rgi];
            if (_rgChild && _rgChild.children) {
              var _isChecked = _rgChild._checkedWrapper === true;
              if (!_isChecked) {
                _rgChild.children = _rgChild.children.filter(function(c) { return c.name !== 'pseudo-before'; });
              }
            }
          }
        }
        nodeJson.children = childNodesList;
        // flex-wrap 容器：兜底检查（通常已在上方 margin 清理前提取），防止遗漏
        if (nodeJson.style && nodeJson.style.layoutWrap === 'WRAP' && !nodeJson.style.counterAxisSpacing) {
          for (var _wsi = 0; _wsi < childNodesList.length; _wsi++) {
            var _wsc = childNodesList[_wsi];
            if (_wsc && _wsc.style && _wsc.style.marginBottom > 0) {
              nodeJson.style.counterAxisSpacing = _wsc.style.marginBottom;
              break;
            }
          }
        }
      }
      // 表格行（display: table-row / <tr>）的 border-bottom 需下移到子单元格
      // 因为 Figma 中子 frame 背景会遮盖父 frame 的底部边框，浏览器表格模型不存在这个问题
      if (nodeJson.children && nodeJson.children.length > 0 && nodeJson.style && nodeJson.style.strokeBottomWeight > 0) {
        var _elDisplay = computed.display || '';
        if (_elDisplay === 'table-row' || (node.tagName || '').toLowerCase() === 'tr') {
          var _trStrokeColor = nodeJson.style.strokeColor;
          var _trStrokeBottomW = nodeJson.style.strokeBottomWeight;
          for (var _tdi = 0; _tdi < nodeJson.children.length; _tdi++) {
            var _tdNode = nodeJson.children[_tdi];
            if (!_tdNode || !_tdNode.style) continue;
            if (!_tdNode.style.strokeColor) _tdNode.style.strokeColor = _trStrokeColor;
            var _tdBotW = _tdNode.style.strokeBottomWeight || 0;
            if (_trStrokeBottomW > _tdBotW) _tdNode.style.strokeBottomWeight = _trStrokeBottomW;
          }
          nodeJson.style.strokeBottomWeight = 0;
        }
      }
    }

    if (nodeType === 'frame') {
      var frameTitle = getFrameTitleFromElement(node);
      if (frameTitle) nodeJson.name = frameTitle;
      // input/textarea 改为 frame 后需补入 placeholder 文字子节点
      if (tag === 'input' || tag === 'textarea') {
        var _inputPlaceholder = node.placeholder || '';
        var _inputValue = (node.value || '').trim();
        var _inputText = _inputValue || _inputPlaceholder;
        if (_inputText) {
          try {
            var _inputPl = nodeJson.style ? (nodeJson.style.paddingLeft || 0) : 0;
            var _inputPr = nodeJson.style ? (nodeJson.style.paddingRight || 0) : 0;
            var _inputPt = nodeJson.style ? (nodeJson.style.paddingTop || 0) : 0;
            var _inputPb = nodeJson.style ? (nodeJson.style.paddingBottom || 0) : 0;
            var _inputW = nodeJson.style && nodeJson.style.width != null ? Math.max(1, nodeJson.style.width - _inputPl - _inputPr) : undefined;
            var _inputH = nodeJson.style && nodeJson.style.height != null ? Math.max(1, nodeJson.style.height - _inputPt - _inputPb) : undefined;
            var _inputFontSize = nodeJson.style ? (nodeJson.style.fontSize || 14) : 14;
            var _inputColor = nodeJson.style ? nodeJson.style.color : undefined;
            if (!_inputValue && _inputPlaceholder) {
              try {
                var _phColor = window.getComputedStyle(node, '::placeholder').color;
                if (_phColor && _phColor !== 'rgba(0, 0, 0, 0)') _inputColor = _phColor;
              } catch (e) {}
            }
            var _isTextarea = tag === 'textarea';
            var _inputChildStyle = {
              positionType: _isTextarea ? 'absolute' : undefined,
              x: _inputPl,
              y: _isTextarea ? _inputPt : undefined,
              width: _inputW,
              height: _isTextarea ? _inputH : undefined,
              fontSize: _inputFontSize,
              singleLine: !_isTextarea,
              textAlignVertical: _isTextarea ? 'TOP' : 'CENTER',
              textAlignHorizontal: nodeJson.style ? (nodeJson.style.textAlignHorizontal || 'LEFT') : 'LEFT',
            };
            if (_inputColor) _inputChildStyle.color = cssColorToRgba(_inputColor) || _inputColor;
            if (nodeJson.style && nodeJson.style.fontFamily) _inputChildStyle.fontFamily = nodeJson.style.fontFamily;
            if (nodeJson.style && nodeJson.style.fontFamilyStack) _inputChildStyle.fontFamilyStack = nodeJson.style.fontFamilyStack;
            if (nodeJson.style && nodeJson.style.fontWeight) _inputChildStyle.fontWeight = nodeJson.style.fontWeight;
            // textarea 自身 frame 对齐改为 flex-start，防止被父容器 counterAxisAlignItems:CENTER 影响
            if (_isTextarea && nodeJson.style) {
              nodeJson.style.alignSelf = 'MIN';
            }
            nodeJson.children = [{ type: 'text', name: 'placeholder', content: _inputText, style: _inputChildStyle }];
            if (nodeJson.style) {
              delete nodeJson.style.color;
              delete nodeJson.style.fontSize;
              delete nodeJson.style.fontFamily;
              delete nodeJson.style.fontFamilyStack;
              delete nodeJson.style.fontWeight;
              delete nodeJson.style.textAlignHorizontal;
            }
          } catch (e) {}
        }
      }
    }

    if (nodeType === 'component' && tag === 'svg') {
      var svgContent = serializeSvgElement(node, rect.width, rect.height);
      if (svgContent) {
        nodeJson.type = 'svg';
        nodeJson.ref = undefined;
        nodeJson.children = undefined;
        if (!nodeJson.style) nodeJson.style = {};
        nodeJson.style.svgContent = svgContent;
      } else {
        nodeJson.ref = 'svg-placeholder';
        nodeJson.children = undefined;
      }
    }
    return nodeJson;
  }

  var rootRect = getDesignRect(el, geo);
  var contentChildren = [];
  for (var i = 0; i < el.children.length; i++) {
    var child = el.children[i];
    if (hasClassPrefix(child, 'selection-')) continue;
    if (hasClassPrefix(child, 'append-')) continue;
    if (hasClassPrefix(child, 'boardTitle-')) continue;
    var ctag = (child.tagName || '').toLowerCase();
    if (ctag === 'script' || ctag === 'style' || ctag === 'link') continue;
    var childNode = walk(child, rootRect);
    if (childNode) contentChildren.push(childNode);
  }

  var rootStyle = buildStyleJSON(el, rootComputed, rootRect, null, cssRuleMap, globalFont);
  var pageName = el.id || (typeof el.className === 'string' && el.className.trim() ? el.className.trim().split(/\s+/)[0] : undefined) || undefined;
  var rootSelectors = cssRuleMap ? getMatchedSelectorsForElement(el, cssRuleMap) : [];
  var content = [
    {
      type: 'frame',
      name: pageName || 'Frame',
      className: (typeof el.className === 'string' && el.className.trim()) ? el.className.trim().split(/\s+/)[0] : undefined,
      style: rootStyle && Object.keys(rootStyle).length ? rootStyle : undefined,
      children: contentChildren.length ? contentChildren : undefined,
    },
  ];
  if (rootSelectors.length) content[0].selectors = rootSelectors;

  var componentDef = [];
  componentDef.push({ type: 'svg-placeholder', name: 'SVG Placeholder', style: { fills: ['#e5e5e5'] }, children: [] });
  componentDef.push({ type: 'library-source-placeholder', name: 'Library Source Placeholder', style: { fills: ['#e5e5e5'] }, children: [] });

  var pagePayload = { name: pageName, 'component-def': componentDef, content: content };
  if (globalFont && globalFont.fontFamily) {
    var defaultStack = (rootComputed && rootComputed.fontFamily) ? parseFontFamilyStack(String(rootComputed.fontFamily)) : [];
    pagePayload.defaultFont = {
      fontFamily: globalFont.fontFamily,
      fontWeight: globalFont.fontWeight,
      fontStyle: globalFont.fontStyle,
      fontFamilyStack: defaultStack.length ? defaultStack : undefined
    };
  }
  return { page: pagePayload };
}

/**
 * 按组件 id 导出：从 #comId 向上找到 class 以 "artboard-" 开头的祖先，取其 id 作为 frameId，再调用 domToMybricksJson。
 * @param {string} comId - 组件根元素 id，同时作为 styleTagId 传入 domToMybricksJson
 * @returns {{ page: { name?: string, "component-def"?: any[], content: any[] } }}
 */
function comToMybricksJson(comId) {
  var host = getShadowHost();
  if (!host || !host.shadowRoot) {
    return emptyRoot();
  }
  var shadowRoot = host.shadowRoot;
  var comEl = shadowRoot.querySelector('#' + CSS.escape(comId));
  if (!comEl) {
    return emptyRoot();
  }
  var frameId = findArtboardIdFromElement(comEl);
  if (!frameId) {
    return emptyRoot();
  }

  return domToMybricksJson(frameId, comId);
}

/** 同上，但会请求 background-image url() 并内联为 base64，供导出到 Figma 时带背景图。返回 Promise。 */
function comToMybricksJsonWithInlineImages(comId) {
  var host = getShadowHost();
  if (!host || !host.shadowRoot) return Promise.resolve(emptyRoot());
  var shadowRoot = host.shadowRoot;
  var comEl = shadowRoot.querySelector('#' + CSS.escape(comId));
  if (!comEl) return Promise.resolve(emptyRoot());
  var frameId = findArtboardIdFromElement(comEl);
  if (!frameId) return Promise.resolve(emptyRoot());
  return domToMybricksJsonWithInlineImages(frameId, comId);
}

function domToMybricksJson(frameId, styleTagId) {
  const host = getShadowHost();
  if (!host || !host.shadowRoot) {
    return emptyRoot();
  }
  const shadowRoot = host.shadowRoot;

  const root = resolveFrameRoot(frameId);
  if (!root) {
    return emptyRoot();
  }

  const cssRuleMap = styleTagId ? getCssRulesBySelector(styleTagId, shadowRoot) : null;
  const dom = root;

  var geo = getGeoviewScaleAndOrigin(shadowRoot);

  // 全局字体：从画布根取，仅当节点与全局不同时才在 style 里输出 fontFamily/fontWeight/fontStyle
  var rootComputed = window.getComputedStyle(root);
  var globalFont = getGlobalFont(root, rootComputed, cssRuleMap);

  function walk(el, parentRect) {
    const rect = getDesignRect(el, geo);
    const computed = window.getComputedStyle(el);
    const tag = (el.tagName || '').toLowerCase();

    // [debug] input 节点全流程追踪（最早入口）
    if (tag === 'input') {
    }

    var _tc = (el.textContent || '').trim();
    if (_tc.indexOf('快手本地生活 · 商家中心') !== -1) {
    }

    // Skip invisible or zero-size
    // display:contents 元素自身无盒模型（width/height 均为 0），但其子节点参与布局，需透传遍历
    const isDisplayContents = computed.display === 'contents';
    if (!isDisplayContents && rect.width <= 0 && rect.height <= 0 && tag !== 'svg') return null;
    if (computed.display === 'none' || computed.visibility === 'hidden') return null;

    // body 下方 class 以 selection- 开头的节点不参与输出
    // append- 是 MyBricks 画布的组件追加区域包裹层，boardTitle- 是画布标题区，均属画布内部骨架节点，不应导出为设计稿内容
    if (hasClassPrefix(el, 'selection-')) return null;
    if (hasClassPrefix(el, 'append-')) return null;
    if (hasClassPrefix(el, 'boardTitle-')) return null;

    // display:contents 节点自身不作为独立 frame，直接将其子节点合并到父级
    if (isDisplayContents) {
      const childNodes = [];
      for (let i = 0; i < el.childNodes.length; i++) {
        const child = el.childNodes[i];
        if (child.nodeType === 1) {
          const elChild = child;
          const skipTag = (elChild.tagName || '').toLowerCase();
          if (skipTag === 'script' || skipTag === 'style' || skipTag === 'link') continue;
          if (hasClassPrefix(elChild, 'selection-')) continue;
          if (hasClassPrefix(elChild, 'append-')) continue;
          if (hasClassPrefix(elChild, 'boardTitle-')) continue;
          const childNode = walk(elChild, parentRect);
          if (childNode) childNodes.push(childNode);
        }
      }
      if (childNodes.length === 0) return null;
      if (childNodes.length === 1) return childNodes[0];
      // 多个子节点时包成一个 group 透传
      return { type: 'group', name: 'contents-wrapper', style: undefined, children: childNodes };
    }

    const nodeType = inferNodeType(el, computed, tag);
    const style = buildStyleJSON(el, computed, rect, parentRect, cssRuleMap, globalFont);

    // [debug] 追踪 input 节点处理路径
    if (tag === 'input') {
    }

    const node = {
      type: nodeType,
      name: el.getAttribute('aria-label') || (el.className && typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : null) || tag,
      className: el.className && typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] || undefined : undefined,
      style: style && Object.keys(style).length ? style : undefined,
      content: undefined,
      children: undefined,
    };
    // 标记 radio-button-wrapper-checked（className 字段只存第一个 class，需从 DOM 全类名单独判断）
    if (el.className && typeof el.className === 'string' && el.className.indexOf('ant-radio-button-wrapper-checked') !== -1) {
      node._checkedWrapper = true;
    }

    var matchedSelectors = cssRuleMap ? getMatchedSelectorsForElement(el, cssRuleMap) : [];
    if (matchedSelectors.length) node.selectors = matchedSelectors;

    if (nodeType === 'text') {
      node.content = getTextContent(el);
      if (node.content === '' && !el.querySelector('img, svg')) return null;
      // input/textarea 正在显示 placeholder 时，用 ::placeholder 伪类的颜色替换文字颜色
      if (isShowingPlaceholder(el) && node.style) {
        try {
          var placeholderColor = window.getComputedStyle(el, '::placeholder').color;
          if (placeholderColor && placeholderColor !== 'rgba(0, 0, 0, 0)') {
            node.style.color = placeholderColor;
          }
        } catch (e) {}
      }
      // 文本节点不需要 frame 专属的布局属性，清除避免消费端误处理
      if (node.style) {
        delete node.style.layoutMode;
        delete node.style.layoutWrap;
        delete node.style.itemSpacing;
        delete node.style.counterAxisSpacing;
        // input/textarea：paddingLeft/Right 影响文字可见区域，转成 x 偏移和宽度收窄，而非直接删除
        var _itagPre = (el.tagName || '').toLowerCase();
        if (_itagPre === 'input' || _itagPre === 'textarea') {
          var _pl2 = node.style.paddingLeft || 0;
          var _pr2 = node.style.paddingRight || 0;
          if (node.style.x != null) node.style.x = node.style.x + _pl2;
          if (node.style.width != null) node.style.width = Math.max(1, node.style.width - _pl2 - _pr2);
        }
        delete node.style.paddingTop;
        delete node.style.paddingRight;
        delete node.style.paddingBottom;
        delete node.style.paddingLeft;
        delete node.style.primaryAxisAlignItems;
        delete node.style.counterAxisAlignItems;
        delete node.style.layoutSizingHorizontal;
        delete node.style.layoutSizingVertical;
        delete node.style.layoutGridColumns;
        // 判断 DOM 里是否单行：用 lineHeight 判断（单行高度约等于一个 lineHeight），fallback 到 height < fontSize * 2
        var _h = node.style.height;
        var _fs = node.style.fontSize;
        if (_h != null && _fs != null && _fs > 0) {
          var _lhRaw = computed && computed.lineHeight;
          var _lh = (_lhRaw && _lhRaw !== 'normal') ? parseFloat(_lhRaw) : null;
          if (_lh != null && !Number.isNaN(_lh) && _lh > 0) {
            node.style.singleLine = _h <= _lh * 1.2;
          } else {
            node.style.singleLine = _h < _fs * 2;
          }
        }
        // 判断是否容器约束宽度：用 Range 测量文字内容的自然渲染宽度，若内容宽度 < 元素宽度 × 0.9
        // 则说明容器 CSS 约束了宽度（文字未撑满），固定宽度不会导致 Figma 换行
        // 也检测 text-overflow: ellipsis，文字超出被截断同样需要固定容器宽度
        if (node.style.singleLine && node.style.width != null) {
          var _textOverflowVal = (computed && computed.textOverflow) || '';
          var _overflowXVal = (computed && (computed.overflowX || computed.overflow)) || '';
          if (_textOverflowVal === 'ellipsis' && _overflowXVal !== 'visible') {
            node.style.widthConstrained = true;
            node.style.textOverflow = 'ellipsis';
          } else {
            var _contentW = 0;
            var _geoScale = geo.scale || 1;
            for (var _ci = 0; _ci < el.childNodes.length; _ci++) {
              var _cn = el.childNodes[_ci];
              if (_cn.nodeType === 3 && (_cn.textContent || '').trim()) {
                var _tr = getTextNodeRect(_cn);
                if (_tr && _tr.width > 0) _contentW += _tr.width / _geoScale;
              }
            }
            if (_contentW > 0 && _contentW < node.style.width * 0.9) {
              node.style.widthConstrained = true;
            }
          }
        }
      }
      // input/textarea 浏览器默认垂直居中，Figma text 节点需要显式设置
      var _itag = (el.tagName || '').toLowerCase();
      if (_itag === 'input' || _itag === 'textarea') {
        if (node.style) {
          node.style.textAlignVertical = 'CENTER';
          if (!node.style.textAlignHorizontal) {
            var _taRaw = computed && computed.textAlign;
            var _taMap = { left: 'LEFT', right: 'RIGHT', center: 'CENTER', justify: 'JUSTIFIED', start: 'LEFT', end: 'RIGHT' };
            node.style.textAlignHorizontal = _taMap[String(_taRaw || 'left').toLowerCase()] || 'LEFT';
          }
        } else {
          console.warn('[walk:input:align] node.style is undefined! content:', node.content, '| placeholder:', el.placeholder);
        }
      } else if (node.style && shouldSetTextAlignVerticalCenterForAbsoluteTextLeaf(node.style, computed)) {
        node.style.textAlignVertical = 'CENTER';
      }
      // 对 text 节点检测伪元素：若 ::before/::after 有内容，升级为 frame，原文本 + 伪元素作为子节点
      var _pseudoBefore = getPseudoTextNode(el, '::before', geo, parentRect, rect, cssRuleMap, globalFont);
      var _pseudoAfter = getPseudoTextNode(el, '::after', geo, parentRect, rect, cssRuleMap, globalFont);
      if (_pseudoBefore || _pseudoAfter) {
        // 浅拷贝 style，避免直接修改原始对象（可能被冻结导致 object is not extensible）
        var _textStyle = node.style ? Object.assign({}, node.style) : {};
        delete _textStyle.x; delete _textStyle.y;
        delete _textStyle.width; delete _textStyle.height;
        var _textChild = { type: 'text', name: node.name, content: node.content, style: _textStyle, className: node.className };
        if (_pseudoBefore) _pseudoBefore = { type: _pseudoBefore.type, name: _pseudoBefore.name, content: _pseudoBefore.content, style: Object.assign({}, _pseudoBefore.style, { x: undefined, y: undefined }) };
        if (_pseudoAfter) _pseudoAfter = { type: _pseudoAfter.type, name: _pseudoAfter.name, content: _pseudoAfter.content, style: Object.assign({}, _pseudoAfter.style, { x: undefined, y: undefined }) };
        var _pseudoChildren = [];
        if (_pseudoBefore) _pseudoChildren.push(_pseudoBefore);
        _pseudoChildren.push(_textChild);
        if (_pseudoAfter) _pseudoChildren.push(_pseudoAfter);
        node.type = 'frame';
        node.content = undefined;
        node.children = _pseudoChildren;
        node.style = { x: node.style && node.style.x, y: node.style && node.style.y, width: node.style && node.style.width, layoutMode: 'HORIZONTAL', itemSpacing: 0, counterAxisAlignItems: 'CENTER', layoutSizingVertical: 'HUG' };
      }
    }

    if (nodeType === 'image') {
      const src = (el.tagName || '').toLowerCase() === 'img' ? (el.currentSrc || el.src || el.getAttribute('src')) : null;
      if (!src) return null;
      node.content = src;
    }

    const childNodes = [];
    var isLibrarySource = !!(el.getAttribute && el.getAttribute('data-library-source') != null);
    if (nodeType !== 'text' && nodeType !== 'image' && !(tag === 'svg')) {
      // 支持 div 内同时有文本和 DOM：按 childNodes 顺序，元素走 walk，文本节点单独成 text 节点；SVG 用占位组件不遍历子节点
      var _mergedTextBr = '';
      var _didMergeTextBr = false;
      if (shouldMergeTextAndBrChildren(el)) {
        _mergedTextBr = mergeTextAndBrChildNodesContent(el);
        if (_mergedTextBr) {
          var _mergeRectVp = getElementContentsTextBlockRect(el);
          var _mergeRect = _mergeRectVp ? getDesignRect(_mergeRectVp, geo) : null;
          var _mergeInline = buildInlineTextStyle(el, window.getComputedStyle(el), _mergeRect, rect, cssRuleMap, globalFont);
          var _mergeTextJson = {
            type: 'text',
            name: 'Text',
            content: _mergedTextBr,
            style: _mergeInline && Object.keys(_mergeInline).length ? _mergeInline : undefined,
          };
          if (node.selectors && node.selectors.length) _mergeTextJson.selectors = node.selectors.slice();
          if (node.className) _mergeTextJson.className = node.className;
          childNodes.push(_mergeTextJson);
          _didMergeTextBr = true;
        }
      }
      if (!_didMergeTextBr) {
      for (let i = 0; i < el.childNodes.length; i++) {
        const child = el.childNodes[i];
        if (child.nodeType === 1) {
          const elChild = child;
          const skip = (elChild.tagName || '').toLowerCase() === 'script' ||
            (elChild.tagName || '').toLowerCase() === 'style' ||
            (elChild.tagName || '').toLowerCase() === 'link';
          if (skip) continue;
          if (hasClassPrefix(elChild, 'selection-')) continue;
          if (hasClassPrefix(elChild, 'append-')) continue;
          if (hasClassPrefix(elChild, 'boardTitle-')) continue;
          const childNode = walk(elChild, rect);
          if (childNode) childNodes.push(childNode);
        } else if (child.nodeType === 3) {
          var textContent = (child.textContent || '').trim();
          if (textContent) {
            var textRectViewport = getTextNodeRect(child);
            var textRect = textRectViewport ? getDesignRect(textRectViewport, geo) : null;
            var inlineStyle = buildInlineTextStyle(el, window.getComputedStyle(el), textRect, rect, cssRuleMap, globalFont);
            var textNodeJson = {
              type: 'text',
              name: 'Text',
              content: textContent.replace(/[^\S\n]+/g, ' '),
              style: inlineStyle && Object.keys(inlineStyle).length ? inlineStyle : undefined,
            };
            if (node.selectors && node.selectors.length) textNodeJson.selectors = node.selectors.slice();
            if (node.className) textNodeJson.className = node.className;
            childNodes.push(textNodeJson);
          }
        }
      }
      }
      // 伪元素处理：::before 插到最前，::after 追加到最后
      var pseudoBefore = getPseudoTextNode(el, '::before', geo, parentRect, rect, cssRuleMap, globalFont);
      if (pseudoBefore) childNodes.unshift(pseudoBefore);
      var pseudoAfter = getPseudoTextNode(el, '::after', geo, parentRect, rect, cssRuleMap, globalFont);
      if (pseudoAfter) childNodes.push(pseudoAfter);
      if (childNodes.length) {
        var layoutMode = node.style && (node.style.layoutMode === 'VERTICAL' || node.style.layoutMode === 'HORIZONTAL') ? node.style.layoutMode : null;
        if (layoutMode) {
          // 任意子节点有负值 margin 说明间距不均匀，无法用 Auto Layout 还原，直接降级为绝对定位
          if (anyChildHasMargin(childNodes)) {
            delete node.style.layoutMode;
            delete node.style.itemSpacing;
            for (var i = 0; i < childNodes.length; i++) {
              var s = childNodes[i].style || {};
              if (s.marginTop != null) delete s.marginTop;
              if (s.marginRight != null) delete s.marginRight;
              if (s.marginBottom != null) delete s.marginBottom;
              if (s.marginLeft != null) delete s.marginLeft;
            }
          } else {
            // WRAP 容器：在所有 margin 清理操作之前，先提取子节点 marginBottom 作为行间距
            if (node.style && node.style.layoutWrap === 'WRAP' && !node.style.counterAxisSpacing) {
              for (var _wEarly2 = 0; _wEarly2 < childNodes.length; _wEarly2++) {
                var _wEarlyC2 = childNodes[_wEarly2];
                if (_wEarlyC2 && _wEarlyC2.style && _wEarlyC2.style.marginBottom > 0) {
                  node.style.counterAxisSpacing = _wEarlyC2.style.marginBottom;
                  break;
                }
              }
            }
            if (childrenHaveUniformMargin(childNodes, layoutMode)) {
              applyUniformMarginAsGap(node, childNodes, layoutMode);
            }
            ensureItemSpacingFromPositions(node, childNodes, layoutMode);
            var finalSpacing = (node.style && node.style.itemSpacing != null) ? node.style.itemSpacing : null;
            var _isRadioWrapperNode2 = node.className && node.className.indexOf('radio-button-wrapper') !== -1;
            var _isMenuNode2 = node.className && node.className.indexOf('ant-menu') !== -1;
            if (_isRadioWrapperNode2) {
            }
            if (finalSpacing == null || finalSpacing < 0) {
              // 架构级修复：不再依赖标签名白名单。
              // 只要节点配置了对齐方式（非默认的 MIN）或存在内边距，说明它在视觉上依赖 AutoLayout 
              // 来维持内部排版（如居中、Padding包裹）。此时即使算不出间距（如单节点），也不能删除 layoutMode。
              var s = node.style || {};
              var hasAlignment = (s.primaryAxisAlignItems && s.primaryAxisAlignItems !== 'MIN') ||
                                 (s.counterAxisAlignItems && s.counterAxisAlignItems !== 'MIN');
              var hasPadding = s.paddingTop || s.paddingRight || s.paddingBottom || s.paddingLeft;
              // 若子节点中有绝对定位节点，其 x/y 不参与流式排布，不应影响间距计算结论，保留 layoutMode
              var hasAbsoluteChild = childNodes.some(function(c) { return c.style && c.style.positionType === 'absolute'; });
              if (_isMenuNode2) {
              }
              if (_isRadioWrapperNode2) {
              }
              if (hasAlignment || hasPadding || hasAbsoluteChild) {
                node.style.itemSpacing = 0;
              } else {
                delete node.style.layoutMode;
                delete node.style.itemSpacing;
              }
            } else {
              // itemSpacing 已从子节点 margin 中推断出来，清理子节点 margin
              // 但若父容器是 WRAP，marginBottom 是行间距来源，先提取再删
              var _isWrapContainer2 = node.style && node.style.layoutWrap === 'WRAP';
              if (_isWrapContainer2 && !node.style.counterAxisSpacing) {
                for (var _wPre2 = 0; _wPre2 < childNodes.length; _wPre2++) {
                  var _wPreC2 = childNodes[_wPre2];
                  if (_wPreC2 && _wPreC2.style && _wPreC2.style.marginBottom > 0) {
                    node.style.counterAxisSpacing = _wPreC2.style.marginBottom;
                    break;
                  }
                }
              }
              for (var i = 0; i < childNodes.length; i++) {
                var s = childNodes[i].style || {};
                if (s.marginTop != null) delete s.marginTop;
                if (s.marginRight != null) delete s.marginRight;
                if (s.marginBottom != null) delete s.marginBottom;
                if (s.marginLeft != null) delete s.marginLeft;
              }
            }
          }
        }
        // 绝对定位子节点（position: absolute）在 CSS 里靠 z-index 浮于普通流之上，
        // Figma 没有 z-index，层叠顺序由 children 数组决定（后面的在上层）。
        // 将 positionType: absolute 的节点移到数组末尾，保证它们始终渲染在最上层。
        var _absNodes2 = [];
        var _flowNodes2 = [];
        for (var _zi2 = 0; _zi2 < childNodes.length; _zi2++) {
          var _zn2 = childNodes[_zi2];
          if (_zn2 && _zn2.style && _zn2.style.positionType === 'absolute') {
            _absNodes2.push(_zn2);
          } else {
            _flowNodes2.push(_zn2);
          }
        }
        if (_absNodes2.length > 0) childNodes = _flowNodes2.concat(_absNodes2);
        // ant-radio-group：过滤掉各 wrapper 内的 pseudo-before 竖线（Figma 里不需要，边框各自渲染）
        // 注意：选中态 wrapper（ant-radio-button-wrapper-checked）的 ::before 是左侧高亮边，不能过滤
        if (node.className && node.className.indexOf('ant-radio-group') !== -1) {
          for (var _rgi2 = 0; _rgi2 < childNodes.length; _rgi2++) {
            var _rgChild2 = childNodes[_rgi2];
            if (_rgChild2 && _rgChild2.children) {
              var _isChecked2 = _rgChild2._checkedWrapper === true;
              if (!_isChecked2) {
                _rgChild2.children = _rgChild2.children.filter(function(c) { return c.name !== 'pseudo-before'; });
              }
            }
          }
        }
        node.children = childNodes;
        // flex-wrap 容器：若 counterAxisSpacing 未设置（无 row-gap），从子节点 marginBottom 推断行间距
        if (node.style && node.style.layoutWrap === 'WRAP' && !node.style.counterAxisSpacing) {
          var _wrapSpacing2 = 0;
          for (var _wsi2 = 0; _wsi2 < childNodes.length; _wsi2++) {
            var _wsc2 = childNodes[_wsi2];
            if (_wsc2 && _wsc2.style && _wsc2.style.marginBottom > 0) {
              _wrapSpacing2 = _wsc2.style.marginBottom;
              break;
            }
          }
          if (_wrapSpacing2 > 0) node.style.counterAxisSpacing = _wrapSpacing2;
        }
      }
      // 表格行（display: table-row / <tr>）的 border-bottom 需下移到子单元格
      // 因为 Figma 中子 frame 背景会遮盖父 frame 的底部边框，浏览器表格模型不存在这个问题
      if (node.children && node.children.length > 0 && node.style && node.style.strokeBottomWeight > 0) {
        var _elDisplay2 = computed.display || '';
        if (_elDisplay2 === 'table-row' || (el.tagName || '').toLowerCase() === 'tr') {
          var _trStrokeColor2 = node.style.strokeColor;
          var _trStrokeBottomW2 = node.style.strokeBottomWeight;
          for (var _tdi2 = 0; _tdi2 < node.children.length; _tdi2++) {
            var _tdNode2 = node.children[_tdi2];
            if (!_tdNode2 || !_tdNode2.style) continue;
            if (!_tdNode2.style.strokeColor) _tdNode2.style.strokeColor = _trStrokeColor2;
            var _tdBotW2 = _tdNode2.style.strokeBottomWeight || 0;
            if (_trStrokeBottomW2 > _tdBotW2) _tdNode2.style.strokeBottomWeight = _trStrokeBottomW2;
          }
          node.style.strokeBottomWeight = 0;
        }
      }
    }

    // frame 标题：从 class boardTitle- 下的 class tt- 元素取文本作为该 frame 的 name
    if (nodeType === 'frame') {
      var frameTitle = getFrameTitleFromElement(el);
      if (frameTitle) node.name = frameTitle;
      // input/textarea 改为 frame 后需补入 placeholder 文字子节点
      if (tag === 'input' || tag === 'textarea') {
        var _inputPlaceholder2 = el.placeholder || '';
        var _inputValue2 = (el.value || '').trim();
        var _inputText2 = _inputValue2 || _inputPlaceholder2;
        if (_inputText2) {
          try {
            var _inputPl2 = node.style ? (node.style.paddingLeft || 0) : 0;
            var _inputPr2 = node.style ? (node.style.paddingRight || 0) : 0;
            var _inputPt2 = node.style ? (node.style.paddingTop || 0) : 0;
            var _inputPb2 = node.style ? (node.style.paddingBottom || 0) : 0;
            var _inputW2 = node.style && node.style.width != null ? Math.max(1, node.style.width - _inputPl2 - _inputPr2) : undefined;
            var _inputH2 = node.style && node.style.height != null ? Math.max(1, node.style.height - _inputPt2 - _inputPb2) : undefined;
            var _inputFontSize2 = node.style ? (node.style.fontSize || 14) : 14;
            var _inputColor2 = node.style ? node.style.color : undefined;
            if (!_inputValue2 && _inputPlaceholder2) {
              try {
                var _phColor2 = window.getComputedStyle(el, '::placeholder').color;
                if (_phColor2 && _phColor2 !== 'rgba(0, 0, 0, 0)') _inputColor2 = _phColor2;
              } catch (e) {}
            }
            var _isTextarea2 = tag === 'textarea';
            var _inputChildStyle2 = {
              positionType: _isTextarea2 ? 'absolute' : undefined,
              x: _inputPl2,
              y: _isTextarea2 ? _inputPt2 : undefined,
              width: _inputW2,
              height: _isTextarea2 ? _inputH2 : undefined,
              fontSize: _inputFontSize2,
              singleLine: !_isTextarea2,
              textAlignVertical: _isTextarea2 ? 'TOP' : 'CENTER',
              textAlignHorizontal: node.style ? (node.style.textAlignHorizontal || 'LEFT') : 'LEFT',
            };
            if (_inputColor2) _inputChildStyle2.color = cssColorToRgba(_inputColor2) || _inputColor2;
            if (node.style && node.style.fontFamily) _inputChildStyle2.fontFamily = node.style.fontFamily;
            if (node.style && node.style.fontFamilyStack) _inputChildStyle2.fontFamilyStack = node.style.fontFamilyStack;
            if (node.style && node.style.fontWeight) _inputChildStyle2.fontWeight = node.style.fontWeight;
            // textarea 自身 frame 对齐改为 flex-start，防止被父容器 counterAxisAlignItems:CENTER 影响
            if (_isTextarea2 && node.style) {
              node.style.alignSelf = 'MIN';
            }
            node.children = [{ type: 'text', name: 'placeholder', content: _inputText2, style: _inputChildStyle2 }];
            if (node.style) {
              delete node.style.color;
              delete node.style.fontSize;
              delete node.style.fontFamily;
              delete node.style.fontFamilyStack;
              delete node.style.fontWeight;
              delete node.style.textAlignHorizontal;
            }
          } catch (e) {}
        }
      }
    }

    // SVG：序列化为字符串，消费端用 figma.createNodeFromSVG 直接创建，保留所有 fill/stroke
    if (nodeType === 'component' && tag === 'svg') {
      var svgContent = serializeSvgElement(el, rect.width, rect.height);
      if (svgContent) {
        node.type = 'svg';
        node.ref = undefined;
        node.children = undefined;
        if (!node.style) node.style = {};
        node.style.svgContent = svgContent;
      } else {
        node.ref = 'svg-placeholder';
        node.children = undefined;
      }
    }
    return node;
  }
  var rootDesignRect = getDesignRect(dom, geo);
  const contentChildren = [];
  for (let i = 0; i < dom.children.length; i++) {
    const child = dom.children[i];
    if (hasClassPrefix(child, 'selection-')) continue;
    if (hasClassPrefix(child, 'append-')) continue;
    if (hasClassPrefix(child, 'boardTitle-')) continue;
    const tag = (child.tagName || '').toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'link') continue;
    const childNode = walk(child, rootDesignRect);
    if (childNode) contentChildren.push(childNode);
  }

  const rootStyle = buildStyleJSON(dom, rootComputed, rootDesignRect, null, cssRuleMap, globalFont);
  const pageName = dom.id || (typeof dom.className === 'string' && dom.className.trim() && dom.className.trim().split(/\s+/).find(function (c) { return c.startsWith('body-'); }) || dom.className.trim().split(/\s+/)[0]) || undefined;
  var rootSelectors = cssRuleMap ? getMatchedSelectorsForElement(dom, cssRuleMap) : [];
  const content = [
    {
      type: 'frame',
      name: pageName || 'Frame',
      className: (typeof dom.className === 'string' && dom.className.trim()) ? dom.className.trim().split(/\s+/).find(function (c) { return c.startsWith('body-'); }) || dom.className.trim().split(/\s+/)[0] : undefined,
      style: rootStyle && Object.keys(rootStyle).length ? rootStyle : undefined,
      children: contentChildren.length ? contentChildren : undefined,
    },
  ];
  if (rootSelectors.length) content[0].selectors = rootSelectors;

  var componentDef = [];
  componentDef.push({
    type: 'svg-placeholder',
    name: 'SVG Placeholder',
    style: { fills: ['#e5e5e5'] },
    children: []
  });
  componentDef.push({
    type: 'library-source-placeholder',
    name: 'Library Source Placeholder',
    style: { fills: ['#e5e5e5'] },
    children: []
  });
  var pagePayload = { name: pageName, 'component-def': componentDef, content };
  if (globalFont && globalFont.fontFamily) {
    var defaultStack = (rootComputed && rootComputed.fontFamily) ? parseFontFamilyStack(String(rootComputed.fontFamily)) : [];
    pagePayload.defaultFont = {
      fontFamily: globalFont.fontFamily,
      fontWeight: globalFont.fontWeight,
      fontStyle: globalFont.fontStyle,
      fontFamilyStack: defaultStack.length ? defaultStack : undefined
    };
  }
  return { page: pagePayload };
}

/** 将 URL 转为 base64 data URL，供 Figma 插件直接解码使用。SVG 会先绘制到 Canvas 再转 PNG。失败时保留 url。 */
function fetchImageAsBase64DataUrl(url) {
  return fetch(url, { mode: 'cors' })
    .then(function (res) { return res.ok ? res.blob() : Promise.reject(new Error(res.statusText)); })
    .then(function (blob) {
      var mimeType = blob.type || '';
      if (mimeType.indexOf('svg') >= 0 || url.toLowerCase().endsWith('.svg')) {
        // SVG 转 PNG：通过 Image + Canvas 光栅化
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onloadend = function () {
            var svgDataUrl = reader.result;
            var img = new window.Image();
            img.onload = function () {
              var canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth || 400;
              canvas.height = img.naturalHeight || 400;
              var ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              try {
                resolve(canvas.toDataURL('image/png'));
              } catch (e) {
                reject(e);
              }
            };
            img.onerror = reject;
            img.src = svgDataUrl;
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      // 非 SVG 直接转 base64 data URL
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onloadend = function () { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    });
}

/** 递归将树中 style.fills 里 type===IMAGE 且仅有 url 的项，请求图片并写入 content（base64 data URL）。 */
function inlineImageFillsInTree(obj) {
  if (!obj) return Promise.resolve();
  var promises = [];

  // 处理 style.fills 里的 IMAGE fill
  var style = obj.style;
  if (style && style.fills && Array.isArray(style.fills)) {
    style.fills.forEach(function (fill, i) {
      if (fill && fill.type === 'IMAGE' && fill.url && !fill.content) {
        promises.push(
          fetchImageAsBase64DataUrl(fill.url).then(function (dataUrl) {
            style.fills[i] = { type: 'IMAGE', content: dataUrl };
          }).catch(function (err) {
            console.warn('[image fill] 内联失败', fill.url, err && err.message);
          })
        );
      }
    });
  }

  // 处理 type==='image' 节点的 content 字段（img 标签 src），将 URL 内联为 base64
  if (obj.type === 'image' && obj.content && typeof obj.content === 'string' && !obj.content.startsWith('data:')) {
    promises.push(
      fetchImageAsBase64DataUrl(obj.content).then(function (dataUrl) {
        obj.content = dataUrl;
      }).catch(function (err) {
        console.warn('[image node] 内联失败', obj.content, err && err.message);
      })
    );
  }

  return Promise.all(promises).then(function () {
    var children = obj.children;
    if (children && children.length) {
      return Promise.all(children.map(inlineImageFillsInTree));
    }
  });
}

function domToMybricksJsonAsync(frameId, styleTagId) {
  var syncPayload = domToMybricksJson(frameId, styleTagId);
  var content = syncPayload.page && syncPayload.page.content;
  if (!content || !content.length) return Promise.resolve(syncPayload);
  return inlineImageFillsInTree(content[0]).then(function () { return syncPayload; });
}

function domToMybricksJsonWithInlineImages(frameId, styleTagId) {
  return domToMybricksJsonAsync(frameId, styleTagId);
}

function elementToMybricksJsonWithInlineImages(el, styleTagId) {
  var syncPayload = elementToMybricksJson(el, styleTagId);
  var content = syncPayload.page && syncPayload.page.content;
  if (!content || !content.length) return Promise.resolve(syncPayload);
  return inlineImageFillsInTree(content[0]).then(function () { return syncPayload; });
}

function inferNodeType(el, computed, tag) {
  if (tag === 'img') return 'image';
  if (tag === 'svg') return 'component';
  // input/textarea 识别为 frame：在 Figma 中用带边框+圆角+背景的 Frame 还原输入框外观
  // （TextNode 不支持 strokes/borderRadius，若判为 text 会导致边框和圆角丢失）
  if (tag === 'input' && (el.type === 'text' || el.type === 'number' || el.type === 'password' || el.type === 'search' || el.type === 'email' || el.type === 'tel' || el.type === 'url' || !el.type || el.type === '')) {
    return 'frame';
  }
  if (tag === 'textarea') return 'frame';
  if (tag === 'picture' || (el.querySelector && el.querySelector('img'))) return 'frame'; // wrap or container
  const display = computed.display;
  const isFlex = display === 'flex' || display === 'inline-flex';
  const isBlock = display === 'block' || display === 'flex' || display === 'grid' || display === 'inline-block' || display === 'table-cell' || display === 'table-row' || display === 'table-header-group' || display === 'table-row-group';
  const hasElementChildren = el.children && el.children.length > 0;
  const hasOnlyText = !hasElementChildren; // 无子元素
  if (hasOnlyText) {
    // 架构级修复：不再依赖 textTags 白名单。
    // 任何无子元素的叶子节点，只要带有非透明背景色、padding 或 border-radius，
    // 在视觉上就是一个容器（如 badge、tag、button 或带样式的 div），
    // 必须识别为 frame 以保留背景色、圆角和内边距等样式。
    var elBg = computed.backgroundColor || '';
    var elRadius = computed.borderRadius || computed.borderTopLeftRadius || '';
    var elPaddingTop = computed.paddingTop || '';
    var elPaddingRight = computed.paddingRight || '';
    var elPaddingBottom = computed.paddingBottom || '';
    var elPaddingLeft = computed.paddingLeft || '';
    var hasVisualBg = elBg && elBg !== 'rgba(0, 0, 0, 0)' && elBg !== 'transparent';
    var hasRadius = elRadius && elRadius !== '0px' && elRadius !== '0';
    var hasPadding = (elPaddingTop && elPaddingTop !== '0px') ||
                    (elPaddingRight && elPaddingRight !== '0px') ||
                    (elPaddingBottom && elPaddingBottom !== '0px') ||
                    (elPaddingLeft && elPaddingLeft !== '0px');
    if (hasVisualBg || hasRadius || hasPadding) {
      var tc = (el.textContent || '').trim().slice(0, 30);
      return 'frame';
    }
    if ((el.textContent || '').trim()) {
      return 'text';
    }
  }
  // 既有子元素又有文本时当作容器，子列表里会包含文本节点
  if (isFlex || isBlock) return 'frame';
  return 'group';
}

/** 解析 font-family 字符串为有序数组（保留全部名称，供插件与 Figma 可用字体匹配） */
function parseFontFamilyStack(stackStr) {
  if (!stackStr || !String(stackStr).trim()) return [];
  return String(stackStr)
    .split(',')
    .map(function (s) { return s.trim().replace(/^['"]|['"]$/g, ''); })
    .filter(Boolean);
}

/** 从 font-family 栈中解析出 Figma 可用的字体：跳过系统/通用名，取第一个实体字体；若全是系统则默认 PingFang SC（中文） */
function resolveFontFamilyFromStack(stackStr) {
  if (!stackStr || !String(stackStr).trim()) return '';
  var systemKeywords = /^(-apple-system|blinkmacsystemfont|system-ui|arial|helvetica\s*neue|helvetica|sans-serif|serif|monospace)$/i;
  /* Windows/Android 常见系统字体：栈里只有这些时不再输出为「设计字体」，回退到默认 PingFang SC，避免 JSON 里全是 Segoe UI */
  var systemFonts = /^(Segoe\s+UI|Roboto)$/i;
  var list = parseFontFamilyStack(stackStr);
  for (var i = 0; i < list.length; i++) {
    var name = list[i];
    if (!name) continue;
    if (systemKeywords.test(name)) continue;
    if (systemFonts.test(name)) continue;
    if (/^SF\s+UI\s+Text$/i.test(name)) continue;
    return name;
  }
  return 'PingFang SC';
}

/** 从画布根计算全局字体，用于后续仅在与全局不同时输出 font */
function getGlobalFont(rootEl, computed, cssRuleMap) {
  var decl = (cssRuleMap && rootEl && Object.keys(cssRuleMap).length > 0) ? getDeclaredStyleForElement(rootEl, cssRuleMap) : {};
  function d(keys) {
    var k = Array.isArray(keys) ? keys : [keys];
    for (var i = 0; i < k.length; i++) if (decl[k[i]] != null && decl[k[i]] !== '') return decl[k[i]];
    return undefined;
  }
  var num = function (v) { return (v === '' || v == null ? undefined : parseFloat(String(v))); };
  var rawStack = (d(['font-family', 'fontFamily']) || (computed && computed.fontFamily) || '').toString();
  var fontFamily = resolveFontFamilyFromStack(rawStack);
  var fw = d(['font-weight', 'fontWeight']) || (computed && computed.fontWeight);
  var fontWeight = fw === 'bold' ? 700 : (fw === 'normal' ? 400 : num(fw));
  if (fontWeight == null || Number.isNaN(fontWeight)) fontWeight = 400;
  var fs = (d(['font-style', 'fontStyle']) || (computed && computed.fontStyle) || 'normal').toString().toLowerCase();
  var fontStyle = (fs === 'italic' || fs === 'oblique') ? 'italic' : 'normal';
  return { fontFamily: fontFamily || undefined, fontWeight: fontWeight, fontStyle };
}

/** childNodes 在「导出语义」上是否仅由文本节点与 br 组成（无 span 等），用于与 br 合并为单段带 \\n 的 text */
function shouldMergeTextAndBrChildren(parentEl) {
  if (!parentEl || !parentEl.childNodes || parentEl.childNodes.length === 0) return false;
  var hasBr = false;
  var hasNonEmptyText = false;
  for (var i = 0; i < parentEl.childNodes.length; i++) {
    var n = parentEl.childNodes[i];
    if (n.nodeType === 3) {
      if ((n.textContent || '').replace(/[^\S\n]+/g, '').length > 0) hasNonEmptyText = true;
      continue;
    }
    if (n.nodeType === 1) {
      var tn = (n.tagName || '').toLowerCase();
      if (tn === 'script' || tn === 'style' || tn === 'link') continue;
      if (hasClassPrefix(n, 'selection-') || hasClassPrefix(n, 'append-') || hasClassPrefix(n, 'boardTitle-')) continue;
      if (tn === 'br') {
        hasBr = true;
        continue;
      }
      return false;
    }
    if (n.nodeType === 8) continue;
    return false;
  }
  return hasBr && hasNonEmptyText;
}

/** 按文档顺序拼接文本，br → \\n；空白与 getTextContent 一致（保留换行，折叠空格） */
function mergeTextAndBrChildNodesContent(parentEl) {
  var parts = [];
  for (var i = 0; i < parentEl.childNodes.length; i++) {
    var n = parentEl.childNodes[i];
    if (n.nodeType === 3) {
      parts.push(n.textContent || '');
      continue;
    }
    if (n.nodeType === 1) {
      var tn = (n.tagName || '').toLowerCase();
      if (tn === 'script' || tn === 'style' || tn === 'link') continue;
      if (hasClassPrefix(n, 'selection-') || hasClassPrefix(n, 'append-') || hasClassPrefix(n, 'boardTitle-')) continue;
      if (tn === 'br') {
        parts.push('\n');
        continue;
      }
    }
    if (n.nodeType === 8) continue;
  }
  var raw = parts.join('');
  return raw.trim().replace(/[^\S\n]+/g, ' ');
}

/** 取元素全部子内容（含 br）的整体文本块包围盒，用于合并后的单个 text 节点 */
function getElementContentsTextBlockRect(el) {
  if (!el || !el.ownerDocument || !el.ownerDocument.createRange) return null;
  try {
    var range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    var r = range.getBoundingClientRect();
    if (!r || (r.width <= 0 && r.height <= 0)) return null;
    return r;
  } catch (_) {
    return null;
  }
}

/** 用 Range 取文本节点的包围框（相对于视口） */
function getTextNodeRect(textNode) {
  if (!textNode || textNode.nodeType !== 3) return null;
  var doc = textNode.ownerDocument;
  if (!doc || !doc.createRange) return null;
  try {
    var range = doc.createRange();
    range.selectNodeContents(textNode);
    return range.getBoundingClientRect();
  } catch (_) {
    return null;
  }
}

/** 仅用于 div 内内联文本节点：只含位置 + 文字相关样式，不含 layout/padding */
function buildInlineTextStyle(parentEl, computed, textRect, parentRect, cssRuleMap, globalFont) {
  if (!textRect || !parentRect) return {};
  var style = {};
  style.x = Math.round(textRect.left - parentRect.left);
  style.y = Math.round(textRect.top - parentRect.top);
  // 写入文字的实测宽高，使其在 Figma 里精确对齐（尤其是 block button 靠 padding 居中时，y 已经是正确偏移）
  if (textRect.width != null && textRect.width > 0) style.width = textRect.width;
  if (textRect.height != null && textRect.height > 0) style.height = textRect.height;
  var decl = (cssRuleMap && parentEl && Object.keys(cssRuleMap).length > 0) ? getDeclaredStyleForElement(parentEl, cssRuleMap) : {};
  function d(keys) {
    var k = Array.isArray(keys) ? keys : [keys];
    for (var i = 0; i < k.length; i++) if (decl[k[i]] != null && decl[k[i]] !== '') return decl[k[i]];
    return undefined;
  }
  var num = function (v) { return (v === '' || v == null ? undefined : parseFloat(String(v))); };
  var px = function (v) { var n = num(v); return n != null && !Number.isNaN(n) ? Math.round(n) : undefined; };
  var fontSize = px(d(['font-size', 'fontSize']) || (computed && computed.fontSize));
  if (fontSize != null) {
    if (fontSize < 1) {
      var rawFsVal = d(['font-size', 'fontSize']) || (computed && computed.fontSize);
      console.warn('[fontSize<1] buildStyleJSON', { className: parentEl && parentEl.className, rawValue: rawFsVal, rounded: fontSize, el: parentEl });
    } else {
      style.fontSize = fontSize;
    }
  }
  var color = d(['color']) || (computed && computed.color);
  // 若声明层取到的是 CSS 变量，回退到 computed 实际解析值
  if (color && color.indexOf('var(') >= 0) {
    color = (computed && computed.color) || color;
  }
  if (color) {
    var rgba = cssColorToRgba(color);
    if (rgba) style.color = rgba;
  }
  var fontFamilyRaw = d(['font-family', 'fontFamily']) || (computed && computed.fontFamily);
  var fontFamily = fontFamilyRaw ? resolveFontFamilyFromStack(String(fontFamilyRaw)) : '';
  var fontWeightRaw = d(['font-weight', 'fontWeight']) || (computed && computed.fontWeight);
  var fontWeight = fontWeightRaw === 'bold' ? 700 : (fontWeightRaw === 'normal' ? 400 : num(fontWeightRaw));
  if (fontWeight == null || Number.isNaN(fontWeight)) fontWeight = 400;
  var fontStyleRaw = (d(['font-style', 'fontStyle']) || (computed && computed.fontStyle) || 'normal').toString().toLowerCase();
  var fontStyle = (fontStyleRaw === 'italic' || fontStyleRaw === 'oblique') ? 'italic' : 'normal';
  if (globalFont) {
    if (fontFamily && fontFamily !== globalFont.fontFamily) style.fontFamily = fontFamily;
    if (fontWeight !== globalFont.fontWeight) style.fontWeight = fontWeight;
    if (fontStyle !== globalFont.fontStyle) style.fontStyle = fontStyle;
  } else {
    if (fontFamily) style.fontFamily = fontFamily;
    style.fontWeight = fontWeight;
    if (fontStyle !== 'normal') style.fontStyle = fontStyle;
  }
  var stack = fontFamilyRaw ? parseFontFamilyStack(String(fontFamilyRaw)) : [];
  if (stack.length) style.fontFamilyStack = stack;
  var textAlign = (d(['text-align', 'textAlign']) || (computed && computed.textAlign) || '').toString().toLowerCase();
  if (textAlign) {
    var alignMap = { left: 'LEFT', right: 'RIGHT', center: 'CENTER', justify: 'JUSTIFIED', start: 'LEFT', end: 'RIGHT' };
    var mapped = alignMap[textAlign];
    if (mapped) style.textAlignHorizontal = mapped;
  }
  // 内联文本节点的单行判断：用 lineHeight 判断，fallback 到 height < fontSize * 2
  var _itH = style.height;
  var _itFs = style.fontSize;
  if (_itH != null && _itFs != null && _itFs > 0) {
    var _itLhRaw = computed && computed.lineHeight;
    var _itLh = (_itLhRaw && _itLhRaw !== 'normal') ? parseFloat(_itLhRaw) : null;
    if (_itLh != null && !Number.isNaN(_itLh) && _itLh > 0) {
      style.singleLine = _itH <= _itLh * 1.2;
    } else {
      style.singleLine = _itH < _itFs * 2;
    }
  }
  return style;
}

function buildStyleJSON(el, computed, rect, parentRect, cssRuleMap, globalFont) {
  const style = {};
  const num = (v) => (v === '' || v == null ? undefined : parseFloat(String(v)));
  const px = (v) => {
    const n = num(v);
    return n != null && !Number.isNaN(n) ? Math.round(n) : undefined;
  };

  // 优先从 style 标签匹配到的规则取声明，没有再用 computed
  var decl = (cssRuleMap && Object.keys(cssRuleMap).length > 0) ? getDeclaredStyleForElement(el, cssRuleMap) : {};
  function d(keys) {
    var k = Array.isArray(keys) ? keys : [keys];
    for (var i = 0; i < k.length; i++) if (decl[k[i]] != null && decl[k[i]] !== '') return decl[k[i]];
    return undefined;
  }

  // 位置与宽高一律用 API 实测值（rect 来自 getDesignRect），避免 CSS 规则里 100% 等被误解析成 100
  const x = parentRect ? Math.round(rect.left - parentRect.left) : Math.round(rect.left);
  const y = parentRect ? Math.round(rect.top - parentRect.top) : Math.round(rect.top);
  style.x = x;
  style.y = y;
  // 宽高保留小数，不取整，避免 148.66 变成 149 导致布局挤出
  const w = rect.width != null && rect.width >= 0 ? rect.width : undefined;
  const h = rect.height != null && rect.height >= 0 ? rect.height : undefined;
  if (w != null) style.width = w;
  if (h != null) style.height = h;

  const rotation = num(computed.transform);
  if (computed.transform && computed.transform !== 'none') {
    const angle = parseTransformRotation(computed.transform);
    if (angle != null) style.rotation = angle;
  }

  var opacityVal = d(['opacity']) || computed.opacity;
  if (opacityVal != null) {
    var o = parseFloat(opacityVal);
    if (!Number.isNaN(o) && o < 1) style.opacity = o;
  }

  // overflow: visible → Figma clipsContent = false（默认 true 会裁切溢出内容）
  var overflowVal = d(['overflow']) || computed.overflow;
  if (overflowVal && overflowVal.trim() === 'visible') {
    style.clipsContent = false;
  }

  // Background -> fills（优先 style 标签里的 background-image/background，再 computed）
  // 修复：bgImageDecl 存在但不含渐变时（如纯色 background 简写），不应屏蔽 computed.backgroundImage 里的渐变。
  // 正确策略：先用 declared background-image，没有则用 computed.backgroundImage，两者都没有再试 declared background 简写。
  var bgImageDecl = d(['background-image', 'backgroundImage']);
  var bgImageComputed = computed.backgroundImage || '';
  var bgImageFromBackground = d(['background']);
  var bgImage = '';
  if (bgImageDecl && bgImageDecl !== 'none') {
    bgImage = bgImageDecl;
  } else if (bgImageComputed && bgImageComputed !== 'none') {
    bgImage = bgImageComputed;
  } else if (bgImageFromBackground && bgImageFromBackground.indexOf('linear-gradient') >= 0) {
    bgImage = bgImageFromBackground;
  }
  var gradientFill = bgImage ? parseLinearGradientFromBgImage(bgImage) : null;
  var imageUrl = bgImage ? parseUrlFromBgImage(bgImage) : null;
  if (gradientFill) {
    // 同时保留背景色作为底层 fill，避免渐变透明区域在 Figma 中透出阴影导致整体变深
    var _bgColorDecl = d(['background-color', 'backgroundColor']) || computed.backgroundColor;
    // 若声明层取到的是 CSS 变量，回退到 computed 实际解析值
    if (_bgColorDecl && _bgColorDecl.indexOf('var(') >= 0) {
      _bgColorDecl = computed.backgroundColor || _bgColorDecl;
    }
    var _bgColorRgba = _bgColorDecl ? cssColorToRgba(_bgColorDecl) : null;
    style.fills = _bgColorRgba ? [_bgColorRgba, gradientFill] : [gradientFill];
  } else if (imageUrl) {
    style.fills = [{ type: 'IMAGE', url: imageUrl }];
  } else {
    var bg = d(['background-color', 'backgroundColor', 'background']) || computed.backgroundColor;
    // 若声明层取到的是 CSS 变量，回退到 computed 实际解析值
    if (bg && bg.indexOf('var(') >= 0) {
      bg = computed.backgroundColor || bg;
    }
    if (bg) {
      var rgba = cssColorToRgba(bg);
      if (rgba) style.fills = [rgba];
    }
  }

  // Border：先尝试四边独立检测（border-top/right/bottom/left），不一致时输出各自的 strokeXxxWeight；
  // 四边完全相同时退化为统一的 strokeWeight，以保持对旧版消费端的兼容。
  var _btW = px(d(['border-top-width']) || computed.borderTopWidth) || 0;
  var _brW = px(d(['border-right-width']) || computed.borderRightWidth) || 0;
  var _bbW = px(d(['border-bottom-width']) || computed.borderBottomWidth) || 0;
  var _blW = px(d(['border-left-width']) || computed.borderLeftWidth) || 0;
  var _btStyle = (d(['border-top-style']) || computed.borderTopStyle || 'none').toString().toLowerCase();
  var _brStyle = (d(['border-right-style']) || computed.borderRightStyle || 'none').toString().toLowerCase();
  var _bbStyle = (d(['border-bottom-style']) || computed.borderBottomStyle || 'none').toString().toLowerCase();
  var _blStyle = (d(['border-left-style']) || computed.borderLeftStyle || 'none').toString().toLowerCase();
  var _btColor = d(['border-top-color']) || computed.borderTopColor;
  var _brColor = d(['border-right-color']) || computed.borderRightColor;
  var _bbColor = d(['border-bottom-color']) || computed.borderBottomColor;
  var _blColor = d(['border-left-color']) || computed.borderLeftColor;
  // 若声明层取到的是 CSS 变量，回退到 computed 实际解析值
  if (_btColor && _btColor.indexOf('var(') >= 0) _btColor = computed.borderTopColor || _btColor;
  if (_brColor && _brColor.indexOf('var(') >= 0) _brColor = computed.borderRightColor || _brColor;
  if (_bbColor && _bbColor.indexOf('var(') >= 0) _bbColor = computed.borderBottomColor || _bbColor;
  if (_blColor && _blColor.indexOf('var(') >= 0) _blColor = computed.borderLeftColor || _blColor;
  // border 简写兜底：若四边均未读到有效值，尝试 border 简写
  var _borderShorthand = d(['border']);
  if (_borderShorthand && (_btW === 0 && _brW === 0 && _bbW === 0 && _blW === 0)) {
    var _parsedB = parseBorderShorthand(_borderShorthand);
    if (_parsedB && _parsedB.width > 0) {
      _btW = _brW = _bbW = _blW = _parsedB.width;
      _btStyle = _brStyle = _bbStyle = _blStyle = _parsedB.style || 'solid';
      _btColor = _brColor = _bbColor = _blColor = _parsedB.color;
    }
  }
  // 过滤掉 style=none 的边（视为无边框）
  if (_btStyle === 'none') _btW = 0;
  if (_brStyle === 'none') _brW = 0;
  if (_bbStyle === 'none') _bbW = 0;
  if (_blStyle === 'none') _blW = 0;
  var _hasBorder = _btW > 0 || _brW > 0 || _bbW > 0 || _blW > 0;
  if (_hasBorder) {
    var _allSameW = (_btW === _brW && _brW === _bbW && _bbW === _blW);
    var _btColorN = cssColorToRgba(_btColor) || _btColor || 'rgba(0, 0, 0, 0)';
    var _brColorN = cssColorToRgba(_brColor) || _brColor || 'rgba(0, 0, 0, 0)';
    var _bbColorN = cssColorToRgba(_bbColor) || _bbColor || 'rgba(0, 0, 0, 0)';
    var _blColorN = cssColorToRgba(_blColor) || _blColor || 'rgba(0, 0, 0, 0)';
    var _allSameColor = (_btColorN === _brColorN && _brColorN === _bbColorN && _bbColorN === _blColorN);
    if (_allSameW && _allSameColor) {
      // 四边统一，用简单的 strokeWeight（兼容旧格式）
      style.strokeWeight = _btW;
      style.strokeColor = _btColorN;
    } else {
      // 四边不同，分别输出各自宽度和颜色
      // strokeColor/strokeWeight 用有效边中第一个的颜色（Figma strokes 颜色统一），宽度用 individualStrokeWeights
      var _firstColor = _btW > 0 ? _btColorN : (_brW > 0 ? _brColorN : (_bbW > 0 ? _bbColorN : _blColorN));
      style.strokeColor = _firstColor;
      style.strokeTopWeight = _btW;
      style.strokeRightWeight = _brW;
      style.strokeBottomWeight = _bbW;
      style.strokeLeftWeight = _blW;
    }
  }

  // Border radius
  var tl = px(d(['border-top-left-radius', 'borderRadius']) || computed.borderTopLeftRadius);
  var tr = px(d(['border-top-right-radius', 'borderRadius']) || computed.borderTopRightRadius);
  var br = px(d(['border-bottom-right-radius', 'borderRadius']) || computed.borderBottomRightRadius);
  var bl = px(d(['border-bottom-left-radius', 'borderRadius']) || computed.borderBottomLeftRadius);
  if (tl != null || tr != null || br != null || bl != null) {
    if (tl === tr && tr === br && br === bl) style.borderRadius = tl ?? 0;
    else style.borderRadius = [tl ?? 0, tr ?? 0, br ?? 0, bl ?? 0];
  }

  // box-shadow -> shadows（与 Figma DROP_SHADOW 对应；仅外阴影，inset 忽略）
  // 优先用 computed（含所有来源），再试 style 标签声明
  var boxShadowStr = (computed && (computed.boxShadow || computed['box-shadow'])) || d(['box-shadow', 'boxShadow']);
  if (boxShadowStr && String(boxShadowStr).trim() !== '' && String(boxShadowStr).trim() !== 'none') {
    var shadows = parseBoxShadow(String(boxShadowStr));
    shadows = shadows.filter(function (s) {
      return s.blur > 0 || s.offsetX !== 0 || s.offsetY !== 0 || (s.spread && s.spread !== 0);
    });
    if (shadows.length > 0) style.shadows = shadows;
  }

  // Flex / Grid -> Auto layout（gap 等同 itemSpacing）；padding 仅来自声明或 computed，不再与 margin 混合
  var display = d(['display']) || computed.display;
  // [debug:layout] 追踪 radio-button-wrapper / label 的 display 和布局判断
  var _isRadioWrapper = (el.className && typeof el.className === 'string' && el.className.indexOf('radio-button-wrapper') !== -1);
  if (_isRadioWrapper) {
  }
  if (display === 'flex' || display === 'inline-flex') {
    var dir = d(['flex-direction', 'flexDirection']) || computed.flexDirection;
    style.layoutMode = dir === 'column' || dir === 'column-reverse' ? 'VERTICAL' : 'HORIZONTAL';
    var gap = px(d(['gap']) || computed.gap);
    if (gap != null && gap > 0) style.itemSpacing = gap;
    // flex-wrap: wrap → Figma layoutWrap=WRAP；同时读 row-gap 作为换行后的行间距(counterAxisSpacing)
    var flexWrapVal = (d(['flex-wrap', 'flexWrap']) || computed.flexWrap || '').toString().toLowerCase();
    if (flexWrapVal === 'wrap' || flexWrapVal === 'wrap-reverse') {
      if (style.layoutMode === 'HORIZONTAL') {
        style.layoutWrap = 'WRAP';
        var rowGap = px(d(['row-gap', 'rowGap']) || computed.rowGap);
        if (rowGap != null && rowGap > 0) style.counterAxisSpacing = rowGap;
      }
    }
    style.paddingTop = px(d(['padding-top', 'paddingTop']) || computed.paddingTop);
    style.paddingRight = px(d(['padding-right', 'paddingRight']) || computed.paddingRight);
    style.paddingBottom = px(d(['padding-bottom', 'paddingBottom']) || computed.paddingBottom);
    style.paddingLeft = px(d(['padding-left', 'paddingLeft']) || computed.paddingLeft);
    var justifyContent = d(['justify-content', 'justifyContent']) || computed.justifyContent;
    var alignItems = d(['align-items', 'alignItems']) || computed.alignItems;
    // 当 computed 返回浏览器默认值 "normal" 时，主动扫描 cssRuleMap 用 el.matches() 寻找声明值
    // 场景：Shadow DOM 内 getComputedStyle 未能拿到 antd CSS cascade 的值，但 style 标签里有规则
    if ((!alignItems || alignItems === 'normal') && cssRuleMap && typeof el.matches === 'function') {
      for (var _sel in cssRuleMap) {
        var _cssText = cssRuleMap[_sel] || '';
        if (_cssText.indexOf('align-items') === -1) continue;
        var _matched = false;
        try { _matched = el.matches(_sel); } catch (_e) {}
        if (!_matched) continue;
        var _parts = _cssText.split(';');
        for (var _pi = 0; _pi < _parts.length; _pi++) {
          var _part = _parts[_pi].trim();
          var _col = _part.indexOf(':');
          if (_col <= 0) continue;
          var _key = _part.slice(0, _col).trim();
          var _val = _part.slice(_col + 1).trim();
          if (_key === 'align-items' && _val) { alignItems = _val; break; }
        }
        if (alignItems && alignItems !== 'normal') break;
      }
    }
    // 终极 fallback：cssRuleMap 里没有规则（如 antd 全局 CSS 不在 style 标签内），
    // 且 computed 也是 "normal"（Shadow DOM cascade 丢失），改用子元素实际位置反推。
    // HORIZONTAL flex 时：取第一个子元素的 getBoundingClientRect()，
    // 若子元素中心点与容器中心点对齐（误差 <3px）→ CENTER；否则 MIN。
    // 注意：SVG 在 Shadow DOM 里 getBoundingClientRect().height 可能为 0，需特殊处理。
    var _elClassForDebug = (el.className && typeof el.className === 'string') ? el.className : '';
    if ((!alignItems || alignItems === 'normal') && style.layoutMode === 'HORIZONTAL' && el.children && el.children.length > 0) {
      var _containerRect = el.getBoundingClientRect();
      var _containerH = _containerRect.height;
      var _containerTop = _containerRect.top;
      var _sampleChild = null;
      // 优先取有实际高度的子元素，其次取任意子元素（含 SVG）
      for (var _ci = 0; _ci < el.children.length; _ci++) {
        var _ch = el.children[_ci];
        var _chH = _ch.getBoundingClientRect().height;
        if (_chH > 0) { _sampleChild = _ch; break; }
        if (!_sampleChild) _sampleChild = _ch; // 备用：height=0 的 SVG 等
      }
      if (_sampleChild && _containerH > 0) {
        var _childRect = _sampleChild.getBoundingClientRect();
        if (_childRect.height > 0) {
          var _childCenterY = _childRect.top - _containerTop + _childRect.height / 2;
          var _containerCenterY = _containerH / 2;
          alignItems = Math.abs(_childCenterY - _containerCenterY) < 3 ? 'center' : 'flex-start';
        } else {
          var _childOffsetY = _childRect.top - _containerTop;
          alignItems = (_childOffsetY > _containerH * 0.2 && _childOffsetY < _containerH * 0.8) ? 'center' : 'flex-start';
        }
      }
    }
    if ((!justifyContent || justifyContent === 'normal') && cssRuleMap && typeof el.matches === 'function') {
      for (var _selJ in cssRuleMap) {
        var _cssTextJ = cssRuleMap[_selJ] || '';
        if (_cssTextJ.indexOf('justify-content') === -1) continue;
        var _matchedJ = false;
        try { _matchedJ = el.matches(_selJ); } catch (_eJ) {}
        if (!_matchedJ) continue;
        var _partsJ = _cssTextJ.split(';');
        for (var _pj = 0; _pj < _partsJ.length; _pj++) {
          var _partJ = _partsJ[_pj].trim();
          var _colJ = _partJ.indexOf(':');
          if (_colJ <= 0) continue;
          var _keyJ = _partJ.slice(0, _colJ).trim();
          var _valJ = _partJ.slice(_colJ + 1).trim();
          if (_keyJ === 'justify-content' && _valJ) { justifyContent = _valJ; break; }
        }
        if (justifyContent && justifyContent !== 'normal') break;
      }
    }
    // 统一转 lowercase 再查表，避免大写/空格导致 map miss（如 "Center"、" center"）
    var alignItemsNorm = alignItems ? String(alignItems).trim().toLowerCase() : undefined;
    var justifyContentNorm = justifyContent ? String(justifyContent).trim().toLowerCase() : undefined;
    var alignMap = { 'flex-start': 'MIN', 'flex-end': 'MAX', center: 'CENTER', 'space-between': 'SPACE_BETWEEN', 'space-around': 'CENTER', 'space-evenly': 'CENTER', normal: 'MIN', stretch: 'MIN', baseline: 'BASELINE', start: 'MIN', end: 'MAX' };
    style.primaryAxisAlignItems = alignMap[justifyContentNorm] || 'MIN';
    style.counterAxisAlignItems = alignMap[alignItemsNorm] || 'MIN';
    // ant-radio-wrapper 包含圆形图标+文字，BASELINE 在 Figma 里会让图标贴顶，强制改为 CENTER
    var _isAntRadioWrapper = (el.className && typeof el.className === 'string' && el.className.indexOf('ant-radio-wrapper') !== -1);
    if (_isAntRadioWrapper && alignItemsNorm === 'baseline') {
      style.counterAxisAlignItems = 'CENTER';
    }
    if (_isRadioWrapper) {
    }
  } else if (display === 'block' || display === 'inline-block' || display === 'inline') {
    // 架构级修复：不再依赖 blockTextTags 白名单。
    // 如果一个 block/inline 元素没有子元素（只有文本），但因为有背景/padding被升级为 frame，
    // 我们为其开启 HORIZONTAL 自动布局，以完美模拟 CSS 的 padding 包裹效果。
    // 同理，若唯一子元素是内联文字标签（label/span/b/em 等），语义上等同于纯文本容器，也开启 Auto Layout 以支持垂直居中。
    const hasElementChildren = el.children && el.children.length > 0;
    var INLINE_TEXT_TAGS = ['label', 'span', 'b', 'em', 'strong', 'i', 'a', 'small', 'mark'];
    var hasSingleInlineTextChild = el.children &&
      el.children.length === 1 &&
      INLINE_TEXT_TAGS.indexOf((el.children[0].tagName || '').toLowerCase()) !== -1;
    if (!hasElementChildren || hasSingleInlineTextChild) {
      style.layoutMode = 'HORIZONTAL';
      // 动态读取 text-align，而不是无脑居中，兼容 div 的左对齐和 button 的居中
      var textAlign = (d(['text-align', 'textAlign']) || computed.textAlign || '').toString().toLowerCase();
      var alignMap = { left: 'MIN', right: 'MAX', center: 'CENTER', justify: 'MIN', start: 'MIN', end: 'MAX' };
      style.primaryAxisAlignItems = alignMap[textAlign] || 'MIN';
      // 垂直对齐：优先用几何位置反推（子元素中心 vs 容器中心，误差 <3px → CENTER）。
      // 原先用"容器高 > 子高 * 1.5"判断的方案会把图标按钮（容器22px/图标8px）误判为顶对齐。
      style.paddingTop = px(d(['padding-top', 'paddingTop']) || computed.paddingTop);
      style.paddingRight = px(d(['padding-right', 'paddingRight']) || computed.paddingRight);
      style.paddingBottom = px(d(['padding-bottom', 'paddingBottom']) || computed.paddingBottom);
      style.paddingLeft = px(d(['padding-left', 'paddingLeft']) || computed.paddingLeft);
      // 垂直对齐：优先用几何位置反推（子元素中心 vs 容器中心，误差 <3px → CENTER）。
      // 原先用"容器高 > 子高 * 1.5"判断的方案会把图标按钮（容器22px/图标8px）误判为顶对齐。
      var _blockChildEl = hasSingleInlineTextChild ? el.children[0] : null;
      var _blockContainerRect = el.getBoundingClientRect();
      var _blockContainerH = _blockContainerRect.height;
      if (_blockChildEl && _blockContainerH > 0) {
        var _blockChildRect = _blockChildEl.getBoundingClientRect();
        var _blockChildH = _blockChildRect.height;
        if (_blockChildH > 0) {
          var _blockChildCenterY = _blockChildRect.top - _blockContainerRect.top + _blockChildH / 2;
          style.counterAxisAlignItems = Math.abs(_blockChildCenterY - _blockContainerH / 2) < 3 ? 'CENTER' : 'MIN';
        } else {
          // 子元素高度为 0（SVG 等）：看 top 偏移是否在容器中间区域
          var _blockChildOffsetY = _blockChildRect.top - _blockContainerRect.top;
          style.counterAxisAlignItems = (_blockChildOffsetY > _blockContainerH * 0.2 && _blockChildOffsetY < _blockContainerH * 0.8) ? 'CENTER' : 'MIN';
        }
      } else {
        style.counterAxisAlignItems = 'CENTER';
      }
    } else {
      // 有多个子元素（如 ant-radio-button-wrapper）：computed display 在 Shadow DOM 中可能降级为 block/inline-block，
      // 但实际上是 flex 容器（antd 外部 CSS 未 cascade 进 Shadow DOM）。
      // 用几何反推：遍历子元素，取有实际高度的一个，判断其中心是否与容器中心对齐，以此推断是否垂直居中。
      var _multiContainerRect = el.getBoundingClientRect();
      var _multiContainerH = _multiContainerRect.height;
      if (_multiContainerH > 0) {
        var _multiSampleChild = null;
        for (var _mci = 0; _mci < el.children.length; _mci++) {
          var _mch = el.children[_mci];
          var _mchH = _mch.getBoundingClientRect().height;
          // 跳过高度等于容器高度的子元素（如 position:absolute 撑满容器的），优先取比容器矮的
          if (_mchH > 0 && _mchH < _multiContainerH * 0.95) { _multiSampleChild = _mch; break; }
        }
        if (!_multiSampleChild) {
          // 降级：取任意有高度的子元素
          for (var _mci2 = 0; _mci2 < el.children.length; _mci2++) {
            if (el.children[_mci2].getBoundingClientRect().height > 0) { _multiSampleChild = el.children[_mci2]; break; }
          }
        }
        if (_multiSampleChild) {
          var _multiChildRect = _multiSampleChild.getBoundingClientRect();
          var _multiChildCenterY = _multiChildRect.top - _multiContainerRect.top + _multiChildRect.height / 2;
          var _isCentered = Math.abs(_multiChildCenterY - _multiContainerH / 2) < 3;
          if (_isRadioWrapper) {
          }
          if (_isCentered) {
            style.layoutMode = 'HORIZONTAL';
            style.counterAxisAlignItems = 'CENTER';
            var _textAlignMulti = (d(['text-align', 'textAlign']) || computed.textAlign || '').toString().toLowerCase();
            var _alignMapMulti = { left: 'MIN', right: 'MAX', center: 'CENTER', justify: 'MIN', start: 'MIN', end: 'MAX' };
            style.primaryAxisAlignItems = _alignMapMulti[_textAlignMulti] || 'MIN';
            style.paddingTop = px(d(['padding-top', 'paddingTop']) || computed.paddingTop);
            style.paddingRight = px(d(['padding-right', 'paddingRight']) || computed.paddingRight);
            style.paddingBottom = px(d(['padding-bottom', 'paddingBottom']) || computed.paddingBottom);
            style.paddingLeft = px(d(['padding-left', 'paddingLeft']) || computed.paddingLeft);
          }
        }
      }
    }
  } else if (display === 'grid' || display === 'inline-grid') {
    // grid-auto-flow: row = 按行排（横向多列）→ HORIZONTAL；column = 按列排（纵向多行）→ VERTICAL
    style.layoutMode = (d(['grid-auto-flow']) || computed.gridAutoFlow || 'row') === 'column' ? 'VERTICAL' : 'HORIZONTAL';
    var gridGap = px(d(['gap', 'row-gap']) || computed.gap || computed.rowGap || computed.columnGap);
    if (gridGap != null && gridGap > 0) style.itemSpacing = gridGap;
    var gridTemplateCols = d(['grid-template-columns', 'gridTemplateColumns']) || (computed && computed.gridTemplateColumns);
    var colCount = parseGridTemplateColumnsCount(gridTemplateCols);
    if (colCount != null && colCount > 0) {
      style.layoutGridColumns = colCount;
      if (style.layoutMode === 'HORIZONTAL') style.layoutWrap = 'WRAP';
    }
    var rowGap = px(d(['row-gap', 'rowGap', 'gap']) || (computed && computed.rowGap) || (computed && computed.gap));
    if (rowGap != null && rowGap > 0) style.counterAxisSpacing = rowGap;
    style.paddingTop = px(d(['padding-top', 'paddingTop']) || computed.paddingTop);
    style.paddingRight = px(d(['padding-right', 'paddingRight']) || computed.paddingRight);
    style.paddingBottom = px(d(['padding-bottom', 'paddingBottom']) || computed.paddingBottom);
    style.paddingLeft = px(d(['padding-left', 'paddingLeft']) || computed.paddingLeft);
    style.primaryAxisAlignItems = 'MIN';
    style.counterAxisAlignItems = 'MIN';
  }

  // Text styles（优先 style 标签，再 computed）；字体仅在与全局不同时输出
  var fontSize = px(d(['font-size', 'fontSize']) || computed.fontSize);
  if (fontSize != null) {
    if (fontSize < 1) {
      var rawFsVal = d(['font-size', 'fontSize']) || computed.fontSize;
      console.warn('[fontSize<1] buildInlineTextStyle', { className: el.className, rawValue: rawFsVal, rounded: fontSize, el: el });
    } else {
      style.fontSize = fontSize;
    }
  }
  var color = d(['color']) || computed.color;
  // 若声明层取到的是 CSS 变量，回退到 computed 实际解析值
  if (color && color.indexOf('var(') >= 0) {
    color = computed.color || color;
  }
  if (color) {
    var rgba = cssColorToRgba(color);
    if (rgba) style.color = rgba;
  }
  var fontFamilyRaw = d(['font-family', 'fontFamily']) || computed.fontFamily;
  var fontFamily = fontFamilyRaw ? resolveFontFamilyFromStack(String(fontFamilyRaw)) : '';
  var fontWeightRaw = d(['font-weight', 'fontWeight']) || computed.fontWeight;
  var fontWeight = fontWeightRaw === 'bold' ? 700 : (fontWeightRaw === 'normal' ? 400 : num(fontWeightRaw));
  if (fontWeight == null || Number.isNaN(fontWeight)) fontWeight = 400;
  var fontStyleRaw = (d(['font-style', 'fontStyle']) || computed.fontStyle || 'normal').toString().toLowerCase();
  var fontStyle = (fontStyleRaw === 'italic' || fontStyleRaw === 'oblique') ? 'italic' : 'normal';
  if (globalFont) {
    if (fontFamily && fontFamily !== globalFont.fontFamily) style.fontFamily = fontFamily;
    if (fontWeight !== globalFont.fontWeight) style.fontWeight = fontWeight;
    if (fontStyle !== globalFont.fontStyle) style.fontStyle = fontStyle;
  } else {
    if (fontFamily) style.fontFamily = fontFamily;
    style.fontWeight = fontWeight;
    if (fontStyle !== 'normal') style.fontStyle = fontStyle;
  }
  var stack = fontFamilyRaw ? parseFontFamilyStack(String(fontFamilyRaw)) : [];
  if (stack.length) style.fontFamilyStack = stack;
  var textAlign = d(['text-align', 'textAlign']) || computed.textAlign;
  if (textAlign) {
    var alignMap = { left: 'LEFT', right: 'RIGHT', center: 'CENTER', justify: 'JUSTIFIED', start: 'LEFT', end: 'RIGHT' };
    var mapped = alignMap[String(textAlign).toLowerCase()];
    if (mapped) style.textAlignHorizontal = mapped;
  }
  var textDecoration = d(['text-decoration', 'textDecoration', 'text-decoration-line']) || computed.textDecorationLine;
  if (textDecoration && textDecoration !== 'none') {
    if (String(textDecoration).indexOf('underline') >= 0) style.textDecoration = 'UNDERLINE';
    else if (String(textDecoration).indexOf('line-through') >= 0) style.textDecoration = 'STRIKETHROUGH';
  }

  // margin：用于后续在自动布局下转成 spacer 节点，不参与 padding/背景
  var _mTRaw = d(['margin-top', 'marginTop']);
  var _mRRaw = d(['margin-right', 'marginRight']);
  var _mBRaw = d(['margin-bottom', 'marginBottom']);
  var _mLRaw = d(['margin-left', 'marginLeft']);
  // 若声明层取到 CSS 变量或 calc，降级到 computed
  var mT = px((_mTRaw && String(_mTRaw).indexOf('var(') < 0 && String(_mTRaw).indexOf('calc(') < 0 ? _mTRaw : null) || computed.marginTop);
  var mR = px((_mRRaw && String(_mRRaw).indexOf('var(') < 0 && String(_mRRaw).indexOf('calc(') < 0 ? _mRRaw : null) || computed.marginRight);
  var mB = px((_mBRaw && String(_mBRaw).indexOf('var(') < 0 && String(_mBRaw).indexOf('calc(') < 0 ? _mBRaw : null) || computed.marginBottom);
  var mL = px((_mLRaw && String(_mLRaw).indexOf('var(') < 0 && String(_mLRaw).indexOf('calc(') < 0 ? _mLRaw : null) || computed.marginLeft);
  if (mT != null) style.marginTop = mT;
  if (mR != null) style.marginRight = mR;
  if (mB != null) style.marginBottom = mB;
  if (mL != null) style.marginLeft = mL;

  // position: absolute/fixed → 消费端需让该节点脱离 Auto Layout 流式排布，统一标记为 'absolute'
  // 用 getPropertyValue 而非 .position 直接访问，Shadow DOM 环境下后者可能返回空字符串
  var positionDeclared = d(['position']);
  var positionComputed = computed.getPropertyValue ? computed.getPropertyValue('position') : computed.position;
  var positionVal = (positionDeclared || positionComputed || '').toString().toLowerCase();
  if (positionVal === 'absolute' || positionVal === 'fixed') {
    style.positionType = 'absolute';
  }

  return style;
}

function getM(node, side) {
  var s = node.style || {};
  if (side === 'T') return s.marginTop ?? 0;
  if (side === 'R') return s.marginRight ?? 0;
  if (side === 'B') return s.marginBottom ?? 0;
  return s.marginLeft ?? 0;
}

/** 任意 flex 流中的子节点存在负值 margin，说明 flex 间距不均匀，不能用 Auto Layout */
function anyChildHasMargin(childNodes) {
  for (var i = 0; i < childNodes.length; i++) {
    var s = childNodes[i].style || {};
    // 绝对定位子节点不参与 flex 流，其 margin 不影响布局，跳过
    if (s.positionType === 'absolute') continue;
    if (s.marginTop < 0 || s.marginRight < 0 || s.marginBottom < 0 || s.marginLeft < 0) return true;
  }
  return false;
}

/** 兄弟之间间距是否均匀（相邻间距 = prev.marginB + curr.marginT 都相同），可合并成 itemSpacing */
function childrenHaveUniformMargin(childNodes, layoutMode) {
  if (childNodes.length <= 1) return true;
  var isVertical = layoutMode === 'VERTICAL';
  var gapBetween = isVertical
    ? getM(childNodes[0], 'B') + getM(childNodes[1], 'T')
    : getM(childNodes[0], 'R') + getM(childNodes[1], 'L');
  for (var i = 1; i < childNodes.length - 1; i++) {
    var g = isVertical
      ? getM(childNodes[i], 'B') + getM(childNodes[i + 1], 'T')
      : getM(childNodes[i], 'R') + getM(childNodes[i + 1], 'L');
    if (g !== gapBetween) return false;
  }
  return true;
}

/** 均匀时把相邻间距并入父级 itemSpacing，并从子节点 style 移除 margin */
function applyUniformMarginAsGap(parentNode, childNodes, layoutMode) {
  if (childNodes.length <= 1) return;
  var sty = parentNode.style || {};
  var isVertical = layoutMode === 'VERTICAL';
  var gapBetween = isVertical
    ? getM(childNodes[0], 'B') + getM(childNodes[1], 'T')
    : getM(childNodes[0], 'R') + getM(childNodes[1], 'L');
  sty.itemSpacing = (sty.itemSpacing || 0) + gapBetween;
  for (var i = 0; i < childNodes.length; i++) {
    var s = childNodes[i].style || {};
    if (s.marginTop != null) delete s.marginTop;
    if (s.marginRight != null) delete s.marginRight;
    if (s.marginBottom != null) delete s.marginBottom;
    if (s.marginLeft != null) delete s.marginLeft;
  }
}

/** 有自动布局时用前两个子节点的实际位置反推间距，避免 margin 未采集到时 itemSpacing 为 0 导致子元素粘在一起 */
function ensureItemSpacingFromPositions(parentNode, childNodes, layoutMode) {
  if (childNodes.length < 2) return;
  var a = childNodes[0].style || {};
  var b = childNodes[1].style || {};
  var isVertical = layoutMode === 'VERTICAL';
  var actualGap;
  if (isVertical) {
    var aBottom = (a.y != null && a.height != null) ? a.y + a.height : null;
    if (aBottom != null && b.y != null) actualGap = Math.round(b.y - aBottom);
  } else {
    var aRight = (a.x != null && a.width != null) ? a.x + a.width : null;
    if (aRight != null && b.x != null) actualGap = Math.round(b.x - aRight);
  }
  if (actualGap != null && actualGap > 0) {
    var sty = parentNode.style || {};
    var current = sty.itemSpacing || 0;
    if (actualGap > current) sty.itemSpacing = actualGap;
  }
}

function getTextContent(el) {
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return el.value || el.placeholder || '';
  // 保留换行符，只折叠同行内的多余空白（空格/tab），避免换行被压缩成空格
  return (el.textContent || '').trim().replace(/[^\S\n]+/g, ' ');
}

function isShowingPlaceholder(el) {
  const tag = (el.tagName || '').toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') return false;
  return !el.value && !!el.placeholder;
}

/**
 * 获取元素的 ::before 或 ::after 伪元素文本节点 JSON。
 * 伪元素不是真实 DOM，无法用 getBoundingClientRect 精确定位，
 * 位置基于父元素矩形 + margin 偏移估算。
 * @param {Element} el 宿主元素
 * @param {string} pseudo '::before' 或 '::after'
 * @param {object} geo getGeoviewScaleAndOrigin 返回值
 * @param {object} parentRect 父节点设计稿矩形 {x,y,width,height}
 * @param {object} elRect 宿主元素设计稿矩形 {x,y,width,height}
 * @param {object|null} cssRuleMap
 * @param {object|null} globalFont
 * @returns {object|null}
 */
function getPseudoTextNode(el, pseudo, geo, parentRect, elRect, cssRuleMap, globalFont) {
  try {
    // elRect 无效时无法估算位置，直接跳过（getDesignRect 返回的是 left/top/width/height，不是 x/y）
    if (!elRect || typeof elRect.left !== 'number' || typeof elRect.top !== 'number' ||
        isNaN(elRect.left) || isNaN(elRect.top) || isNaN(elRect.width) || isNaN(elRect.height)) {
      return null;
    }

    var ps = window.getComputedStyle(el, pseudo);
    var content = ps.content;
    // content 为 none / normal 时完全无渲染内容，直接跳过
    if (!content || content === 'none' || content === 'normal') return null;
    // 过滤 display:none 或 visibility:hidden 或 opacity:0 的伪元素（如 Ant Design 动画层）
    if (ps.display === 'none' || ps.visibility === 'hidden') return null;
    if (parseFloat(ps.opacity) === 0) return null;
    // content: '""' 或去引号 trim 后为空 / 无可见字符 → 尝试图形型伪元素（border/background 分割线等）
    if (content === '""') return getPseudoShapeNode(el, pseudo, ps, geo, parentRect, elRect);
    // 去掉首尾引号，如 "\":\"" → ":"，再 trim 过滤空白（如 Ant Design button ::after 的 content: " "）
    var text = content.replace(/^["']|["']$/g, '').trim();
    if (!text || !/\S/.test(text)) return getPseudoShapeNode(el, pseudo, ps, geo, parentRect, elRect);

    var fontSize = parseFloat(ps.fontSize) || 14;
    var color = ps.color;
    var marginLeft = parseFloat(ps.marginInlineStart || ps.marginLeft) || 0;
    var marginRight = parseFloat(ps.marginInlineEnd || ps.marginRight) || 0;

    var estWidth = Math.ceil(fontSize * text.length * 0.65);
    var estHeight = Math.ceil(fontSize * 1.4);

    var pxOff = parentRect && typeof parentRect.left === 'number' && !isNaN(parentRect.left) ? parentRect.left : 0;
    var pyOff = parentRect && typeof parentRect.top === 'number' && !isNaN(parentRect.top) ? parentRect.top : 0;

    var relX, relY;
    if (pseudo === '::before') {
      relX = (elRect.left - pxOff) - estWidth - marginRight + marginLeft;
    } else {
      relX = (elRect.left - pxOff) + elRect.width + marginLeft;
    }
    relY = elRect.top - pyOff;

    // 最终保护：确保 x/y/width/height 均为有限数值
    var safeX = isFinite(relX) ? Math.round(relX) : 0;
    var safeY = isFinite(relY) ? Math.round(relY) : 0;
    var safeW = isFinite(estWidth) && estWidth > 0 ? estWidth : 10;
    var safeH = isFinite(estHeight) && estHeight > 0 ? estHeight : 20;

    var pseudoStyle = {
      x: safeX,
      y: safeY,
      width: safeW,
      height: safeH,
      fontSize: Math.round(fontSize),
      singleLine: true,
    };
    // 还原 margin-inline-start/end，用于 Auto Layout 子节点间距
    if (marginLeft > 0) pseudoStyle.marginLeft = Math.round(marginLeft);
    if (marginRight > 0) pseudoStyle.marginRight = Math.round(marginRight);

    if (color) {
      var rgba = cssColorToRgba(color);
      if (rgba) pseudoStyle.color = rgba;
    }

    if (globalFont) {
      var fw = parseFloat(ps.fontWeight) || 400;
      var ff = ps.fontFamily ? resolveFontFamilyFromStack(ps.fontFamily) : '';
      if (ff && ff !== globalFont.fontFamily) pseudoStyle.fontFamily = ff;
      if (fw !== globalFont.fontWeight) pseudoStyle.fontWeight = fw;
    }

    return {
      type: 'text',
      name: pseudo === '::before' ? 'pseudo-before' : 'pseudo-after',
      content: text,
      style: pseudoStyle,
    };
  } catch (e) {
    console.warn('[pseudo] catch error', { pseudo, tag: el && el.tagName, error: String(e) });
    return null;
  }
}

/**
 * 处理"图形型"伪元素（content 为空但有 border/background 可见样式，如 Tabs 分割线）。
 * 伪元素通常是 position:absolute，位置基于宿主元素矩形 + top/right/bottom/left 偏移估算。
 * @param {Element} el 宿主元素
 * @param {string} pseudo '::before' 或 '::after'
 * @param {CSSStyleDeclaration} ps getComputedStyle(el, pseudo) 的结果（已由调用方计算好）
 * @param {object} geo getGeoviewScaleAndOrigin 返回值
 * @param {object} parentRect 父节点设计稿矩形 {left,top,width,height}
 * @param {object} elRect 宿主元素设计稿矩形 {left,top,width,height}
 * @returns {object|null}
 */
function getPseudoShapeNode(el, pseudo, ps, geo, parentRect, elRect) {
  try {
    // display:none 或 visibility:hidden 或 opacity:0 → 不可见，跳过（如 checkbox 勾选动画层）
    if (ps.display === 'none' || ps.visibility === 'hidden') return null;
    if (parseFloat(ps.opacity) === 0) return null;

    // TODO: checkbox/radio 勾形伪元素（ant-checkbox-inner::after、ant-radio-inner::after 等）暂不支持。
    // 特征：宿主 class 含 "checkbox-inner" 或 "radio-inner"，且有 border 构成勾形/圆形选中标记。
    var elClass = (el && el.className) ? String(el.className) : '';
    if (/checkbox-inner|radio-inner/i.test(elClass)) return null;

    var bBottom = parseFloat(ps.borderBottomWidth) || 0;
    var bTop    = parseFloat(ps.borderTopWidth)    || 0;
    var bLeft   = parseFloat(ps.borderLeftWidth)   || 0;
    var bRight  = parseFloat(ps.borderRightWidth)  || 0;
    var hasBorder = bBottom > 0 || bTop > 0 || bLeft > 0 || bRight > 0;

    // 读取 background-color（getComputedStyle 已解析 CSS 变量为真实 RGB 值）
    var bgColor = ps.backgroundColor;
    var bgNotEmpty = bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)';

    // 既无 border 也无背景色 → 不可见，跳过
    if (!hasBorder && !bgNotEmpty) return null;

    // --- 坐标估算 ---
    // 伪元素是 position:absolute，解析 top/right/bottom/left 值（px 值才可用，auto 则忽略）
    var psTop    = ps.top    !== 'auto' ? parseFloat(ps.top)    : null;
    var psBottom = ps.bottom !== 'auto' ? parseFloat(ps.bottom) : null;
    var psLeft   = ps.left   !== 'auto' ? parseFloat(ps.left)   : null;
    var psRight  = ps.right  !== 'auto' ? parseFloat(ps.right)  : null;

    // 直接读取 getComputedStyle 计算后的 width/height（已将 100%/auto 转为实际像素值）
    var psWidth  = parseFloat(ps.width);
    var psHeight = parseFloat(ps.height);
    var hasPsWidth  = psWidth  > 0 && isFinite(psWidth);
    var hasPsHeight = psHeight > 0 && isFinite(psHeight);

    // 伪元素的 padding（content-box 下 getComputedStyle.height/width 只含内容，需补上 padding）
    var psPaddingTop    = parseFloat(ps.paddingTop)    || 0;
    var psPaddingBottom = parseFloat(ps.paddingBottom) || 0;
    var psPaddingLeft   = parseFloat(ps.paddingLeft)   || 0;
    var psPaddingRight  = parseFloat(ps.paddingRight)  || 0;

    // 宿主元素的 border（CSS absolute 的 top/left 是相对宿主的 padding-edge，
    // Figma 子节点 y/x 是相对宿主 frame 的外边缘，两者差 borderTopWidth / borderLeftWidth）
    var _hostCs = window.getComputedStyle(el);
    var hostBorderTop    = parseFloat(_hostCs.borderTopWidth)    || 0;
    var hostBorderBottom = parseFloat(_hostCs.borderBottomWidth) || 0;
    var hostBorderLeft   = parseFloat(_hostCs.borderLeftWidth)   || 0;
    var hostBorderRight  = parseFloat(_hostCs.borderRightWidth)  || 0;

    // 伪元素坐标是 position:absolute 相对宿主元素（el）的，直接使用 psLeft/psTop，不需要父容器偏移
    // （elRelX/elRelY 仅作调试备用，勿在坐标计算中使用）
    var elRelX = elRect.left - (parentRect && typeof parentRect.left === 'number' && !isNaN(parentRect.left) ? parentRect.left : 0);
    var elRelY = elRect.top  - (parentRect && typeof parentRect.top  === 'number' && !isNaN(parentRect.top)  ? parentRect.top  : 0);
    void elRelX; void elRelY;

    // 宽度：优先直接读取计算宽度（如 width:1px / width:100%），left/right 反推降级为 fallback
    // content-box 下 width 不含 padding，需加上左右 padding
    var w;
    if (hasPsWidth) {
      w = psWidth + (ps.boxSizing !== 'border-box' ? psPaddingLeft + psPaddingRight : 0);
    } else if (psLeft !== null && psRight !== null) {
      w = elRect.width - hostBorderLeft - hostBorderRight - psLeft - psRight;
    } else if (psLeft !== null) {
      w = elRect.width - hostBorderLeft - psLeft;
    } else if (psRight !== null) {
      w = elRect.width - hostBorderRight - psRight;
    } else {
      w = elRect.width;
    }
    // 高度：优先直接读取计算高度（如 height:100%），top/bottom 反推和 border/bg 推算降级为 fallback
    // content-box 下 height 不含 padding，需加上上下 padding
    var h;
    if (hasPsHeight) {
      h = psHeight + (ps.boxSizing !== 'border-box' ? psPaddingTop + psPaddingBottom : 0);
    } else if (psTop !== null && psBottom !== null) {
      h = elRect.height - hostBorderTop - hostBorderBottom - psTop - psBottom;
    } else if (hasBorder) {
      h = Math.max(bTop, bBottom, bLeft, bRight);
      if (h < 1) h = 1;
    } else {
      // 纯背景色伪元素：无法反推高度，兜底为 2px
      h = 2;
    }

    // x 坐标：CSS absolute 的 left 是相对宿主 padding-edge，Figma 坐标相对宿主 border 外边缘
    // 需加上 hostBorderLeft 来对齐
    var x;
    if (psLeft !== null) {
      x = psLeft + hostBorderLeft;
    } else if (psRight !== null) {
      x = elRect.width - hostBorderRight - psRight - w;
    } else {
      x = 0;
    }

    // y 坐标：同理，加上 hostBorderTop
    var y;
    if (psTop !== null) {
      y = psTop + hostBorderTop;
    } else if (psBottom !== null) {
      y = elRect.height - hostBorderBottom - psBottom - h;
    } else {
      y = 0;
    }

    // 确保数值有效
    var safeX = isFinite(x) ? Math.round(x) : 0;
    var safeY = isFinite(y) ? Math.round(y) : 0;
    var safeW = isFinite(w) && w > 0 ? Math.round(w) : 1;
    var safeH = isFinite(h) && h > 0 ? Math.round(h) : 1;

    var shapeStyle = {
      x: safeX,
      y: safeY,
      width: safeW,
      height: safeH,
      positionType: 'absolute',
    };

    // background-color → fills
    if (bgNotEmpty) {
      var bgRgba = cssColorToRgba(bgColor);
      if (bgRgba) shapeStyle.fills = [bgRgba];
      else shapeStyle.fills = [];
    } else {
      shapeStyle.fills = [];
    }

    // border-radius（getComputedStyle 已解析 var() 为 px 值）
    var brtl = parseFloat(ps.borderTopLeftRadius) || 0;
    var brtr = parseFloat(ps.borderTopRightRadius) || 0;
    var brbr = parseFloat(ps.borderBottomRightRadius) || 0;
    var brbl = parseFloat(ps.borderBottomLeftRadius) || 0;
    if (brtl > 0 || brtr > 0 || brbr > 0 || brbl > 0) {
      if (brtl === brtr && brtr === brbr && brbr === brbl) {
        shapeStyle.borderRadius = Math.round(brtl);
      } else {
        shapeStyle.borderRadius = [Math.round(brtl), Math.round(brtr), Math.round(brbr), Math.round(brbl)];
      }
    }

    // border → strokeColor + 四边独立描边
    if (hasBorder) {
      // 取各边颜色（通常相同，取第一个非透明边的颜色）
      var borderColor = ps.borderBottomColor || ps.borderTopColor || ps.borderLeftColor || ps.borderRightColor;
      if (!borderColor || borderColor === 'transparent' || borderColor === 'rgba(0, 0, 0, 0)') {
        // 尝试 border shorthand
        var borderShort = ps.border || ps.borderBottom || ps.borderTop;
        var parsed = parseBorderShorthand(borderShort);
        if (parsed) borderColor = parsed.color;
      }
      var borderRgba = borderColor ? cssColorToRgba(borderColor) : null;
      if (borderRgba && borderRgba !== 'rgba(0, 0, 0, 0)') {
        shapeStyle.strokeColor = borderRgba;
        shapeStyle.strokeAlign = 'INSIDE';
        if (bTop    > 0) shapeStyle.strokeTopWeight    = bTop;
        if (bRight  > 0) shapeStyle.strokeRightWeight  = bRight;
        if (bBottom > 0) shapeStyle.strokeBottomWeight = bBottom;
        if (bLeft   > 0) shapeStyle.strokeLeftWeight   = bLeft;
      }
    }

    return {
      type: 'rectangle',
      name: pseudo === '::before' ? 'pseudo-before' : 'pseudo-after',
      style: shapeStyle,
    };
  } catch (e) {
    console.warn('[pseudo-shape] catch error', { pseudo, tag: el && el.tagName, error: String(e) });
    return null;
  }
}

function parseTransformRotation(transform) {
  if (!transform || transform === 'none') return undefined;
  const m = transform.match(/matrix\(([^)]+)\)/);
  if (!m) return undefined;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (parts.length >= 6) {
    const a = parts[0];
    const b = parts[1];
    return (Math.atan2(b, a) * 180) / Math.PI;
  }
  return undefined;
}

function cssColorToHex(cssColor) {
  if (!cssColor) return null;
  // Already hex
  if (typeof cssColor === 'string' && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(cssColor)) return cssColor;
  // rgb(r,g,b) or rgba(r,g,b,a)
  const m = String(cssColor).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    const r = parseInt(m[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(m[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(m[3], 10).toString(16).padStart(2, '0');
    return '#' + r + g + b;
  }
  return null;
}

/**
 * 统一转换 CSS 颜色为 rgba(r, g, b, a) 格式（Figma 插件用 figma.util.rgba() 解析）。
 * - 任何颜色都转为 rgba(0-255, 0-255, 0-255, 0-1)
 * - 支持：hex、rgb、rgba、transparent、named colors
 */
function cssColorToRgba(cssColor) {
  if (!cssColor) return null;
  var s = String(cssColor).trim();
  if (s === '' || s === 'transparent') return 'rgba(0, 0, 0, 0)';
  
  // 已经是 rgba 格式，直接返回
  var rgbaMatch = s.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  if (rgbaMatch) return s;
  
  // rgb(r, g, b) → rgba(r, g, b, 1)
  var rgbMatch = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    return 'rgba(' + rgbMatch[1] + ', ' + rgbMatch[2] + ', ' + rgbMatch[3] + ', 1)';
  }
  
  // hex: #RGB 或 #RRGGBB 或 #RRGGBBAA
  var hexMatch = s.match(/^#([0-9A-Fa-f]{3,8})$/);
  if (hexMatch) {
    var hex = hexMatch[1];
    var r, g, b, a = 1;
    
    if (hex.length === 3) {
      // #RGB → #RRGGBB
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      // #RRGGBB
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else if (hex.length === 8) {
      // #RRGGBBAA
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
      a = parseInt(hex.slice(6, 8), 16) / 255;
    } else {
      return null;
    }
    
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + (Math.round(a * 1000) / 1000) + ')';
  }
  
  // 其他格式（named color 等）返回原样，让 Figma 插件侧处理
  return s;
}

/**
 * 获取固定 id 的 Shadow DOM 宿主（画布和 style 都在其 shadowRoot 下）。
 *
 * @returns {Element | null}
 */
function getShadowHost() {
  return document.getElementById(SHADOW_HOST_ID) || null;
}

/**
 * 从 Shadow DOM 解析画布根：div#frameId 下第一个 class 以 "body-" 开头的节点。
 *
 * @param {string} frameId - 画布容器 div 的 id
 * @returns {Element | null}
 */
function resolveFrameRoot(frameId) {
  const host = getShadowHost();
  if (!host || !host.shadowRoot) return null;
  const root = host.shadowRoot;
  const frameContainer = root.querySelector('#' + CSS.escape(frameId));
  if (!frameContainer) return null;
  const frameRoot = frameContainer.querySelector('[class^="body-"], [class*=" body-"]');
  return frameRoot || null;
}

/**
 * Build a map of selector -> declaration string from a <style id="..."> tag.
 * 用 style#id 查，避免与画布上同 id 的 div 等元素冲突；找不到时再在 document 内用 style#id 查。
 *
 * @param {string} styleTagId - ID of the <style> element
 * @param {Document|ShadowRoot} [root] - Document or shadowRoot to query in first; then document.
 * @returns {Record<string, string> | null} selector -> cssText or null if not found
 */
function getCssRulesBySelector(styleTagId, root) {
  var styleSelector = 'style#' + CSS.escape(styleTagId);
  var styleEl = null;
  if (root && root.querySelector) {
    try {
      styleEl = root.querySelector(styleSelector);
    } catch (_) {}
  }
  if (!styleEl && typeof document !== 'undefined' && document.querySelector) {
    try {
      styleEl = document.querySelector(styleSelector);
    } catch (_) {}
  }
  if (!styleEl || (styleEl.tagName || '').toLowerCase() !== 'style') return null;
  var sheet = styleEl.sheet;
  if (!sheet || !sheet.cssRules) return null;
  var map = {};
  for (var i = 0; i < sheet.cssRules.length; i++) {
    var rule = sheet.cssRules[i];
    if (rule.selectorText) map[rule.selectorText.trim()] = rule.style.cssText;
  }
  return map;
}

// Export for browser (attach to window so you can run in console)
if (typeof window !== 'undefined') {
  window.SHADOW_HOST_ID = SHADOW_HOST_ID;
  window.domToMybricksJson = domToMybricksJson;
  window.domToMybricksJsonWithInlineImages = domToMybricksJsonWithInlineImages;
  window.comToMybricksJsonWithInlineImages = comToMybricksJsonWithInlineImages;
  window.comToMybricksJson = comToMybricksJson;
  window.elementToMybricksJson = elementToMybricksJson;
  window.elementToMybricksJsonWithInlineImages = elementToMybricksJsonWithInlineImages;
  window.getCssRulesBySelector = getCssRulesBySelector;
  window.getShadowHost = getShadowHost;
  window.resolveFrameRoot = resolveFrameRoot;
}

// ES module export if supported
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SHADOW_HOST_ID, domToMybricksJson, comToMybricksJson, elementToMybricksJson, elementToMybricksJsonWithInlineImages, domToMybricksJsonWithInlineImages, comToMybricksJsonWithInlineImages, getCssRulesBySelector, getShadowHost, resolveFrameRoot };
}
