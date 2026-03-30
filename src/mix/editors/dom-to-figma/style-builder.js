/**
 * ============================================================
 * style-builder.js  —  CSS 样式 → Figma JSON 转换层
 * ============================================================
 * 职责：
 *   - 字体推断：parseFontFamilyStack / resolveFontFamilyFromStack / getGlobalFont
 *   - 行内文本样式：buildInlineTextStyle
 *   - 核心样式映射：buildStyleJSON（computed + cssRuleMap + 几何 → Figma style JSON）
 * 规则：依赖 css-parsers 和 dom-helpers，但不直接遍历 DOM 子树，不做节点类型判断。
 * ============================================================
 */
var _dp = (typeof module !== 'undefined') ? require('./css-parsers') : {};
var _dh = (typeof module !== 'undefined') ? require('./dom-helpers') : {};
var parseLinearGradientFromBgImage = _dp.parseLinearGradientFromBgImage || parseLinearGradientFromBgImage;
var parseRadialGradientFromBgImage = _dp.parseRadialGradientFromBgImage || parseRadialGradientFromBgImage;
var parseUrlFromBgImage = _dp.parseUrlFromBgImage || parseUrlFromBgImage;
var parseBoxShadow = _dp.parseBoxShadow || parseBoxShadow;
var parseBorderShorthand = _dp.parseBorderShorthand || parseBorderShorthand;
var parseGridTemplateColumnsCount = _dp.parseGridTemplateColumnsCount || parseGridTemplateColumnsCount;
var parseTransformRotation = _dp.parseTransformRotation || parseTransformRotation;
var cssColorToRgba = _dp.cssColorToRgba || cssColorToRgba;
var cssColorToHex = _dp.cssColorToHex || cssColorToHex;
var getDeclaredStyleForElement = _dh.getDeclaredStyleForElement || getDeclaredStyleForElement;

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
  } else if (bgImageFromBackground && (bgImageFromBackground.indexOf('linear-gradient') >= 0 || bgImageFromBackground.indexOf('radial-gradient') >= 0)) {
    bgImage = bgImageFromBackground;
  }
  var gradientFill = bgImage ? (parseLinearGradientFromBgImage(bgImage) || parseRadialGradientFromBgImage(bgImage)) : null;
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
    // HORIZONTAL flex 时：
    //   1. 优先找「高度明显小于行高（< containerH * 0.95）」的流内子项，用它的中心偏移判断 center / flex-start；
    //   2. 若流内子项全都≈满行高，说明是 align-items: stretch（默认拉满），直接视为 stretch（→ MIN），
    //      避免把「stretch 下盒子中心恰在行中」误判成 center；
    //   3. 若只有 height=0 的子项（SVG），用偏移法兜底。
    var _elClassForDebug = (el.className && typeof el.className === 'string') ? el.className : '';
    if ((!alignItems || alignItems === 'normal') && style.layoutMode === 'HORIZONTAL' && el.children && el.children.length > 0) {
      var _containerRect = el.getBoundingClientRect();
      var _containerH = _containerRect.height;
      var _containerTop = _containerRect.top;
      var _sampleChild = null;      // 找到的「矮」子项（未撑满行高），用于中心法
      var _fullHeightChild = null;  // 流内满高子项备用
      var _svgFallback = null;      // height=0 子项（SVG 等）备用
      for (var _ci = 0; _ci < el.children.length; _ci++) {
        var _ch = el.children[_ci];
        // 跳过脱离 flex 流的绝对定位子节点（其高度与行高无关）
        try {
          var _chPos = (window.getComputedStyle(_ch).position || '').toLowerCase();
          if (_chPos === 'absolute' || _chPos === 'fixed') continue;
        } catch (_ce) {}
        var _chH = _ch.getBoundingClientRect().height;
        if (_chH > 0 && _containerH > 0 && _chH < _containerH * 0.95) {
          _sampleChild = _ch; // 矮子项优先，找到即停
          break;
        }
        if (!_fullHeightChild && _chH > 0) _fullHeightChild = _ch;
        if (!_svgFallback && _chH === 0) _svgFallback = _ch;
      }
      if (_sampleChild && _containerH > 0) {
        // 用矮子项的位置判断 center / flex-start
        var _childRect = _sampleChild.getBoundingClientRect();
        if (_childRect.height > 0) {
          var _childCenterY = _childRect.top - _containerTop + _childRect.height / 2;
          var _containerCenterY = _containerH / 2;
          alignItems = Math.abs(_childCenterY - _containerCenterY) < 3 ? 'center' : 'flex-start';
        } else {
          var _childOffsetY = _childRect.top - _containerTop;
          alignItems = (_childOffsetY > _containerH * 0.2 && _childOffsetY < _containerH * 0.8) ? 'center' : 'flex-start';
        }
      } else if (_fullHeightChild) {
        // 流内子项都≈满高 → align-items: stretch（默认值），stretch 映射为 MIN（交叉轴顶对齐）
        alignItems = 'stretch';
      } else if (_svgFallback && _containerH > 0) {
        // 只有 height=0 的 SVG 子项，用偏移法兜底
        var _childOffsetY = _svgFallback.getBoundingClientRect().top - _containerTop;
        alignItems = (_childOffsetY > _containerH * 0.2 && _childOffsetY < _containerH * 0.8) ? 'center' : 'flex-start';
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
    // CSS：space-between 在仅 1 个参与排布的 flex 子项时贴在主轴起点；Figma SPACE_BETWEEN+单子项会居中，降级为 MIN/MAX
    if (justifyContentNorm === 'space-between' && style.primaryAxisAlignItems === 'SPACE_BETWEEN' && el.children) {
      var _inFlowFlexChildren = 0;
      for (var _fi = 0; _fi < el.children.length; _fi++) {
        try {
          var _fpos = (window.getComputedStyle(el.children[_fi]).position || '').toLowerCase();
          if (_fpos !== 'absolute' && _fpos !== 'fixed') _inFlowFlexChildren++;
        } catch (_fe) {}
      }
      if (_inFlowFlexChildren <= 1) {
        var _dirStr = (dir && String(dir).trim().toLowerCase()) || 'row';
        var _rowRev = _dirStr === 'row-reverse';
        var _colRev = _dirStr === 'column-reverse';
        var _rtl = computed && String(computed.direction || 'ltr').toLowerCase() === 'rtl';
        if (style.layoutMode === 'VERTICAL') {
          style.primaryAxisAlignItems = _colRev ? 'MAX' : 'MIN';
        } else {
          if (_rowRev) {
            style.primaryAxisAlignItems = _rtl ? 'MIN' : 'MAX';
          } else {
            style.primaryAxisAlignItems = _rtl ? 'MAX' : 'MIN';
          }
        }
      }
    }
    style.counterAxisAlignItems = alignMap[alignItemsNorm] || 'MIN';
    // ant-radio-wrapper：CSS align-items 可能因自定义主题（如 verticalRadio 竖排变体）被覆盖为 flex-start，
    // 导致 radio 圆圈贴顶。改用几何法：取最矮的流内子项（即 radio 圆圈），
    // 若其中心与容器中心对齐（误差 < 5px），则强制 CENTER，不依赖 CSS 声明值。
    var _isAntRadioWrapper = (el.className && typeof el.className === 'string' && el.className.indexOf('ant-radio-wrapper') !== -1);
    if (_isAntRadioWrapper) {
      var _rawWRect = el.getBoundingClientRect();
      var _rawWH = _rawWRect.height;
      var _rawShortCh = null;
      for (var _rwci = 0; _rwci < el.children.length; _rwci++) {
        try { if ((window.getComputedStyle(el.children[_rwci]).position || '').toLowerCase() === 'absolute') continue; } catch (_rwe) {}
        var _rwcH = el.children[_rwci].getBoundingClientRect().height;
        if (_rwcH > 0 && _rawWH > 0 && _rwcH < _rawWH * 0.95) { _rawShortCh = el.children[_rwci]; break; }
      }
      if (_rawShortCh && _rawWH > 0) {
        var _rawCR = _rawShortCh.getBoundingClientRect();
        var _rawCCY = _rawCR.top - _rawWRect.top + _rawCR.height / 2;
        if (Math.abs(_rawCCY - _rawWH / 2) < 5) style.counterAxisAlignItems = 'CENTER';
      } else if (alignItemsNorm === 'baseline' || alignItemsNorm === 'center') {
        style.counterAxisAlignItems = 'CENTER';
      }
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
      // 若单行 inline 子元素在浏览器中实际跨越多个行（getClientRects().length > 1），
      // 说明 block 内含文本 + inline 子元素的内容因容器宽度不足而换行。
      // 此时加上 layoutWrap='WRAP'，让 Figma Auto Layout 也能按宽度自动换行，
      // 避免两段文本在 Figma 中横排在同一行。
      if (hasSingleInlineTextChild) {
        try {
          var _inlineChild = el.children[0];
          var _inlineCrs = _inlineChild.getClientRects();
          if (_inlineCrs && _inlineCrs.length > 1) {
            style.layoutWrap = 'WRAP';
          }
        } catch (_eWrap) {}
      }
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
    }
    // CSS grid 横向布局：无论固定列数还是 auto-fill/auto-fit，均设为换行
    // （auto-fill/auto-fit 时 colCount 为 null，但 grid 本身就是换行的）
    if (style.layoutMode === 'HORIZONTAL' && gridTemplateCols && String(gridTemplateCols).trim() !== 'none') {
      style.layoutWrap = 'WRAP';
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
  // 检测 margin:auto 水平居中（声明值均为 'auto'），供父容器处理时转换为 alignSelf:'CENTER'
  if (typeof _mLRaw === 'string' && _mLRaw.trim() === 'auto' &&
      typeof _mRRaw === 'string' && _mRRaw.trim() === 'auto') {
    style._marginAutoH = true;
  }

  if (el.className && typeof el.className === 'string' && el.className.indexOf('filterActions') !== -1) {
    try {
      console.log('[mb-d2f:filterActions:buildStyle]', {
        className: el.className,
        marginLeftPx: mL,
        marginRightPx: mR,
        rawDeclaredML: _mLRaw,
        computedMarginLeft: computed.marginLeft,
        computedMarginRight: computed.marginRight,
      });
    } catch (_eFa3) {}
  }

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


if (typeof module !== 'undefined') {
  module.exports = {
    parseFontFamilyStack: parseFontFamilyStack,
    resolveFontFamilyFromStack: resolveFontFamilyFromStack,
    getGlobalFont: getGlobalFont,
    buildInlineTextStyle: buildInlineTextStyle,
    buildStyleJSON: buildStyleJSON,
  };
}
