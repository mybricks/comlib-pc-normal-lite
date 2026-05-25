import context from '../../context';
import type { FigmaComponentPatch } from '../types';

const DEBUG_SYNC_ID_HINT = '';

function decodeSource(v?: string): string {
  if (!v) return '';
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function encodeSource(v: string): string {
  return encodeURIComponent(v);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从 left（`<` 的位置）向右扫描，跳过 JSX 表达式 `{…}` / `(…)` 内部的 `>` 字符，
 * 返回真正的开标签结束符 `>` 的位置（含自闭 `/>` 的 `>`）。
 * 遇到字符串字面量（`'...'` / `"..."` / `` `...` ``）同样跳过。
 */
function findTagClose(src: string, left: number): number {
  let i = left;
  let depth = 0; // { 深度
  let parenDepth = 0; // ( 深度
  let inString: string | null = null;
  while (i < src.length) {
    const ch = src[i];
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      i++;
      continue;
    }
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { depth--; i++; continue; }
    if (ch === '(') { parenDepth++; i++; continue; }
    if (ch === ')') { parenDepth--; i++; continue; }
    if (ch === '>' && depth === 0 && parenDepth === 0) {
      return i;
    }
    i++;
  }
  return -1;
}

function toJsonString(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

function safeParseJson(v: string): any | null {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

type SyncLocHint = {
  fileJsx?: string;
  jsxStart?: number;
  jsxEnd?: number;
  lineStart?: number;
};

function normalizePathLike(v: string): string {
  return String(v || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function parseSyncLocHint(syncId?: string): SyncLocHint | null {
  if (!syncId) return null;
  const p = safeParseJson(syncId);
  if (!p || typeof p !== 'object') return null;
  const fileJsx = normalizePathLike(String(p?.files?.jsx || ''));
  const jsxStart = Number(p?.jsx?.start);
  const jsxEnd = Number(p?.jsx?.end);
  const lineStart = Number(p?.codeLine?.start);
  return {
    fileJsx: fileJsx || undefined,
    jsxStart: Number.isFinite(jsxStart) ? jsxStart : undefined,
    jsxEnd: Number.isFinite(jsxEnd) ? jsxEnd : undefined,
    lineStart: Number.isFinite(lineStart) ? lineStart : undefined,
  };
}

function getPatchLocMeta(patch: FigmaComponentPatch): SyncLocHint | null {
  const m = patch.meta || {};
  const fileJsx = normalizePathLike(String(m.fileJsx || ''));
  const jsxStart = Number(m.jsxStart);
  const jsxEnd = Number(m.jsxEnd);
  const lineStart = Number(m.codeLineStart);
  const hasExplicit =
    !!fileJsx || Number.isFinite(jsxStart) || Number.isFinite(jsxEnd) || Number.isFinite(lineStart);
  if (hasExplicit) {
    return {
      fileJsx: fileJsx || undefined,
      jsxStart: Number.isFinite(jsxStart) ? jsxStart : undefined,
      jsxEnd: Number.isFinite(jsxEnd) ? jsxEnd : undefined,
      lineStart: Number.isFinite(lineStart) ? lineStart : undefined,
    };
  }
  const syncId = m.syncId ? String(m.syncId) : '';
  return parseSyncLocHint(syncId);
}

function parseCnFromSyncId(syncId?: string): string[] {
  if (!syncId) return [];
  const p = safeParseJson(syncId);
  if (!p || !Array.isArray(p.cn)) return [];
  return p.cn.map((x: unknown) => String(x)).filter(Boolean);
}

/**
 * 校验 patch 的 cn 与目标标签的 className/cn 是否匹配。
 * 仅当 patch 携带 cn 信息时生效；没有 cn 的 patch 不做额外限制。
 */
function matchPatchCnToAttrs(cnList: string[], attrs: string): boolean {
  if (!cnList.length) return true;
  // 从 data-zone-classnames 属性读取 cn 列表
  const zoneMatch = attrs.match(/data-zone-classnames="([^"]*)"/);
  if (zoneMatch) {
    const attrCns = zoneMatch[1].split(/\s+/).filter(Boolean);
    return cnList.some((c) => attrCns.includes(c));
  }
  // 兜底：从 className 属性里找
  const classMatch =
    attrs.match(/className=\{styles\.(\w+)\}/) ||
    attrs.match(/className="([^"]*)"/) ||
    attrs.match(/className='([^']*)'/);
  if (classMatch) {
    return cnList.some((c) => classMatch[1].includes(c));
  }
  return false;
}

function escapeAttrString(v: string): string {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatJsxAttrValue(v: string | boolean | number): string {
  if (typeof v === 'boolean') return `{${v ? 'true' : 'false'}}`;
  if (typeof v === 'number') return `{${v}}`;
  return `"${escapeAttrString(v)}"`;
}

function matchTagComponent(tagName: string, component: string): boolean {
  if (!tagName || !component) return false;
  if (tagName === component) return true;
  if (tagName.startsWith(`${component}.`)) return true;
  return false;
}

const COMPONENT_MANAGED_PROPS: Record<string, string[]> = {
  Input: ['size', 'addonBefore', 'addonAfter', 'placeholder', 'prefix', 'suffix', 'allowClear', 'showCount', 'disabled', 'bordered'],
  Button: ['size', 'type', 'shape', 'danger', 'ghost', 'loading', 'disabled'],
  Alert: ['type', 'message', 'description', 'showIcon', 'closable', 'banner'],
  Tag: ['color', 'closable', 'bordered'],
};

function getManagedPropsByComponent(component: string): string[] {
  return COMPONENT_MANAGED_PROPS[component] || [];
}

function normalizePatchProps(
  component: string,
  props: Record<string, string | boolean | number>
): Record<string, string | boolean | number | undefined> {
  const next: Record<string, string | boolean | number | undefined> = Object.assign({}, props || {});
  if (component === 'Button') {
    // secondary 是 Figma 变体专用值，Ant Design 无此 type，写回会丢失细边框样式
    // 用 undefined 作哨兵：既不写入新值，也不删除 TSX 里已有的 type
    if (next.type === 'secondary') {
      next.type = undefined;
    }
  }
  return next;
}

function upsertJsxProp(attrs: string, prop: string, value: string | boolean | number): string {
  const valueExpr = formatJsxAttrValue(value);
  const assignRe = new RegExp(`(\\s${escapeRegExp(prop)}\\s*=\\s*)(\\{[^}]*\\}|"[^"]*"|'[^']*')`);
  if (assignRe.test(attrs)) {
    return attrs.replace(assignRe, `$1${valueExpr}`);
  }
  const boolOnlyRe = new RegExp(`\\s${escapeRegExp(prop)}(?=\\s|$)`);
  if (boolOnlyRe.test(attrs)) {
    return attrs.replace(boolOnlyRe, ` ${prop}=${valueExpr}`);
  }
  return `${attrs} ${prop}=${valueExpr}`;
}

function removeJsxProp(attrs: string, prop: string): string {
  const assignRe = new RegExp(`\\s${escapeRegExp(prop)}\\s*=\\s*(\\{[^}]*\\}|"[^"]*"|'[^']*')`, 'g');
  const boolOnlyRe = new RegExp(`\\s${escapeRegExp(prop)}(?=\\s|$)`, 'g');
  return attrs.replace(assignRe, '').replace(boolOnlyRe, '');
}

function replaceDataFigmaPropsAttr(attrs: string, json: string): string {
  if (/data-figma-props=\{`([^`]*)`\}/.test(attrs)) {
    return attrs.replace(
      /data-figma-props=\{`([^`]*)`\}/,
      `data-figma-props={\`${json}\`}`
    );
  }
  if (/data-figma-props="([^"]*)"/.test(attrs)) {
    return attrs.replace(
      /data-figma-props="([^"]*)"/,
      `data-figma-props="${json.replace(/"/g, '&quot;')}"`
    );
  }
  return attrs.replace(
    /data-figma-props='([^']*)'/,
    `data-figma-props='${json.replace(/'/g, "\\'")}'`
  );
}

