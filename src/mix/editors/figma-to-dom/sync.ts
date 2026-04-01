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

/**
 * 解析多文件格式的 Figma 选择器：`.{encodedFilePath}-{className}`
 * encodedFilePath = fileName.replace(/[^0-9a-zA-Z_]/g, '_')
 * 返回 null 表示是旧格式选择器，走兼容逻辑。
 */
function parseMultiFileSelector(
  rawSelector: string,
  files: Array<{ fileName: string }>
): { fileName: string; cssClass: string } | null {
  if (!rawSelector.startsWith('.')) return null;
  const inner = rawSelector.slice(1);
  const dashIdx = inner.indexOf('-');
  if (dashIdx === -1) return null;

  const prefix = inner.substring(0, dashIdx);
  const className = '.' + inner.substring(dashIdx + 1);

  const matchedFile = files?.find(
    (f) => f.fileName.replace(/[^0-9a-zA-Z_]/g, '_') === prefix
  );
  if (!matchedFile) return null;

  return { fileName: matchedFile.fileName, cssClass: className };
}

/** 从 Figma JSON（含 selectors）同步样式到组件各 less 文件，只同步有差异的部分 */
export function syncStylesFromFigmaJson(comId: string, figmaItems: FigmaImportItem[]) {
  const aiComParams = context.getAiComParams(comId);
  if (!aiComParams?.data) return;

  const files: Array<{ fileName: string; source: string }> = aiComParams.data.files || [];

  // 按目标文件名分组；null 表示旧格式，走兼容逻辑
  const fileGroups = new Map<string | null, FigmaImportItem[]>();

  figmaItems.forEach((item) => {
    const { selectors } = item;
    if (!Array.isArray(selectors) || selectors.length === 0) return;
    const rawSelector = selectors[0];
    const parsed = parseMultiFileSelector(rawSelector, files);
    const groupKey = parsed ? parsed.fileName : null;
    if (!fileGroups.has(groupKey)) fileGroups.set(groupKey, []);
    fileGroups.get(groupKey)!.push(item);
  });

  let anyChange = false;

  fileGroups.forEach((items, groupFileName) => {
    let sourceContent: string | null = null;
    let targetFileName: string;

    if (groupFileName === null) {
      // 兼容旧逻辑：从 styleSource 读取，写回 style.less
      if (!aiComParams.data.styleSource) {
        console.warn('[从 Figma 同步] 组件无 styleSource，跳过兼容旧逻辑');
        return;
      }
      sourceContent = decodeURIComponent(aiComParams.data.styleSource);
      targetFileName = 'style.less';
    } else {
      const file = files.find((f) => f.fileName === groupFileName);
      if (!file?.source) {
        console.warn(`[从 Figma 同步] 文件 ${groupFileName} 无内容，跳过`);
        return;
      }
      sourceContent = decodeURIComponent(file.source);
      targetFileName = groupFileName;
    }

    const cssObj = parseLess(sourceContent);
    let hasChange = false;

    items.forEach((item) => {
      const { selectors, value: styles } = item;
      if (!Array.isArray(selectors) || selectors.length === 0 || !styles || typeof styles !== 'object') return;

      const rawSelector = selectors[0];
      let selector: string;

      if (groupFileName === null) {
        selector = normalizeFigmaSelector(rawSelector, comId);
      } else {
        const parsed = parseMultiFileSelector(rawSelector, files);
        selector = parsed ? parsed.cssClass : '';
      }
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
      context.updateFile(comId, { fileName: targetFileName, content: cssStr, type: undefined });
      anyChange = true;
    }
  });

  if (anyChange) {
    context.addVersion(comId, 'editor');
  }
}
