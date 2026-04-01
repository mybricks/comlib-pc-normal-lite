/**
 * ============================================================
 * index.js  —  公共 API 入口层
 * ============================================================
 * 职责：
 *   - 引入所有子模块，将函数注入全局作用域（浏览器注入模式）
 *   - domToMybricksJson：主流程入口，内含 walk 遍历函数
 *   - elementToMybricksJson / comToMybricksJson：薄包装入口
 *   - window.* / module.exports 对外注册
 * 注意：walk 作为 domToMybricksJson 的内部闭包保留，因其依赖外层的
 *   geo / cssRuleMap / globalFont 等变量，提取为独立函数收益有限。
 * ============================================================
 */

/* ── 加载子模块（Node.js / webpack 环境）──────────────────── */
(function () {
  if (typeof module === 'undefined') return; // 浏览器注入时各子模块已内联，无需 require
  var _dh  = require('./dom-helpers');
  var _cp  = require('./css-parsers');
  var _sb  = require('./style-builder');
  var _lu  = require('./layout-utils');
  var _nb  = require('./node-builder');
  var _ii  = require('./image-inline');

  // dom-helpers
  SHADOW_HOST_ID = _dh.SHADOW_HOST_ID;
  GEOVIEW_WRAPPER_ID = _dh.GEOVIEW_WRAPPER_ID;
  getShadowHost = _dh.getShadowHost;
  resolveFrameRoot = _dh.resolveFrameRoot;
  getCssRulesBySelector = _dh.getCssRulesBySelector;
  getGeoviewScaleAndOrigin = _dh.getGeoviewScaleAndOrigin;
  getDesignRect = _dh.getDesignRect;
  hasClassPrefix = _dh.hasClassPrefix;
  simpleSelectorMatches = _dh.simpleSelectorMatches;
  getMatchedSelectorsForElement = _dh.getMatchedSelectorsForElement;
  getDeclaredStyleForElement = _dh.getDeclaredStyleForElement;
  getFrameTitleFromElement = _dh.getFrameTitleFromElement;
  findArtboardIdFromElement = _dh.findArtboardIdFromElement;
  emptyRoot = _dh.emptyRoot;
  // css-parsers
  normalizeSvgPathForFigma = _cp.normalizeSvgPathForFigma;
  parseUrlFromBgImage = _cp.parseUrlFromBgImage;
  parseLinearGradientFromBgImage = _cp.parseLinearGradientFromBgImage;
  parseRadialGradientFromBgImage = _cp.parseRadialGradientFromBgImage;
  parseBoxShadow = _cp.parseBoxShadow;
  parseBorderShorthand = _cp.parseBorderShorthand;
  parseGridTemplateColumnsCount = _cp.parseGridTemplateColumnsCount;
  serializeSvgElement = _cp.serializeSvgElement;
  parseTransformRotation = _cp.parseTransformRotation;
  cssColorToHex = _cp.cssColorToHex;
  cssColorToRgba = _cp.cssColorToRgba;
  // style-builder
  parseFontFamilyStack = _sb.parseFontFamilyStack;
  resolveFontFamilyFromStack = _sb.resolveFontFamilyFromStack;
  getGlobalFont = _sb.getGlobalFont;
  buildInlineTextStyle = _sb.buildInlineTextStyle;
  buildStyleJSON = _sb.buildStyleJSON;
  // layout-utils
  getM = _lu.getM;
  pruneChildMarginsAfterGapMerge = _lu.pruneChildMarginsAfterGapMerge;
  anyChildHasMargin = _lu.anyChildHasMargin;
  childrenHaveUniformMargin = _lu.childrenHaveUniformMargin;
  applyUniformMarginAsGap = _lu.applyUniformMarginAsGap;
  ensureItemSpacingFromPositions = _lu.ensureItemSpacingFromPositions;
  // node-builder
  shouldSetTextAlignVerticalCenterForAbsoluteTextLeaf = _nb.shouldSetTextAlignVerticalCenterForAbsoluteTextLeaf;
  inferNodeType = _nb.inferNodeType;
  shouldMergeTextAndBrChildren = _nb.shouldMergeTextAndBrChildren;
  mergeTextAndBrChildNodesContent = _nb.mergeTextAndBrChildNodesContent;
  getElementContentsTextBlockRect = _nb.getElementContentsTextBlockRect;
  getTextNodeRect = _nb.getTextNodeRect;
  shouldMarkWidthConstrainedForEdgeWhitespace = _nb.shouldMarkWidthConstrainedForEdgeWhitespace;
  applyWidthConstrainedForFigmaEdgeWhitespace = _nb.applyWidthConstrainedForFigmaEdgeWhitespace;
  applyTextOverflowEllipsisExport = _nb.applyTextOverflowEllipsisExport;
  normalizeTextExportPreserveTrailing = _nb.normalizeTextExportPreserveTrailing;
  getTextContent = _nb.getTextContent;
  getTextWithActualLineBreaksForElement = _nb.getTextWithActualLineBreaksForElement;
  isShowingPlaceholder = _nb.isShowingPlaceholder;
  getPseudoTextNode = _nb.getPseudoTextNode;
  getPseudoShapeNode = _nb.getPseudoShapeNode;
  // image-inline
  fetchImageAsBase64DataUrl = _ii.fetchImageAsBase64DataUrl;
  inlineImageFillsInTree = _ii.inlineImageFillsInTree;
})();