function applyPatchToJsxAttrs(
  attrs: string,
  patch: FigmaComponentPatch,
  normalizedProps: Record<string, string | boolean | number | undefined>
): { nextAttrs: string; changed: boolean } {
  const slashMatch = attrs.match(/\s*\/\s*$/);
  const trailingSlash = slashMatch ? slashMatch[0] : '';
  let next = trailingSlash ? attrs.slice(0, attrs.length - trailingSlash.length) : attrs;
  const before = attrs;
  const incomingProps = normalizedProps || {};
  const managedProps = getManagedPropsByComponent(patch.component);

  // 覆盖模式：受控 props 在 patch 缺失时删除，出现时写入/更新；值为 undefined 时保留原值（跳过）
  managedProps.forEach((k) => {
    const v = Object.prototype.hasOwnProperty.call(incomingProps, k) ? incomingProps[k] : undefined;
    if (v === undefined) {
      if (!Object.prototype.hasOwnProperty.call(incomingProps, k)) {
        // 完全缺失 → 删除
        next = removeJsxProp(next, k);
      }
      // 值为 undefined 的哨兵 → 保留 TSX 原值，不删除也不写入
      return;
    }
    next = upsertJsxProp(next, k, v as string | boolean | number);
  });

  Object.entries(incomingProps).forEach(([k, v]) => {
    if (k === 'children') return;
    if (v === undefined || v === null) return; // 哨兵值，跳过
    if (managedProps.includes(k)) return; // 已在上面处理
    next = upsertJsxProp(next, k, v as string | boolean | number);
  });

  next = next + trailingSlash;
  return { nextAttrs: next, changed: next !== before };
}

