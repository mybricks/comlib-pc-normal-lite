import { deriveNameFromFilePath } from '../utils';
import {
  extractRefFromVariableDeclarator,
  extractRefFromExportDefault,
} from '../../../utils/ai-code/plugins/utils/comRef';

export const RULE_ID = 'extract-comrefs';

/**
 * 从 JSX 文件中提取所有 comRef、popupRef、appRef 的节点信息。
 * 用于跨文件校验 README.md 的节点一致性。
 *
 * 注意：不提取 Route 相关信息，因为 Route 不一定就是 page，page 无法确定。
 *
 * 识别函数由 src/utils/ai-code/plugins/utils/comRef.ts 统一维护：
 *   - extractRefFromVariableDeclarator：识别 const Xxx = comRef/popupRef(...)
 *   - extractRefFromExportDefault：识别 export default comRef/popupRef/appRef(...)
 *
 * @param fileName 文件名，用于 export default comRef/popupRef 时派生组件名
 * @returns { plugin, getResults } plugin 注入 Babel，getResults 在 transform 后读取结果
 */
export type ComRefInfo = {
  /** 节点变量名，如 'SignIn'、'HomePage'、'default' */
  name: string;
  /** 节点类型：comRef | popupRef | appRef */
  kind: 'comRef' | 'popupRef' | 'appRef';
};

export function createExtractComRefsRule(fileName?: string): {
  plugin: (babel: any) => { visitor: Record<string, any> };
  getResults: () => ComRefInfo[];
} {
  const results: ComRefInfo[] = [];
  const fallbackName = deriveNameFromFilePath(fileName);

  function plugin(_babel: any) {
    return {
      visitor: {
        VariableDeclarator(path: any) {
          const info = extractRefFromVariableDeclarator(path.node);
          if (info) results.push(info);
        },
        ExportDefaultDeclaration(path: any) {
          const info = extractRefFromExportDefault(path.node, fallbackName);
          if (info) results.push(info);
        },
      },
    };
  }

  return {
    plugin,
    getResults: () => [...results],
  };
}