/* Stub declarations for Node/webpack module resolution */
var SHADOW_HOST_ID, GEOVIEW_WRAPPER_ID, getShadowHost, resolveFrameRoot, getCssRulesBySelector, getGeoviewScaleAndOrigin, getDesignRect, hasClassPrefix, simpleSelectorMatches, getMatchedSelectorsForElement, getDeclaredStyleForElement, getFrameTitleFromElement, findArtboardIdFromElement, emptyRoot, normalizeSvgPathForFigma, parseUrlFromBgImage, parseLinearGradientFromBgImage, parseRadialGradientFromBgImage, parseBoxShadow, parseBorderShorthand, parseGridTemplateColumnsCount, serializeSvgElement, parseTransformRotation, cssColorToHex, cssColorToRgba, parseFontFamilyStack, resolveFontFamilyFromStack, getGlobalFont, buildInlineTextStyle, buildStyleJSON, getM, pruneChildMarginsAfterGapMerge, anyChildHasMargin, childrenHaveUniformMargin, applyUniformMarginAsGap, ensureItemSpacingFromPositions, shouldSetTextAlignVerticalCenterForAbsoluteTextLeaf, inferNodeType, shouldMergeTextAndBrChildren, mergeTextAndBrChildNodesContent, getElementContentsTextBlockRect, getTextNodeRect, shouldMarkWidthConstrainedForEdgeWhitespace, applyWidthConstrainedForFigmaEdgeWhitespace, applyTextOverflowEllipsisExport, normalizeTextExportPreserveTrailing, getTextContent, getTextWithActualLineBreaksForElement, isShowingPlaceholder, getPseudoTextNode, getPseudoShapeNode, fetchImageAsBase64DataUrl, inlineImageFillsInTree;

/**
 * 从指定 DOM 元素直接导出，不需要通过 comId 查找 Shadow DOM。
 * 样式表通过 styleTagId（组件 ID）在 Shadow DOM 内查找 <style id="styleTagId">。
 * @param {Element} el - 要导出的 DOM 元素（如 focusArea.ele）
 * @param {string} [styleTagId] - 可选，<style> 的 id，用于获取组件样式表（通常为组件 id）
 * @returns {{ page: { name?: string, "component-def"?: any[], content: any[] } }}
 */
