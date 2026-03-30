/**
 * ============================================================
 * node-builder.js  —  节点类型推断 / 文本内容 / 伪元素处理层
 * ============================================================
 * 职责：
 *   - 节点类型：inferNodeType
 *   - 文本内容提取：getTextContent / getTextWithActualLineBreaksForElement /
 *     shouldMergeTextAndBrChildren / mergeTextAndBrChildNodesContent /
 *     normalizeTextExportPreserveTrailing
 *   - 文本布局辅助：getTextNodeRect / getElementContentsTextBlockRect /
 *     shouldMarkWidthConstrainedForEdgeWhitespace / applyWidthConstrainedForFigmaEdgeWhitespace /
 *     applyTextOverflowEllipsisExport / shouldSetTextAlignVerticalCenterForAbsoluteTextLeaf
 *   - 表单辅助：isShowingPlaceholder
 *   - 伪元素：getPseudoTextNode / getPseudoShapeNode
 * 规则：依赖 css-parsers（颜色/阴影）和 style-builder（buildInlineTextStyle）。
 * ============================================================
 */
var _nbcp = (typeof module !== 'undefined') ? require('./css-parsers') : {};
var _nbsb = (typeof module !== 'undefined') ? require('./style-builder') : {};
var _nbdh = (typeof module !== 'undefined') ? require('./dom-helpers') : {};
var cssColorToRgba = _nbcp.cssColorToRgba || cssColorToRgba;
var cssColorToHex = _nbcp.cssColorToHex || cssColorToHex;
var parseBoxShadow = _nbcp.parseBoxShadow || parseBoxShadow;
var parseTransformRotation = _nbcp.parseTransformRotation || parseTransformRotation;
var buildInlineTextStyle = _nbsb.buildInlineTextStyle || buildInlineTextStyle;
var hasClassPrefix = _nbdh.hasClassPrefix || hasClassPrefix;

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
    if (/\S/.test(el.textContent || '')) {
      return 'text';
    }
  }
  // 既有子元素又有文本时当作容器，子列表里会包含文本节点
  if (isFlex || isBlock) return 'frame';
  return 'group';
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

/** 按文档顺序拼接文本，br → \\n；空白与 getTextContent 一致（保留换行，折叠空格，保留行尾空白） */
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
  return normalizeTextExportPreserveTrailing(raw, false);
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

/**
 * Figma 在 textAutoResize=WIDTH_AND_HEIGHT 时，行首/行尾空白不参与撑宽，文本框会比浏览器实测窄。
 * 有此类空白且已有实测 width 时标记 widthConstrained，消费侧固定宽度以保留空白占位。
 */
function shouldMarkWidthConstrainedForEdgeWhitespace(content) {
  if (content == null || typeof content !== 'string') return false;
  return /^\s/.test(content) || /\s$/.test(content);
}

/** @param {{ style?: object, content?: string }} json */
function applyWidthConstrainedForFigmaEdgeWhitespace(json) {
  if (!json || !json.style) return;
  if (json.style.singleLine !== true || json.style.width == null) return;
  if (!shouldMarkWidthConstrainedForEdgeWhitespace(json.content)) return;
  json.style.widthConstrained = true;
}

/**
 * 父元素有 text-overflow:ellipsis 时，将子文本 width 收窄到父容器可用宽度，
 * 并标记 widthConstrained/textOverflow，由 Figma 插件的 textTruncation='ENDING' 自动渲染省略号。
 * @param {object} json type:text 节点（会改写 style.width 等，不改 content）
 * @param {Element} parentEl 包裹该文本的 DOM 元素
 * @param {CSSStyleDeclaration} computed parentEl 的计算样式
 * @param {object} geo scale 等
 * @param {Text|null} textNode 原始 #text 节点（暂未使用，保留供将来扩展）
 * @param {object|null} parentDesignRect 父元素的 design rect（含 width，已除以 geo.scale）
 */
