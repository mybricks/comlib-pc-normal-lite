import context, { config } from '../../../context';
import { parseLess, stringifyLess } from '../../../utils/transform/less';
import { resolveLessFilePath } from './resolveLessFilePath';

export type AnimationStylePlan = {
  type: 'animation-styles';
  changes: Array<{
    target: HTMLElement;
    selector: string;
    lessFile: string;
    style: Record<string, string | null>;
  }>;
};

/** 动画内容由编辑器计划决定；按文件合并 Less 增删，复用原有规则修改与提交。 */
export function createAnimationStylePlan({
  patchLessChange, updateStyleFileInBranch,
}: {
  patchLessChange(cssObj: Record<string, any>, change: AnimationStylePlan['changes'][number]): void;
  updateStyleFileInBranch(params: { path: string; previous: string; current: string; ele: Element | null }): void;
}) {
  return function applyAnimationStylePlan(plan: AnimationStylePlan) {
    const files = context.component!.params.data.files;
    const drafts = new Map<string, { previous: string; cssObj: Record<string, any> }>();

    for (const change of plan.changes) {
      const path = resolveLessFilePath(change.lessFile, files, config.getEntryFile());
      // 同一文件的状态样式和 @property 修改合并后统一写入。
      if (!drafts.has(path)) {
        const file = files.find((file: { fileName: string; source: string }) => file.fileName === path)!;
        const previous = decodeURIComponent(file.source);
        const cssObj = parseLess(previous);
        drafts.set(path, { previous, cssObj });
      }
      const { cssObj } = drafts.get(path)!;
      patchLessChange(cssObj, change);
    }

    // 构建目标为 ES5；使用 Map.forEach，避免 for...of 被降级成空循环。
    drafts.forEach(({ previous, cssObj }, path) => {
      const current = stringifyLess(cssObj);
      updateStyleFileInBranch({
        path, previous, current, ele: plan.changes[0].target,
      });
    });
  };
}