function elementToMybricksJson(el, styleTagId) {
  if (!el) return emptyRoot();
  return domToMybricksJson(null, styleTagId, el);
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

function domToMybricksJson(frameId, styleTagId, _rootElOverride) {
  const host = getShadowHost();
  const shadowRoot = host && host.shadowRoot ? host.shadowRoot : null;
  // 没有 shadowRoot 时：有 _rootElOverride 才能继续（elementToMybricksJson 场景），否则返回空
  if (!shadowRoot && !_rootElOverride) {
    return emptyRoot();
  }

  const root = _rootElOverride || resolveFrameRoot(frameId);
  if (!root) {
    return emptyRoot();
  }

  const cssRuleMap = styleTagId ? getCssRulesBySelector(styleTagId, shadowRoot || document) : null;
  const dom = root;

  var geo = getGeoviewScaleAndOrigin(shadowRoot || document);

  // 全局字体：从画布根取，仅当节点与全局不同时才在 style 里输出 fontFamily/fontWeight/fontStyle
  var rootComputed = window.getComputedStyle(root);
  var globalFont = getGlobalFont(root, rootComputed, cssRuleMap);

  function walk(el, parentRect) {
    var rect = getDesignRect(el, geo);
    const computed = window.getComputedStyle(el);
    const tag = (el.tagName || '').toLowerCase();

    // inline 元素（如 span）在 flex-wrap 或行内布局中可能跨越多个浏览器行，
    // getBoundingClientRect() 返回联合包围盒，导致 y 位置错误（偏到第一行顶部）。
    // 改用 getClientRects() 中面积最大的单行矩形，取其准确的行内位置和尺寸。
    var _elDisplayForMultiline = computed.display;
    if (_elDisplayForMultiline === 'inline' || _elDisplayForMultiline === 'inline-block' || _elDisplayForMultiline === 'inline-flex') {
      try {
        var _crs = el.getClientRects();
        if (_crs && _crs.length > 1) {
          var _maxArea = 0;
          var _primaryVR = null;
          for (var _ri = 0; _ri < _crs.length; _ri++) {
            var _vr = _crs[_ri];
            var _vArea = (_vr.width || 0) * (_vr.height || 0);
            if (_vArea > _maxArea) { _maxArea = _vArea; _primaryVR = _vr; }
          }
          if (_primaryVR) rect = getDesignRect(_primaryVR, geo);
        }
      } catch (_eInline) {}
    }

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
          // 将 lineHeight 写入 JSON，让 Figma 使用与 DOM 一致的行高，
          // 避免 Figma 按自身字体度量重新计算（如 fontSize=48 的 -apple-system 默认行高≈67px）
          if (_lh != null && !Number.isNaN(_lh) && _lh > 0) {
            node.style.lineHeight = _lh;
          } else if (node.style.singleLine) {
            // line-height: normal 的单行文本：DOM 元素高度 = 有效行高（减去 padding）
            var _ptop2 = parseFloat(computed && computed.paddingTop) || 0;
            var _pbot2 = parseFloat(computed && computed.paddingBottom) || 0;
            var _effLh2 = _h - _ptop2 - _pbot2;
            if (_effLh2 > 0) {
              node.style.lineHeight = _effLh2;
            }
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
              if (_cn.nodeType === 3 && /\S/.test(_cn.textContent || '')) {
                var _tr = getTextNodeRect(_cn);
                if (_tr && _tr.width > 0) _contentW += _tr.width / _geoScale;
              }
            }
            if (_contentW > 0 && _contentW < node.style.width * 0.9) {
              node.style.widthConstrained = true;
            }
          }
        }
        applyWidthConstrainedForFigmaEdgeWhitespace(node);
      }
      // 多行 + 中文数字混合：递归遍历所有子节点检测 DOM 实际断行位置，插入 \n，避免 Figma 在 CJK 标点处错误断行
      if (nodeType === 'text' && node.style && !node.style.singleLine) {
        var _rawT = node.content || '';
        if (/[\u4e00-\u9fff\uff00-\uffef]/.test(_rawT) && /\d/.test(_rawT)) {
          var _cwb = getTextWithActualLineBreaksForElement(el);
          if (_cwb) node.content = _cwb;
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

    var childNodes = [];
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
          applyTextOverflowEllipsisExport(_mergeTextJson, el, window.getComputedStyle(el), geo, null, rect);
          applyWidthConstrainedForFigmaEdgeWhitespace(_mergeTextJson);
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
          var textContent = normalizeTextExportPreserveTrailing(child.textContent || '', false);
          if (textContent) {
            var textRectViewport = getTextNodeRect(child);
            var textRect = textRectViewport ? getDesignRect(textRectViewport, geo) : null;
            var inlineStyle = buildInlineTextStyle(el, window.getComputedStyle(el), textRect, rect, cssRuleMap, globalFont);
            var textNodeJson = {
              type: 'text',
              name: 'Text',
              content: textContent,
              style: inlineStyle && Object.keys(inlineStyle).length ? inlineStyle : undefined,
            };
            if (node.selectors && node.selectors.length) textNodeJson.selectors = node.selectors.slice();
            if (node.className) textNodeJson.className = node.className;
            applyTextOverflowEllipsisExport(textNodeJson, el, window.getComputedStyle(el), geo, child, rect);
            applyWidthConstrainedForFigmaEdgeWhitespace(textNodeJson);
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
      // ant-checkbox-inner / ant-radio-inner：使用 Auto Layout 双轴居中显示选中标记（pseudo-after）。
      // pseudo-after 不带绝对定位，让 Auto Layout 自动居中；其余 input 等子节点已是绝对定位，不受影响。
      if (pseudoAfter && el.className && typeof el.className === 'string' && /ant-checkbox-inner|ant-radio-inner/.test(el.className)) {
        if (node.style) {
          node.style.layoutMode = node.style.layoutMode || 'HORIZONTAL';
          node.style.primaryAxisAlignItems = 'CENTER';
          node.style.counterAxisAlignItems = 'CENTER';
          node.style.itemSpacing = 0;
          node.style.layoutSizingHorizontal = 'FIXED';
          node.style.layoutSizingVertical = 'FIXED';
          // 勾形（rotation 非零）视觉重心偏上，加 2px 底部 padding 补偿
          var _isCheckmark = pseudoAfter.style && pseudoAfter.style.rotation != null && pseudoAfter.style.rotation !== 0;
          if (_isCheckmark) {
            node.style.paddingBottom = 2;
          }
        }
      }
      if (childNodes.length) {
        var layoutMode = node.style && (node.style.layoutMode === 'VERTICAL' || node.style.layoutMode === 'HORIZONTAL') ? node.style.layoutMode : null;
        if (layoutMode) {
          // VERTICAL 父容器：若子节点水平居中（x ≈ (parentWidth-childWidth)/2），设 alignSelf:'CENTER'
          if (layoutMode === 'VERTICAL') {
            var _pW2 = node.style && node.style.width;
            for (var _maci2 = 0; _maci2 < childNodes.length; _maci2++) {
              var _mcs2 = childNodes[_maci2];
              if (!_mcs2 || !_mcs2.style) continue;
              if (_mcs2.style.positionType === 'absolute') continue;
              var _cW2 = _mcs2.style.width;
              var _cX2 = _mcs2.style.x;
              if (_pW2 != null && _cW2 != null && _cX2 != null && _pW2 > _cW2 + 4) {
                var _expectedCX2 = (_pW2 - _cW2) / 2;
                if (Math.abs(_cX2 - _expectedCX2) < 2) {
                  _mcs2.style.alignSelf = 'CENTER';
                  // Figma layoutAlign='CENTER' 在 FIXED sizing 下静默失效；
                  // 改为将父容器设为 counterAxisAlignItems='CENTER'。
                  // 安全检查：只有所有其他非绝对定位兄弟节点都是全宽（容差10px）时才设置，
                  // 避免非全宽兄弟节点被错误居中。
                  var _allSibsFullWidth2 = true;
                  for (var _si2 = 0; _si2 < childNodes.length; _si2++) {
                    if (_si2 === _maci2) continue;
                    var _sib2 = childNodes[_si2];
                    if (!_sib2 || !_sib2.style || _sib2.style.positionType === 'absolute') continue;
                    var _sibW2 = _sib2.style.width;
                    if (_sibW2 != null && _pW2 - _sibW2 > 10) {
                      _allSibsFullWidth2 = false;
                      break;
                    }
                  }
                  if (_allSibsFullWidth2) {
                    node.style.counterAxisAlignItems = 'CENTER';
                  }
                }
              }
            }
          }
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
            console.log("是否为统一margin间距",childrenHaveUniformMargin(childNodes, layoutMode),childNodes,layoutMode)
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
              // 多个流中子节点（>1）且算不出均匀间距 → 说明子节点间距本就不均匀，
              // 不能用 Auto Layout，即使有对齐/内边距也要降级为绝对定位，保留真实坐标
              var multiFlowChildren = childNodes.filter(function(c) { return !(c.style && c.style.positionType === 'absolute'); }).length > 1;
              if (_isMenuNode2) {
              }
              if (_isRadioWrapperNode2) {
              }
              if ((hasAlignment || hasPadding || hasAbsoluteChild) && !multiFlowChildren) {
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
                pruneChildMarginsAfterGapMerge(
                  node.style,
                  childNodes[i].style,
                  layoutMode,
                  (node.name || '') + '/' + (node.className || ''),
                  (childNodes[i].name || '') + '/' + (childNodes[i].className || '')
                );
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
        if (node.className === 'filterArea' && node.style) {
          try {
            console.log('[mb-d2f:filterArea:summary]', {
              layoutMode: node.style.layoutMode,
              layoutWrap: node.style.layoutWrap,
              itemSpacing: node.style.itemSpacing,
              counterAxisSpacing: node.style.counterAxisSpacing,
              children: childNodes.map(function (c) {
                var s = c && c.style;
                return {
                  name: c && c.name,
                  className: c && c.className,
                  x: s && s.x,
                  y: s && s.y,
                  marginLeft: s && s.marginLeft,
                  marginRight: s && s.marginRight,
                };
              }),
            });
          } catch (_eFa2) {}
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