function applyTextOverflowEllipsisExport(json, parentEl, computed, geo, textNode, parentDesignRect) {
  if (!json || !json.style || !parentEl || !computed) return;
  if ((computed.textOverflow || '') !== 'ellipsis') return;
  if ((computed.overflowX || computed.overflow || '') === 'visible') return;
  var full = json.content;
  if (full == null || typeof full !== 'string' || full.indexOf('\n') >= 0) return;

  // 父容器可用宽度 = 父设计宽度 - text.x（已含 paddingLeft 偏移）- paddingRight
  var parentW = parentDesignRect ? parentDesignRect.width
    : (parentEl.getBoundingClientRect().width / ((geo && geo.scale) || 1));
  var paddingRight = parseFloat(computed.paddingRight || '0');
  var availW = parentW - (json.style.x || 0) - paddingRight;
  if (!(availW > 0)) return;
  if (json.style.width != null && json.style.width <= availW) return;

  json.style.width = availW;
  json.style.widthConstrained = true;
  json.style.textOverflow = 'ellipsis';
  json.style.singleLine = true;
}

/**
 * 导出用文本规范化：折叠空白（可选是否把换行也压成空格），去掉行首空白，保留行尾空白；无非空白字符则返回 ''。
 * @param {string} raw
 * @param {boolean} collapseNewlinesToSpace - true 时等同原 element walk 的 /\\s+/g
 */
function normalizeTextExportPreserveTrailing(raw, collapseNewlinesToSpace) {
  if (raw == null || raw === '') return '';
  var pat = collapseNewlinesToSpace ? /\s+/g : /[^\S\n]+/g;
  var s = String(raw).replace(pat, ' ');
  s = s.replace(/^[\s\uFEFF\xA0]+/, '');
  if (!/\S/.test(s)) return '';
  return s;
}

function getTextContent(el) {
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return el.value || el.placeholder || '';
  // 保留换行符，只折叠同行内的多余空白；保留行尾空白（与 String#trim 不同）
  return normalizeTextExportPreserveTrailing(el.textContent || '', false);
}

/**
 * 对多行文本元素（singleLine:false，含 CJK+数字），递归遍历所有子节点（包括嵌套 span 等），
 * 用 Range.getClientRects() 逐字符检测 DOM 实际断行位置，在换行处插入 '\n'。
 * 仅当结果中确实存在 '\n' 时返回新字符串，否则返回 null（不改原 content）。
 * @param {Element} el 文本元素（type:'text' 对应的 DOM 节点）
 * @returns {string|null}
 */
