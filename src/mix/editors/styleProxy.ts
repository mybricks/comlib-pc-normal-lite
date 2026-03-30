import context from '../context';
import { parseLess, stringifyLess } from '../utils/transform/less';

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

function findOrphanKeys(cssObj: Record<string, any>, targetSelector: string): string[] {
  const segments = targetSelector.trim().split(/\s+/).filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  return Object.keys(cssObj).filter(key => {
    if (key === targetSelector) return false;
    const base = getBaseSelector(key);
    if (base === targetSelector || targetSelector.endsWith(' ' + base)) return true;
    if (segments.length === 1 && lastSegment.startsWith('.') && base.endsWith(lastSegment) && !base.includes(' ')) return true;
    return false;
  });
}

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

// ── 工厂函数 ──────────────────────────────────────────────────────────────────

export function genStyleValue(params: { comId: string }) {
  const { comId } = params;
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
      const segments = fullSelector.trim().split(/\s+/).filter(Boolean);

      const ele: Element | null = params.focusArea?.ele ?? null;
      const eleClassList = ele ? Array.from(ele.classList) as string[] : [];

      // 后缀遍历匹配：取路径最长（最具体）的 key
      const suffixMatchKey = Object.keys(cssObj)
        .filter(k => k === fullSelector || k.endsWith(' ' + fullSelector))
        .sort((a, b) => b.length - a.length)[0];

      const shrinkMatchKey = segments.slice(1).reduce((found: string | undefined, _, i) => {
        if (found) return found;
        const candidate = segments.slice(i + 1).join(' ');
        return cssObj[candidate] !== undefined ? candidate : undefined;
      }, undefined) as string | undefined;

      const compoundMatchKey = eleClassList.length > 0 ? findCompoundClassKey(cssObj, eleClassList) : undefined;

      // 逗号分隔选择器兼容
      const commaMatchKey = Object.keys(cssObj).find(k => {
        if (!k.includes(',')) return false;
        return k.split(',').map(s => s.trim()).some(s => s === fullSelector || s.endsWith(' ' + fullSelector));
      });

      const targetKey: string =
        suffixMatchKey
        ?? shrinkMatchKey
        ?? compoundMatchKey
        ?? commaMatchKey
        ?? fullSelector;

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
      context.addVersion(comId, 'editor');
    },
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
        if (status.state === 'start') {
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

          const match = params.selector?.match(/\[data-zone-selector=\[["']([^"']+)["']\]\]/);
          const selector = match?.[1] ?? params.selector;
          cssObjKey = Object.keys(cssObj).find(key => key.endsWith(selector)) ?? selector;

          if (!cssObj[cssObjKey]) {
            cssObj[cssObjKey] = {};
          }
        } else if (status.state === 'ing') {
          if (!cssObjKey || !cssObj[cssObjKey]) return;
          Object.entries(value).forEach(([key, val]) => {
            cssObj[cssObjKey][key] = `${val}px`;
          });

          const cssStr = stringifyLess(cssObj);
          context.updateFile(params.id, { fileName: lessPath, content: cssStr, type: undefined });
          context.addVersion(params.id, 'editor');
        }
      },
    },
  };
}
