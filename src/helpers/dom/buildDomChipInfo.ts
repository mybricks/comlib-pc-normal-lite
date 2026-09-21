import { safeParseJson } from '../normal'
import type { DomLoc } from './'

interface RepeatSignature {
  key: string;
  reason: string;
}

interface RepeatAncestorContext {
  node: Element;
  index?: number;
  total: number;
  signature?: RepeatSignature;
  skipped?: boolean;
}

export const DOM_CHIP_TYPE = "dom";

/** 单段文本在 DOM 摘要中的最大字符数 */
const DOM_SUMMARY_SINGLE_TEXT_MAX = 20;
/** 选区 DOM 摘要总最大字符数，超出时裁剪中间部分 */
const DOM_SUMMARY_TOTAL_MAX = 300;
const DOM_SUMMARY_MAX_CHILDREN = 8;
const REPEAT_CONTEXT_MAX_DEPTH = 10;
const REPEAT_CONTEXT_MAX_SIBLINGS = 200;
const DOM_SUMMARY_CLASS_MAX = 3;

const DOM_SUMMARY_SKIP_CHILDREN_TAGS = new Set(["svg"]);
const DOM_SUMMARY_SKIP_TAGS = new Set([
  "defs",
  "desc",
  "filter",
  "foreignobject",
  "g",
  "lineargradient",
  "marker",
  "mask",
  "metadata",
  "pattern",
  "radialgradient",
  "script",
  "style",
  "symbol",
  "template",
  "title",
  "use",
]);
const DOM_SUMMARY_SKIP_SVG_DRAWING_TAGS = new Set([
  "circle",
  "ellipse",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
  "stop",
]);
const DOM_SUMMARY_NON_PAGE_CODE_ATTRS = ["data-mybricks-tip"];

function normalizeZoneSelectorValue(value: string | null): string {
  if (!value) return "";
  const parsed = safeParseJson<string[]>(value);
  if (Array.isArray(parsed)) return parsed.filter(Boolean).join(" ");
  return value.trim();
}

function getOwnDomLoc<T extends DomLoc>(el: Element): T | undefined {
  return safeParseJson<T>(el.getAttribute("data-loc"));
}

function formatCodeLoc(loc: DomLoc): string | null {
  const jsxFile = loc.files?.jsx;
  const startLine = loc.codeLine?.start;
  const endLine = loc.codeLine?.end;
  if (!jsxFile || !startLine) return null;
  if (endLine && endLine !== startLine) return `${jsxFile}:L${startLine}-L${endLine}`;
  return `${jsxFile}:L${startLine}`;
}

function getRepeatSignature(el: Element, cache: WeakMap<Element, RepeatSignature | null>): RepeatSignature | null {
  if (cache.has(el)) return cache.get(el) ?? null;

  const loc = getOwnDomLoc<DomLoc>(el);
  const locText = loc ? formatCodeLoc(loc) : null;
  if (locText) {
    const signature = {
      key: `loc:${locText}`,
      reason: `兄弟节点拥有相同 JSX 位置 ${locText}`,
    };
    cache.set(el, signature);
    return signature;
  }

  const comName = el.getAttribute("data-com-name")?.trim() ?? "";
  const zoneSelector = normalizeZoneSelectorValue(el.getAttribute("data-zone-selector"));

  if (comName && zoneSelector) {
    const signature = {
      key: `com+selector:${comName}:${zoneSelector}`,
      reason: `兄弟节点拥有相同组件名「${comName}」和选择器「${zoneSelector}」`,
    };
    cache.set(el, signature);
    return signature;
  }

  if (zoneSelector) {
    const signature = {
      key: `selector:${zoneSelector}`,
      reason: `兄弟节点拥有相同选择器「${zoneSelector}」`,
    };
    cache.set(el, signature);
    return signature;
  }

  if (comName) {
    const signature = {
      key: `com:${comName}`,
      reason: `兄弟节点拥有相同组件名「${comName}」`,
    };
    cache.set(el, signature);
    return signature;
  }

  cache.set(el, null);
  return null;
}

function findNearestSignatureAnchor(
  el: Element,
  cache: WeakMap<Element, RepeatSignature | null>
): { el: Element; signature: RepeatSignature } | null {
  let node: Element | null = el;
  while (node) {
    if (node.getAttribute("data-zone-type") === "page") break;
    const signature = getRepeatSignature(node, cache);
    if (signature) return { el: node, signature };
    node = node.parentElement;
  }
  return null;
}

function getElementPath(root: Element, target: Element): number[] | null {
  const path: number[] = [];
  let node: Element | null = target;

  while (node && node !== root) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.children, node);
    if (index < 0) return null;
    path.unshift(index);
    node = parent;
  }

  return node === root ? path : null;
}