function getTextWithActualLineBreaksForElement(el) {
  var pieces = [];
  function collectPieces(node) {
    if (node.nodeType === 3) {
      var t = node.textContent || '';
      if (!t) return;
      try {
        var range = document.createRange();
        for (var i = 0; i < t.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          var rects = range.getClientRects();
          pieces.push({ ch: t[i], top: (rects && rects.length) ? Math.round(rects[0].top) : null });
        }
      } catch (e) {
        for (var j = 0; j < t.length; j++) pieces.push({ ch: t[j], top: null });
      }
    } else if (node.nodeType === 1) {
      for (var k = 0; k < node.childNodes.length; k++) collectPieces(node.childNodes[k]);
    }
  }
  for (var m = 0; m < el.childNodes.length; m++) collectPieces(el.childNodes[m]);
  if (!pieces.length) return null;
  var result = '';
  var prevTop = null;
  for (var p = 0; p < pieces.length; p++) {
    var piece = pieces[p];
    if (piece.top !== null && prevTop !== null && piece.top > prevTop + 2) result += '\n';
    result += piece.ch;
    if (piece.top !== null) prevTop = piece.top;
  }
  return result.indexOf('\n') !== -1 ? result : null;
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

    // transform: rotate() → rotation + 位置修正
    // CSS transform 矩阵 matrix(a,b,c,d,tx,ty) 综合了 transform-origin 平移、rotate 及 translate
    // 直接用矩阵将「元素中心」变换到视觉中心，反推 Figma 的 x/y，使 Figma 按中心旋转时与 CSS 匹配
    if (ps.transform && ps.transform !== 'none') {
      var psRotation = parseTransformRotation(ps.transform);
      if (psRotation != null && psRotation !== 0) {
        shapeStyle.rotation = psRotation;
        var _matMatch = ps.transform.match(/matrix\(([^)]+)\)/);
        if (_matMatch) {
          var _mParts = _matMatch[1].split(',').map(function(s) { return parseFloat(s.trim()); });
          if (_mParts.length >= 6) {
            var _ma = _mParts[0], _mb = _mParts[1], _mc = _mParts[2], _md = _mParts[3];
            var _mtx = _mParts[4], _mty = _mParts[5];

            // Chrome getComputedStyle 返回的是不含 transform-origin 的纯变换矩阵。
            // 需手动将 transform-origin (ox, oy) 折叠进矩阵：
            //   tx_full = tx + ox*(1-a) - c*oy
            //   ty_full = ty + oy*(1-d) - b*ox
            var _toStr = (ps.transformOrigin || '').trim();
            var _toParts = _toStr.split(/\s+/);
            var _ox = parseFloat(_toParts[0]) || 0;
            var _oy = parseFloat(_toParts[1]) || 0;
            if (_ox !== 0 || _oy !== 0) {
              _mtx = _mtx + _ox * (1 - _ma) - _mc * _oy;
              _mty = _mty + _oy * (1 - _md) - _mb * _ox;
            }

            // 元素在宿主 CSS 坐标系（padding-edge 相对）中的预变换中心
            // safeX/safeY 已正确处理 psLeft/psRight/psTop/psBottom 所有情况，但包含 hostBorder 偏移
            // 转回 CSS padding-box 坐标系：减去 hostBorder
            var _preCx = (safeX - hostBorderLeft) + w / 2;
            var _preCy = (safeY - hostBorderTop) + h / 2;
            // 应用含 origin 修正的矩阵，得到 CSS 视觉中心（仍在 padding-box 坐标系内）
            var _postCx = _ma * _preCx + _mc * _preCy + _mtx;
            var _postCy = _mb * _preCx + _md * _preCy + _mty;
            // 转回 Figma 坐标系（border-edge 相对）：加上 hostBorder
            // 令 Figma 矩形中心 = CSS 视觉中心，推算 x/y（Figma rotation 绕矩形中心旋转）
            // 必须用 shapeStyle.width/height（即 Figma 实际尺寸，已 Math.round）做中心计算，
            // 否则 h=1.5 → safeH=2 导致 Figma 中心比预期偏 0.25px
            shapeStyle.x = _postCx + hostBorderLeft - shapeStyle.width / 2;
            shapeStyle.y = _postCy + hostBorderTop - shapeStyle.height / 2;
            console.log('[pseudo-transform]', pseudo,
              'ox=' + _ox, 'oy=' + _oy,
              'postCx=' + _postCx.toFixed(3), 'postCy=' + _postCy.toFixed(3),
              'figmaX=' + shapeStyle.x.toFixed(3), 'figmaY=' + shapeStyle.y.toFixed(3),
              'figmaW=' + shapeStyle.width, 'figmaH=' + shapeStyle.height,
              'rotation=' + psRotation,
              'figmaCenter=(' + (shapeStyle.x + shapeStyle.width / 2).toFixed(3) + ',' + (shapeStyle.y + shapeStyle.height / 2).toFixed(3) + ')'
            );
          }
        }
      }
    }

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


if (typeof module !== 'undefined') {
  module.exports = {
    shouldSetTextAlignVerticalCenterForAbsoluteTextLeaf: shouldSetTextAlignVerticalCenterForAbsoluteTextLeaf,
    inferNodeType: inferNodeType,
    shouldMergeTextAndBrChildren: shouldMergeTextAndBrChildren,
    mergeTextAndBrChildNodesContent: mergeTextAndBrChildNodesContent,
    getElementContentsTextBlockRect: getElementContentsTextBlockRect,
    getTextNodeRect: getTextNodeRect,
    shouldMarkWidthConstrainedForEdgeWhitespace: shouldMarkWidthConstrainedForEdgeWhitespace,
    applyWidthConstrainedForFigmaEdgeWhitespace: applyWidthConstrainedForFigmaEdgeWhitespace,
    applyTextOverflowEllipsisExport: applyTextOverflowEllipsisExport,
    normalizeTextExportPreserveTrailing: normalizeTextExportPreserveTrailing,
    getTextContent: getTextContent,
    getTextWithActualLineBreaksForElement: getTextWithActualLineBreaksForElement,
    isShowingPlaceholder: isShowingPlaceholder,
    getPseudoTextNode: getPseudoTextNode,
    getPseudoShapeNode: getPseudoShapeNode,
  };
}