function applyPatchToSource(
  source: string,
  patch: FigmaComponentPatch,
  currentFile?: string
): { nextSource: string; changed: boolean } {
  const targetSyncId = patch.meta?.syncId ? String(patch.meta.syncId) : '';
  const syncLocHint = getPatchLocMeta(patch);
  const shouldDebug = !!targetSyncId && (!DEBUG_SYNC_ID_HINT || targetSyncId.includes(DEBUG_SYNC_ID_HINT));
  const managedProps = getManagedPropsByComponent(patch.component);
  const normalizedProps = normalizePatchProps(patch.component, patch.props || {});
  const cnList = parseCnFromSyncId(targetSyncId);
  if (shouldDebug) {
    console.log('[figma-sync][props] try-patch', {
      targetSyncId,
      component: patch.component,
      props: patch.props,
      normalizedProps,
      managedProps,
      instanceNth: patch.meta?.instanceNth,
    });
  }
  if (syncLocHint?.fileJsx && currentFile) {
    const cur = normalizePathLike(currentFile);
    if (cur !== syncLocHint.fileJsx) {
      return { nextSource: source, changed: false };
    }
  }
  if (!syncLocHint || typeof syncLocHint?.jsxStart !== 'number') {
    if (shouldDebug) {
      console.warn('[figma-sync][props] skip-non-index-patch', {
        file: currentFile || '',
        hasSyncId: !!targetSyncId,
        hasFileJsx: !!syncLocHint?.fileJsx,
        hasJsxStart: typeof syncLocHint?.jsxStart === 'number',
      });
    }
    return { nextSource: source, changed: false };
  }
  // 主路径：jsx 文件内按下标精确定位目标组件开标签并修改 props（不依赖 data-loc）
  const start = Math.max(0, syncLocHint.jsxStart);
  const endHint = Math.max(start, syncLocHint.jsxEnd ?? start);
  let left = source.lastIndexOf('<', start);
  if (start < source.length && source[start] === '<') {
    left = start;
  }
  if (left < 0) {
    if (shouldDebug) {
      console.warn('[figma-sync][props] strict-index-no-left', {
        file: currentFile || '',
        start,
        endHint,
      });
    }
    return { nextSource: source, changed: false };
  }
  const right = findTagClose(source, left);
  if (right < 0) {
    if (shouldDebug) {
      console.warn('[figma-sync][props] strict-index-no-right', {
        file: currentFile || '',
        left,
        start,
        endHint,
      });
    }
    return { nextSource: source, changed: false };
  }
  const full = source.slice(left, right + 1);
  // 贪婪匹配：findTagClose 已确保 full 末尾是正确的 `>`，
  // 用贪婪 `[\s\S]*` 把包括 self-closing `/` 在内的全部 attrs 保留进 m[2]，
  // applyPatchToJsxAttrs 内部 trailingSlash 检测会识别并还原 `/`。
  const m = full.match(/^<([A-Za-z][\w.]*)\b([\s\S]*)>$/);
  if (!m) {
    if (shouldDebug) {
      console.warn('[figma-sync][props] strict-index-not-opening-tag', {
        file: currentFile || '',
        full,
        left,
        right,
      });
    }
    return { nextSource: source, changed: false };
  }
  const tagName = m[1];
  const attrs = m[2] || '';
  if (!matchTagComponent(tagName, patch.component)) {
    if (shouldDebug) {
      console.warn('[figma-sync][props] strict-index-component-not-match', {
        file: currentFile || '',
        tagName,
        patchComponent: patch.component,
        start,
        endHint,
      });
    }
    return { nextSource: source, changed: false };
  }
  // cn 校验：patch 携带 cn 时，要求命中标签的 className/data-zone-classnames 包含对应 cn
  if (cnList.length && !matchPatchCnToAttrs(cnList, attrs)) {
    if (shouldDebug) {
      console.warn('[figma-sync][props] strict-index-cn-not-match', {
        file: currentFile || '',
        tagName,
        cnList,
        start,
        endHint,
      });
    }
    return { nextSource: source, changed: false };
  }

  let nextAttrs = attrs;
  const dataAttrMatch =
    attrs.match(/data-figma-props=\{`([^`]*)`\}/) ||
    attrs.match(/data-figma-props="([^"]*)"/) ||
    attrs.match(/data-figma-props='([^']*)'/);
  if (dataAttrMatch) {
    const raw = dataAttrMatch[1];
    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object') {
      const oldJson = toJsonString(parsed);
      const nextMetaProps: Record<string, unknown> = Object.assign({}, parsed.props || {});
      managedProps.forEach((k) => {
        delete nextMetaProps[k];
      });
      Object.entries(normalizedProps).forEach(([k, v]) => {
        if (v !== undefined && v !== null) {
          nextMetaProps[k] = v;
        }
      });
      parsed.props = nextMetaProps;
      const newJson = toJsonString(parsed);
      if (newJson && newJson !== oldJson) {
        nextAttrs = replaceDataFigmaPropsAttr(nextAttrs, newJson);
      }
    }
  }
  const jsxAttrState = applyPatchToJsxAttrs(nextAttrs, patch, normalizedProps);
  if (!jsxAttrState.changed && nextAttrs === attrs) {
    if (shouldDebug) {
      console.log('[figma-sync][props] strict-index-no-prop-diff', {
        file: currentFile || '',
        tagName,
        start,
        endHint,
      });
    }
    return { nextSource: source, changed: false };
  }
  if (jsxAttrState.changed) {
    nextAttrs = jsxAttrState.nextAttrs;
  }
  const replaced = `<${tagName}${nextAttrs}>`;
  const nextSource = source.slice(0, left) + replaced + source.slice(right + 1);
  if (shouldDebug) {
    console.log('[figma-sync][props] strict-index-patch-applied', {
      file: currentFile || '',
      tagName,
      left,
      right,
      start,
      endHint,
    });
  }
  return { nextSource, changed: nextSource !== source };
}

export function syncComponentPropsFromFigmaJson(
  comId: string,
  patches: FigmaComponentPatch[]
): number {
  if (!Array.isArray(patches) || patches.length === 0) {
    console.log('[figma-sync][props] skip-empty-patches', { comId });
    return 0;
  }

  const aiComParams = context.getAiComParams(comId);
  if (!aiComParams?.data?.files) {
    console.warn('[figma-sync][props] abort-no-aiComParams', { comId });
    return 0;
  }
  const files: Array<{ fileName: string; source?: string }> = aiComParams.data.files;
  const jsxFiles = files.filter((f) => /\.(jsx|tsx)$/i.test(f.fileName) && !!f.source);
  if (!jsxFiles.length) {
    console.warn('[figma-sync][props] abort-no-jsx-files', { comId, fileCount: files.length });
    return 0;
  }
  let changedCount = 0;
  const updatedFiles = new Set<string>();

  for (const file of jsxFiles) {
    let source = decodeSource(file.source);
    let fileChanged = false;
    // 按 jsxStart 倒序应用，避免前面改动导致后续下标漂移
    const sortedPatches = [...patches].sort((a, b) => {
      const aStart = a.meta?.jsxStart ?? -1;
      const bStart = b.meta?.jsxStart ?? -1;
      return bStart - aStart;
    });
    for (const patch of sortedPatches) {
      const out = applyPatchToSource(source, patch, file.fileName);
      if (out.changed) {
        source = out.nextSource;
        fileChanged = true;
        changedCount += 1;
      }
    }
    if (fileChanged) {
      context.updateFile(comId, {
        fileName: file.fileName,
        content: source,
        type: undefined,
      });
      updatedFiles.add(file.fileName);
      file.source = encodeSource(source);
    }
  }

  if (updatedFiles.size > 0) {
    context.saveManualVersion(comId, Array.from(updatedFiles));
  }

  return changedCount;
}