function isDomElement(value: unknown): value is Element {
  if (!value || typeof value !== "object") return false;

  const ownerDocument = (value as { ownerDocument?: Document }).ownerDocument;
  const ElementConstructor = ownerDocument?.defaultView?.Element;
  return typeof ElementConstructor === "function" && value instanceof ElementConstructor;
}

function getElementByPath(root: Element, path: number[]): Element | null {
  let node: Element | null = root;
  for (const index of path) {
    const child: Element | undefined = node.children[index];
    if (!isDomElement(child)) return null;
    node = child;
  }
  return node;
}

function detectRepeatCandidate(
  candidate: Element,
  anchorEl: Element,
  anchorSignature: RepeatSignature,
  cache: WeakMap<Element, RepeatSignature | null>
): RepeatAncestorContext | null {
  const parent = candidate.parentElement;
  if (!parent) return null;

  const anchorPath = getElementPath(candidate, anchorEl);
  if (!anchorPath) return null;

  const children = Array.from(parent.children);

  if (children.length > REPEAT_CONTEXT_MAX_SIBLINGS) {
    return {
      node: candidate,
      total: children.length,
      signature: anchorSignature,
      skipped: true,
    };
  }

  const sameTemplateSiblings = children.filter((child) => {
    const siblingAnchor = child === candidate ? anchorEl : getElementByPath(child, anchorPath);
    return !!siblingAnchor && getRepeatSignature(siblingAnchor, cache)?.key === anchorSignature.key;
  });

  if (sameTemplateSiblings.length <= 1) return null;

  const index = sameTemplateSiblings.indexOf(candidate);
  if (index === -1) return null;

  return {
    node: candidate,
    index: index + 1,
    total: sameTemplateSiblings.length,
    signature: anchorSignature,
  };
}

function collectRepeatAncestorContexts(el: Element): RepeatAncestorContext[] {
  const contexts: RepeatAncestorContext[] = [];
  const signatureCache = new WeakMap<Element, RepeatSignature | null>();
  const anchor = findNearestSignatureAnchor(el, signatureCache);
  if (!anchor) return [];

  let node: Element | null = anchor.el;
  let depth = 0;

  while (node && depth < REPEAT_CONTEXT_MAX_DEPTH) {
    if (node.getAttribute("data-zone-type") === "page") break;

    const context = detectRepeatCandidate(node, anchor.el, anchor.signature, signatureCache);
    if (context) contexts.push(context);

    node = node.parentElement;
    depth += 1;
  }

  return contexts.reverse();
}

function formatRepeatContexts(contexts: RepeatAncestorContext[], indent = " - "): string[] {
  if (!contexts.length) return [];

  const lines: string[] = [];

  contexts.forEach((context, index) => {
    const loopLabel = contexts.length === 1 ? "循环 JSX" : `第 ${index + 1} 层循环 JSX`;
    const signature = context.signature;
    const reason = signature ? `，依据：${signature.reason}` : "";

    if (context.skipped) {
      lines.push(`${indent}节点疑似位于${loopLabel}中，父级兄弟节点共 ${context.total} 个，超过扫描上限 ${REPEAT_CONTEXT_MAX_SIBLINGS}，已跳过逐项重复推断${reason}。`);
      return;
    }

    if (context.index) {
      lines.push(`${indent}节点疑似位于${loopLabel}中，当前是 JSX 中的第 ${context.index} 项 / 共 ${context.total} 项${reason}。`);
    } else {
      lines.push(`${indent}节点疑似位于${loopLabel}中${reason}。`);
    }
  });

  lines.push(`${indent}注意：需要结合用户需求判断是仅修改当前项，还是修改循环 JSX 中的全部同类项；必要时向用户咨询确认。`);
  return lines;
}

function getClosestDomLoc<T extends DomLoc>(el: Element): T | undefined {
  let current: Element | null = el;
  while (current) {
    const loc = safeParseJson<T>(current.getAttribute("data-loc"));
    if (loc) return loc;
    current = current.parentElement;
  }
  return undefined;
}

function getDomCodeLocation(el: Element): string {
  const loc = getClosestDomLoc<DomLoc>(el);
  const jsxFile = loc?.files?.jsx;
  const lessFile = loc?.files?.less;
  const startLine = loc?.codeLine?.start;
  const endLine = loc?.codeLine?.end;

  if (!jsxFile && !lessFile && !startLine && !endLine) return "未知";

  const codeLine =
    startLine && endLine
      ? startLine === endLine
        ? `L${startLine}`
        : `L${startLine} - L${endLine}`
      : startLine
      ? `L${startLine}`
      : endLine
      ? `L${endLine}`
      : "未知行";
  const jsxText = jsxFile ? `位于${jsxFile}的${codeLine}` : `位于未知文件的${codeLine}`;
  const lessText = lessFile ? `，相关的less文件为${lessFile}` : "";

  return `${jsxText}${lessText}`;
}

