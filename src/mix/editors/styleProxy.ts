import context from '../context';
import { parseLess, stringifyLess } from '../utils/transform/less';
import { debounce } from '../../utils/debounce'

// ── CSS shorthand 映射 ────────────────────────────────────────────────────────

const CSS_SHORTHAND_GROUPS: Record<string, string[]> = {
  'margin': ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  'padding': ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  'background': ['background-color', 'background-image', 'background-repeat', 'background-position', 'background-size', 'background-attachment', 'background-origin', 'background-clip'],
};

const LONGHAND_TO_SHORTHAND: Record<string, string> = {};
Object.entries(CSS_SHORTHAND_GROUPS).forEach(([shorthand, longhands]) => {
  longhands.forEach(longhand => { LONGHAND_TO_SHORTHAND[longhand] = shorthand; });
});

function camelToKebab(str: string) {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}


function getBaseSelector(selector: string) {
  return selector.replace(/:{1,2}[a-zA-Z-]+(\([^)]*\))?$/, '').trim();
}

// 找出 cssObj 中与 targetSelector 同元素的孤儿 key（含伪类变体），用于清空后联动删除。
function findOrphanKeys(cssObj: Record<string, any>, targetSelector: string): string[] {
  const targetBase = getBaseSelector(targetSelector);
  const segments = targetBase.trim().split(/\s+/).filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  const middleSegments = segments.slice(1, -1);
  const rootSegment = segments[0];

  return Object.keys(cssObj).filter(key => {
    if (key === targetSelector) return false;
    const base = getBaseSelector(key);

    // 同一路径（含伪类）可一起删除，例如 ".a .b" 与 ".a .b:hover"
    if (base === targetBase) return true;

    // 保护独立根规则，避免把 ".a .b" 的后缀 ".b" / ".b::placeholder" 误删
    if (
      segments.length > 1 &&
      !base.includes(' ') &&
      !!lastSegment &&
      (base === lastSegment || base.endsWith(lastSegment))
    ) {
      return false;
    }

    // 只清理明显由中间节点拆分出来的扁平孤儿类（例如 ".parent .mid .leaf" 里的 ".mid"）
    if (segments.length >= 3 && !base.includes(' ') && middleSegments.includes(base)) {
      const parentRoots = new Set(
        Object.keys(cssObj)
          .map(item => getBaseSelector(item).trim().split(/\s+/).filter(Boolean))
          .filter(itemSegs => itemSegs.length > 1 && itemSegs.includes(base))
          .map(itemSegs => itemSegs[0])
      );
      if (parentRoots.size === 0 || (parentRoots.size === 1 && parentRoots.has(rootSegment))) {
        return true;
      }
    }

    return false;
  });
}

// 吸收孤儿类，将孤儿类合并到目标选择器中
function absorbOrphans(cssObj: Record<string, any>, targetKey: string): void {
  const segments = targetKey.trim().split(/\s+/).filter(Boolean);
  if (segments.length < 3) return;
  for (let i = 1; i < segments.length - 1; i++) {
    const candidate = segments[i];
    if (!candidate.startsWith('.') || !cssObj[candidate]) continue;
    const parentRoots = new Set(
      Object.keys(cssObj)
        .filter(key => { const segs = key.trim().split(/\s+/); return segs.length > 1 && segs.includes(candidate); })
        .map(key => key.trim().split(/\s+/)[0])
    );
    if (parentRoots.size > 1) continue;
    const nestedPath = segments.slice(0, i + 1).join(' ');
    cssObj[nestedPath] = { ...cssObj[candidate], ...(cssObj[nestedPath] ?? {}) };
    delete cssObj[candidate];
  }
}

function expandDeletions(deletions: string[]): string[] {
  const toDelete = new Set(deletions);
  deletions.forEach(key => {
    const kebabKey = camelToKebab(key);
    const shorthand = LONGHAND_TO_SHORTHAND[kebabKey] ?? LONGHAND_TO_SHORTHAND[key];
    if (shorthand) toDelete.add(shorthand);
    const longhands = CSS_SHORTHAND_GROUPS[kebabKey] ?? CSS_SHORTHAND_GROUPS[key];
    if (longhands) longhands.forEach(lh => toDelete.add(lh));
  });
  return Array.from(toDelete);
}

