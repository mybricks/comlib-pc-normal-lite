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

/** 从 style 标签规则里收集匹配当前元素的所有声明（后匹配的覆盖前面的） */
function getDeclaredStyleForElement(el, cssRuleMap) {
  var declared = {};
  for (var selector in cssRuleMap) {
    if (!simpleSelectorMatches(el, selector)) continue;
    var cssText = cssRuleMap[selector];
    if (!cssText) continue;
    var parts = cssText.split(';');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      var colon = part.indexOf(':');
      if (colon <= 0) continue;
      var key = part.slice(0, colon).trim();
      var val = part.slice(colon + 1).trim();
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
    .replace(/([MLCQZ])([-\d.])/g, '$1 $2')
    .replace(/(\d)([MLCQZ])/g, '$1 $2')
    .replace(/(\d)([-\d.])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解析 CSS background-image 中的 linear-gradient → { type: 'GRADIENT_LINEAR', gradientStops, angle }。
 * 例: linear-gradient(90deg, #6dd5a6 0%, #4dbd8a 100%) 或 rgb(...) 色值。
 */
function parseLinearGradientFromBgImage(bgImage) {
  if (!bgImage || typeof bgImage !== 'string') return null;
  var match = bgImage.match(/linear-gradient\s*\(\s*([\d.]+)?deg\s*,\s*(.+)\)/);
  if (!match) return null;
  var angle = match[1] != null ? parseFloat(match[1], 10) : 0;
  var rest = match[2];
  var stops = [];
  var part = rest.split(/\s*,\s*(?=#|rgb)/);
  for (var i = 0; i < part.length; i++) {
    var seg = part[i].trim();
    var pct = seg.match(/\s+(\d+(?:\.\d+)?)%?\s*$/);
    var pos = pct ? parseFloat(pct[1], 10) / 100 : (i === 0 ? 0 : i === part.length - 1 ? 1 : i / (part.length - 1));
    var colorStr = seg.replace(/\s+\d+(?:\.\d+)?%?\s*$/, '').trim();
    var outColor = cssColorToRgba(colorStr);
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

/** 从 SVG 元素提取 path 的 d 与 fill-rule，供 vectorPaths 使用 */
function getSvgPathData(svgEl) {
  if (!svgEl || (svgEl.tagName || '').toLowerCase() !== 'svg') return [];
  var paths = svgEl.querySelectorAll('path');
  var out = [];
  for (var i = 0; i < paths.length; i++) {
    var p = paths[i];
    var d = p.getAttribute('d');
    if (!d) continue;
    d = normalizeSvgPathForFigma(d);
    if (!d) continue;
    var fillRule = (p.getAttribute('fill-rule') || (window.getComputedStyle && window.getComputedStyle(p).fillRule) || '').toLowerCase();
    out.push({
      data: d,
      windingRule: fillRule === 'evenodd' ? 'EVENODD' : 'NONZERO',
    });
  }
  return out;
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

    // Skip invisible or zero-size
    if (rect.width <= 0 && rect.height <= 0 && tag !== 'svg') return null;
    if (computed.display === 'none' || computed.visibility === 'hidden') return null;

    // body 下方 class 以 selection- 开头的节点不参与输出
    if (hasClassPrefix(el, 'selection-')) return null;

    const nodeType = inferNodeType(el, computed, tag);
    const style = buildStyleJSON(el, computed, rect, parentRect, cssRuleMap, globalFont);

    const node = {
      type: nodeType,
      name: el.getAttribute('aria-label') || (el.className && typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : null) || tag,
      className: el.className && typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] || undefined : undefined,
      style: style && Object.keys(style).length ? style : undefined,
      content: undefined,
      children: undefined,
    };
    var matchedSelectors = cssRuleMap ? getMatchedSelectorsForElement(el, cssRuleMap) : [];
    if (matchedSelectors.length) node.selectors = matchedSelectors;

    if (nodeType === 'text') {
      node.content = getTextContent(el);
      if (node.content === '' && !el.querySelector('img, svg')) return null;
    }

    if (nodeType === 'image') {
      const src = (el.tagName || '').toLowerCase() === 'img' ? (el.currentSrc || el.src || el.getAttribute('src')) : null;
      if (!src) return null;
      node.content = src;
    }

    const childNodes = [];
    var isLibrarySource = !!(el.getAttribute && el.getAttribute('data-library-source') != null);
    if (nodeType !== 'text' && nodeType !== 'image' && !(tag === 'svg') && !isLibrarySource) {
      // 支持 div 内同时有文本和 DOM：按 childNodes 顺序，元素走 walk，文本节点单独成 text 节点；SVG 与 data-library-source 用占位组件不遍历子节点
      for (let i = 0; i < el.childNodes.length; i++) {
        const child = el.childNodes[i];
        if (child.nodeType === 1) {
          const elChild = child;
          const skip = (elChild.tagName || '').toLowerCase() === 'script' ||
            (elChild.tagName || '').toLowerCase() === 'style' ||
            (elChild.tagName || '').toLowerCase() === 'link';
          if (skip) continue;
          if (hasClassPrefix(elChild, 'selection-')) continue;
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
              content: textContent.replace(/\s+/g, ' '),
              style: inlineStyle && Object.keys(inlineStyle).length ? inlineStyle : undefined,
            };
            if (node.selectors && node.selectors.length) textNodeJson.selectors = node.selectors.slice();
            if (node.className) textNodeJson.className = node.className;
            childNodes.push(textNodeJson);
          }
        }
      }
      if (childNodes.length) {
        var layoutMode = node.style && (node.style.layoutMode === 'VERTICAL' || node.style.layoutMode === 'HORIZONTAL') ? node.style.layoutMode : null;
        if (layoutMode) {
          if (childrenHaveUniformMargin(childNodes, layoutMode)) {
            applyUniformMarginAsGap(node, childNodes, layoutMode);
          }
          ensureItemSpacingFromPositions(node, childNodes, layoutMode);
          var finalSpacing = (node.style && node.style.itemSpacing != null) ? node.style.itemSpacing : null;
          if (finalSpacing == null || finalSpacing < 0) {
            delete node.style.layoutMode;
            delete node.style.itemSpacing;
          } else {
            for (var i = 0; i < childNodes.length; i++) {
              var s = childNodes[i].style || {};
              if (s.marginTop != null) delete s.marginTop;
              if (s.marginRight != null) delete s.marginRight;
              if (s.marginBottom != null) delete s.marginBottom;
              if (s.marginLeft != null) delete s.marginLeft;
            }
          }
        }
        node.children = childNodes;
      }
    }

    // frame 标题：从 class boardTitle- 下的 class tt- 元素取文本作为该 frame 的 name
    if (nodeType === 'frame') {
      var frameTitle = getFrameTitleFromElement(el);
      if (frameTitle) node.name = frameTitle;
    }

    // SVG 使用占位组件，不导出 path 数据
    if (nodeType === 'component' && tag === 'svg') {
      node.ref = 'svg-placeholder';
      node.children = undefined;
    }
    // 带 data-library-source 的节点作为灰色占位，不往下遍历
    if (nodeType === 'component' && isLibrarySource) {
      node.ref = 'library-source-placeholder';
      node.children = undefined;
    }

    return node;
  }

  const contentChildren = [];
  var rootDesignRect = getDesignRect(dom, geo);
  for (let i = 0; i < dom.children.length; i++) {
    const child = dom.children[i];
    if (hasClassPrefix(child, 'selection-')) continue;
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

function inferNodeType(el, computed, tag) {
  if (tag === 'img') return 'image';
  if (tag === 'svg') return 'component';
  if (el.getAttribute && el.getAttribute('data-library-source') != null) return 'component';
  if (tag === 'picture' || (el.querySelector && el.querySelector('img'))) return 'frame'; // wrap or container
  const display = computed.display;
  const isFlex = display === 'flex' || display === 'inline-flex';
  const isBlock = display === 'block' || display === 'flex' || display === 'grid' || display === 'inline-block';
  const textTags = ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'a', 'button', 'li', 'td', 'th'];
  const hasElementChildren = el.children && el.children.length > 0;
  const hasOnlyText = !hasElementChildren; // 无子元素
  if (textTags.indexOf(tag) >= 0 && hasOnlyText) return 'text';
  // div 等仅含文本（无子元素）时当作 text
  if (hasOnlyText && (el.textContent || '').trim()) return 'text';
  // 既有子元素又有文本时当作容器，子列表里会包含文本节点
  if (tag === 'input' && (el.type === 'text' || el.type === 'password' || !el.type)) return 'text';
  if (tag === 'textarea') return 'text';
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
  var decl = (cssRuleMap && parentEl && Object.keys(cssRuleMap).length > 0) ? getDeclaredStyleForElement(parentEl, cssRuleMap) : {};
  function d(keys) {
    var k = Array.isArray(keys) ? keys : [keys];
    for (var i = 0; i < k.length; i++) if (decl[k[i]] != null && decl[k[i]] !== '') return decl[k[i]];
    return undefined;
  }
  var num = function (v) { return (v === '' || v == null ? undefined : parseFloat(String(v))); };
  var px = function (v) { var n = num(v); return n != null && !Number.isNaN(n) ? Math.round(n) : undefined; };
  var fontSize = px(d(['font-size', 'fontSize']) || (computed && computed.fontSize));
  if (fontSize != null) style.fontSize = fontSize;
  var color = d(['color']) || (computed && computed.color);
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

  // Background -> fills（优先 style 标签里的 background-image/background，再 computed）
  var bgImageDecl = d(['background-image', 'backgroundImage']) || d(['background']);
  var bgImage = (bgImageDecl && bgImageDecl.indexOf('linear-gradient') >= 0) ? bgImageDecl : (computed.backgroundImage || '');
  var gradientFill = bgImage ? parseLinearGradientFromBgImage(bgImage) : null;
  if (gradientFill) {
    style.fills = [gradientFill];
  } else {
    var bg = d(['background-color', 'backgroundColor', 'background']) || computed.backgroundColor;
    if (bg) {
      var rgba = cssColorToRgba(bg);
      if (rgba) style.fills = [rgba];
    }
  }

  // Border：支持 border 简写（如 "1px solid transparent"），宽高样式和颜色（含透明）均生效
  var borderShorthand = d(['border']);
  var borderW, borderStyle, borderColor;
  if (borderShorthand) {
    var parsed = parseBorderShorthand(borderShorthand);
    if (parsed) {
      borderW = parsed.width;
      borderStyle = parsed.style;
      borderColor = parsed.color;
    }
  }
  if (borderW == null) borderW = px(d(['border-width', 'borderWidth', 'border-top-width']) || computed.borderTopWidth) || 0;
  if (borderStyle == null) borderStyle = d(['border-style', 'borderTopStyle']) || computed.borderTopStyle;
  if (borderColor == null) borderColor = d(['border-color', 'borderTopColor']) || computed.borderTopColor;
  if (borderW > 0 && borderStyle !== 'none') {
    style.strokeWeight = borderW;
    style.strokeColor = cssColorToRgba(borderColor) || borderColor || 'rgba(0, 0, 0, 0)';
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
  if (display === 'flex' || display === 'inline-flex') {
    var dir = d(['flex-direction', 'flexDirection']) || computed.flexDirection;
    style.layoutMode = dir === 'column' || dir === 'column-reverse' ? 'VERTICAL' : 'HORIZONTAL';
    var gap = px(d(['gap']) || computed.gap);
    if (gap != null && gap > 0) style.itemSpacing = gap;
    style.paddingTop = px(d(['padding-top', 'paddingTop']) || computed.paddingTop);
    style.paddingRight = px(d(['padding-right', 'paddingRight']) || computed.paddingRight);
    style.paddingBottom = px(d(['padding-bottom', 'paddingBottom']) || computed.paddingBottom);
    style.paddingLeft = px(d(['padding-left', 'paddingLeft']) || computed.paddingLeft);
    var justifyContent = d(['justify-content', 'justifyContent']) || computed.justifyContent;
    var alignItems = d(['align-items', 'alignItems']) || computed.alignItems;
    var alignMap = { 'flex-start': 'MIN', 'flex-end': 'MAX', center: 'CENTER', 'space-between': 'SPACE_BETWEEN', 'space-around': 'CENTER', 'space-evenly': 'CENTER' };
    style.primaryAxisAlignItems = alignMap[justifyContent] || 'MIN';
    style.counterAxisAlignItems = alignMap[alignItems] || 'MIN';
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
  if (fontSize != null) style.fontSize = fontSize;
  var color = d(['color']) || computed.color;
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
  var mT = px(d(['margin-top', 'marginTop']) || computed.marginTop);
  var mR = px(d(['margin-right', 'marginRight']) || computed.marginRight);
  var mB = px(d(['margin-bottom', 'marginBottom']) || computed.marginBottom);
  var mL = px(d(['margin-left', 'marginLeft']) || computed.marginLeft);
  if (mT != null) style.marginTop = mT;
  if (mR != null) style.marginRight = mR;
  if (mB != null) style.marginBottom = mB;
  if (mL != null) style.marginLeft = mL;

  return style;
}

function getM(node, side) {
  var s = node.style || {};
  if (side === 'T') return s.marginTop ?? 0;
  if (side === 'R') return s.marginRight ?? 0;
  if (side === 'B') return s.marginBottom ?? 0;
  return s.marginLeft ?? 0;
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
  if (tag === 'input' || tag === 'textarea') return el.value || '';
  return (el.textContent || '').trim().replace(/\s+/g, ' ');
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
  window.comToMybricksJson = comToMybricksJson;
  window.getCssRulesBySelector = getCssRulesBySelector;
  window.getShadowHost = getShadowHost;
  window.resolveFrameRoot = resolveFrameRoot;
}

// ES module export if supported
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SHADOW_HOST_ID, domToMybricksJson, comToMybricksJson, getCssRulesBySelector, getShadowHost, resolveFrameRoot };
}