function indentText(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function shouldSkipDomSummaryNode(node: Element): boolean {
  const tag = node.tagName.toLowerCase();
  return (
    DOM_SUMMARY_NON_PAGE_CODE_ATTRS.some((attr) => node.hasAttribute(attr)) ||
    DOM_SUMMARY_SKIP_TAGS.has(tag) ||
    (node.namespaceURI === "http://www.w3.org/2000/svg" && DOM_SUMMARY_SKIP_SVG_DRAWING_TAGS.has(tag))
  );
}

function splitClassNames(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getDomSummaryClassNames(node: Element): string {
  const selectorClassNames = safeParseJson<string[]>(node.getAttribute("data-zone-selector"));
  if (Array.isArray(selectorClassNames) && selectorClassNames.length) {
    return selectorClassNames.filter(Boolean).slice(0, DOM_SUMMARY_CLASS_MAX).join(" ");
  }

  const zoneClassNames = node.getAttribute("data-zone-classnames");
  if (zoneClassNames?.trim()) {
    return splitClassNames(zoneClassNames).slice(0, DOM_SUMMARY_CLASS_MAX).join(" ");
  }

  const loc = getOwnDomLoc<DomLoc & { cn?: string[] }>(node);
  if (loc?.cn?.length) {
    return loc.cn.filter(Boolean).slice(0, DOM_SUMMARY_CLASS_MAX).join(" ");
  }

  return "";
}

function shouldSkipDomSummaryChildren(node: Element): boolean {
  return DOM_SUMMARY_SKIP_CHILDREN_TAGS.has(node.tagName.toLowerCase());
}

/**
 * 从 DOM 元素提取结构化摘要，用于描述用户选区，控制 token 消耗。
 * - 按层级输出 tag、class、role 及文本摘要，不输出完整 HTML。
 * - 单段文本会截断到一定长度；若总长度超出上限，会裁剪中间部分并插入省略提示。
 */
function extractDomSummary(
  el: Element,
  options?: { singleTextMax?: number; totalMax?: number }
): string {
  if (shouldSkipDomSummaryNode(el)) return "无页面代码摘要";

  const singleTextMax = options?.singleTextMax ?? DOM_SUMMARY_SINGLE_TEXT_MAX;
  const totalMax = options?.totalMax ?? DOM_SUMMARY_TOTAL_MAX;
  const lines: string[] = [];

  function walk(node: Element, indent: number) {
    if (shouldSkipDomSummaryNode(node)) return;

    const tag = node.tagName.toLowerCase();
    const text = Array.from(node.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim())
      .filter(Boolean)
      .join(" ")
      .slice(0, singleTextMax);
    const cls = getDomSummaryClassNames(node);
    const comName = node.getAttribute("data-com-name") || "";
    const parts: string[] = [tag];
    if (cls) parts.push(` class: ${cls}`);
    if (comName) parts.push(` 组件: ${comName}`);
    if (text) parts.push(`文本: "${text}"`);
    const desc = parts.join("");
    lines.push("  ".repeat(indent) + desc);
    if (indent < 3 && !shouldSkipDomSummaryChildren(node)) {
      const visibleChildren = Array.from(node.children).filter((child) => !shouldSkipDomSummaryNode(child));
      visibleChildren
        .slice(0, DOM_SUMMARY_MAX_CHILDREN)
        .forEach((child) => walk(child, indent + 1));
      if (visibleChildren.length > DOM_SUMMARY_MAX_CHILDREN) {
        lines.push("  ".repeat(indent + 1) + `... ${visibleChildren.length - DOM_SUMMARY_MAX_CHILDREN} more children`);
      }
    }
  }

  walk(el, 0);
  let result = lines.join("\n");
  if (result.length <= totalMax) return result;
  const half = Math.floor((totalMax - 30) / 2);
  result =
    result.slice(0, half) + "\n... [中间内容已省略] ...\n" + result.slice(result.length - half);
  return result;
}

export default function buildDomChipInfo(ele?: Element): string {
  if (!ele) {
    return [
      " - 代码位置：未知",
      " - 该区域到叶子节点的Dom结构摘要：未知",
    ].join("\n");
  }

  const repeatContextLines = formatRepeatContexts(collectRepeatAncestorContexts(ele));
  return [
    ` - 相关代码：${getDomCodeLocation(ele)}`,
    ...repeatContextLines,
    " - 该区域到叶子节点的Dom结构摘要：",
    indentText(extractDomSummary(ele), "   "),
  ].join("\n");
}