function findCompoundClassKey(cssObj: Record<string, any>, eleClassList: string[]): string | undefined {
  const validClasses = new Set(eleClassList.filter(c => c && c !== 'undefined'));
  let best: string | undefined;
  let bestCount = 0;
  for (const key of Object.keys(cssObj)) {
    if (key.includes(' ')) continue;
    const classes = (key.match(/\.([^.#[:]+)/g) ?? []).map(c => c.slice(1));
    if (classes.length < 2) continue;
    if (classes.every(c => validClasses.has(c)) && classes.length > bestCount) {
      best = key;
      bestCount = classes.length;
    }
  }
  return best;
}

// 根据选择器获取对应的css对象key
function resolveTargetKey(params: {
  cssObj: Record<string, any>;
  fullSelector: string;
  eleClassList?: string[];
}): string {
  const { cssObj, fullSelector, eleClassList = [] } = params;
  const segments = fullSelector.trim().split(/\s+/).filter(Boolean);

  // 后缀遍历匹配：取路径最长（最具体）的 key
  const suffixMatchKey = Object.keys(cssObj)
    .filter(k => k === fullSelector || k.endsWith(' ' + fullSelector))
    .sort((a, b) => b.length - a.length)[0];

  const shrinkMatchKey = segments.slice(1).reduce((found: string | undefined, _, i) => {
    if (found) return found;
    const candidate = segments.slice(i + 1).join(' ');
    return cssObj[candidate] !== undefined ? candidate : undefined;
  }, undefined as string | undefined);

  const compoundMatchKey = eleClassList.length > 0 ? findCompoundClassKey(cssObj, eleClassList) : undefined;

  // 逗号分隔选择器兼容
  const commaMatchKey = Object.keys(cssObj).find(k => {
    if (!k.includes(',')) return false;
    return k.split(',').map(s => s.trim()).some(s => s === fullSelector || s.endsWith(' ' + fullSelector));
  });

  return suffixMatchKey ?? shrinkMatchKey ?? compoundMatchKey ?? commaMatchKey ?? fullSelector;
}

function extractDataZoneSelector(selector: string): string {
  const match = selector.match(/\[data-zone-selector=\[["']([^"']+)["']\]\]/);
  return match?.[1] ?? selector;
}

// ── 工厂函数 ──────────────────────────────────────────────────────────────────

export function genStyleValue(params: { comId: string }) {
  const { comId } = params;

  const debouncedUpdateFile = debounce(
    (lessPath: string) => {
      context.saveManualVersion(comId, [lessPath]);
    },
    300
  );

  return {
    set(params: any, value: any) {
      const loc = params.focusArea?.dataset.loc;
      const cn = JSON.parse(loc);
      const lessPath = cn.files?.less ?? 'style.less';

      const deletions: string[] | null = (window as any).__mybricks_style_deletions;
      const aiComParams = context.getAiComParams(comId);
      const lessFile = lessPath
        ? aiComParams.data.files?.find((f: { fileName: string; source: string }) => f.fileName === lessPath)
        : undefined;
      const rawLess = lessFile?.source ?? aiComParams.data.styleSource ?? '';
      const cssObj = rawLess ? parseLess(decodeURIComponent(rawLess)) : {};

      const fullSelector = params.selector;

      // console.log("editConfig.value.set 组件侧接收params.selector",fullSelector)

      const ele: Element | null = params.focusArea?.ele ?? null;
      const eleClassList = ele ? Array.from(ele.classList) as string[] : [];
      const targetKey = resolveTargetKey({ cssObj, fullSelector, eleClassList });

      absorbOrphans(cssObj, targetKey);

      if (!cssObj[targetKey]) {
        cssObj[targetKey] = {};
      }

      Object.entries(value).forEach(([key, val]) => {
        cssObj[targetKey][key] = val;
      });

      if (deletions && deletions.length > 0) {
        const expandedDeletions = expandDeletions(deletions);
        expandedDeletions.forEach(key => delete cssObj[targetKey][key]);
      }

      if (Object.keys(cssObj[targetKey] || {}).length === 0) {
        const orphanKeys = findOrphanKeys(cssObj, targetKey);
        orphanKeys.forEach(key => delete cssObj[key]);
        delete cssObj[targetKey];
      }

      const cssStr = stringifyLess(cssObj);
      context.updateFile(comId, { fileName: lessPath, content: cssStr, type: undefined });
      debouncedUpdateFile(lessPath);
    },
  };
}

export function genImgSrcReplacer() {
  return {
    get(params: any) {
      return params.focusArea?.ele?.getAttribute?.('src') ?? '';
    },
    set(params: any) {
      const loc = JSON.parse(params.focusArea?.dataset?.loc ?? '{}');
      const jsxPath = loc.files?.jsx;
      if (!jsxPath) return;

      const comId = params.id;
      const aiComParams = context.getAiComParams(comId);
      const jsxFile = aiComParams?.data?.files?.find(
        (f: { fileName: string; source: string }) => f.fileName === jsxPath
      );
      if (!jsxFile) return;
      const source = decodeURIComponent(jsxFile.source);

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const uploadFn = params.env?.uploadFile;
        let newSrc: string;
        if (typeof uploadFn === 'function') {
          const res = await uploadFn([file]);
          newSrc = res?.url ?? '';
        } else {
          newSrc = await new Promise<string>(resolve => {
            const fr = new FileReader();
            fr.readAsDataURL(file);
            fr.onload = ev => resolve((ev.currentTarget as FileReader).result as string);
          });
        }

        const snippet = source.slice(loc.jsx.start, loc.jsx.end);
        const newSnippet = snippet.replace(
          /\bsrc=(["'])([^"']*)\1|\bsrc=\{["'`]([^"'`]*)["'`]\}/,
          `src="${newSrc}"`
        );
        const newSource = source.slice(0, loc.jsx.start) + newSnippet + source.slice(loc.jsx.end);

        context.updateFile(comId, { fileName: jsxPath, content: newSource, type: undefined });
        context.saveManualVersion(comId, [jsxPath]);
      };
      input.click();
    }
  };
}

export function genResizer() {
  let cssObj: Record<string, any> = {};
  let cssObjKey = '';
  let lessPath = 'style.less';

  return {
    type: '_resizer',
    value: {
      get() {},
      set(params: any, value: any, status: any) {
        const { state } = status
        if (state === 'start') {
          if (!params.selector) return;
          const comId = params.id;
          const loc = params.focusArea?.dataset.loc;
          const cn = loc ? JSON.parse(loc) : {};
          lessPath = cn.files?.less ?? 'style.less';

          const aiComParams = context.getAiComParams(comId);
          const lessFile = lessPath
            ? aiComParams.data.files?.find((f: { fileName: string; source: string }) => f.fileName === lessPath)
            : undefined;
          const rawLess = lessFile?.source ?? aiComParams.data.styleSource ?? '';
          cssObj = rawLess ? parseLess(decodeURIComponent(rawLess)) : {};

          const selector = extractDataZoneSelector(params.selector);
          const ele: Element | null = params.focusArea?.ele ?? null;
          const eleClassList = ele ? Array.from(ele.classList) as string[] : [];
          cssObjKey = resolveTargetKey({ cssObj, fullSelector: selector, eleClassList });

          if (!cssObj[cssObjKey]) {
            cssObj[cssObjKey] = {};
          }
        } else if (state === 'ing') {
          if (!cssObjKey || !cssObj[cssObjKey]) return;
          Object.entries(value).forEach(([key, val]) => {
            cssObj[cssObjKey][key] = `${val}px`;
          });
          const cssStr = stringifyLess(cssObj);
          context.updateFile(params.id, { fileName: lessPath, content: cssStr, type: undefined });
        } else if (state === 'finish') {
          context.saveManualVersion(params.id, [lessPath]);
        }
      },
    },
  };
}
