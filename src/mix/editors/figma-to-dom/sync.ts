import context from '../../context';
import { parseLess, stringifyLess } from '../../utils/transform/less';
import { convertHyphenToCamel } from '../../../utils/string';
import type { FigmaImportItem } from '../types';

/** 去掉 Figma 选择器前可能带的组件 ID classname，便于与组件 less 的 key 匹配 */
export function normalizeFigmaSelector(selector: string, comId: string): string {
  if (!comId || !selector.startsWith('.')) return selector;
  const escaped = comId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\.${escaped}(\\.|\\s+)?`);
  return selector.replace(re, (_, suffix) => (suffix === '.' ? '.' : '')).trim();
}

/** 从 Figma JSON（含 selectors）同步样式到组件 style.less，只同步有差异的部分 */
export function syncStylesFromFigmaJson(comId: string, figmaItems: FigmaImportItem[]) {
  const aiComParams = context.getAiComParams(comId);
  if (!aiComParams?.data?.styleSource) {
    console.warn('[从 Figma 同步] 组件无 styleSource，跳过同步');
    return;
  }
  const cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
  let hasChange = false;

  figmaItems.forEach((item) => {
    const { selectors, value: styles } = item;
    if (!Array.isArray(selectors) || selectors.length === 0 || !styles || typeof styles !== 'object') {
      return;
    }
    const rawSelector = selectors[0];
    const selector = normalizeFigmaSelector(rawSelector, comId);
    if (!selector) return;

    const cssObjKey = Object.keys(cssObj).find(
      (key) => key === selector || key.endsWith(' ' + selector)
    ) ?? null;
    if (!cssObjKey || !cssObj[cssObjKey]) return;

    Object.entries(styles).forEach(([cssKey, figmaValue]) => {
      const camelKey = convertHyphenToCamel(cssKey);
      const currentValue = cssObj[cssObjKey][camelKey];
      if (currentValue !== figmaValue) {
        cssObj[cssObjKey][camelKey] = figmaValue;
        hasChange = true;
      }
    });
  });

  if (hasChange) {
    const cssStr = stringifyLess(cssObj);
    context.updateFile(comId, { fileName: 'style.less', content: cssStr });
    context.addVersion(comId, 'editor');
  }
}
