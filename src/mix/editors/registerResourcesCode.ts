import context from '../context';
import { generateCodeStructure } from '../../utils/code-export/structure-generator';

export function registerResourcesCode(comId: string, comName: string) {
  if (!(window as any)._forApp_) {
    (window as any)._forApp_ = {};
  }
  const forApp = (window as any)._forApp_;
  forApp[comId] = { id: comId, name: comName, getFiles: (type: 'application' | 'component') => {
    const aiComParams = context.getAiComParams(comId);
    if (!aiComParams?.data) return null;
    return generateCodeStructure(aiComParams.data, { type });
  }};
  forApp._getResourcesCode_ = (type: 'application' | 'component') => {
    const result: Array<{ id: string; name: string; files: any[] }> = [];
    for (const key of Object.keys(forApp)) {
      if (key.startsWith('_')) continue;
      try {
        const instance = forApp[key];
        const files = instance.getFiles(type);
        if (files) {
          result.push({ id: instance.id, name: instance.name, files });
        }
      } catch (e) {
        console.error('[_getResourcesCode_] 实例导出失败', key, e);
      }
    }
    return result;
  };
}
