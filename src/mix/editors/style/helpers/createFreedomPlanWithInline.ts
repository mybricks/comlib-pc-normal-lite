import context, { config } from '../../../context';
import { parseLess, stringifyLess } from '../../../utils/transform/less';
import { resolveLessFilePath } from './resolveLessFilePath';
import { prepareFreedomInlineWrite } from './prepareFreedomInlineWrite';
import type { InlineStyleBatch } from './createInlineStyleHistory';

export type FreedomPlan = {
  changes: Array<{ target: HTMLElement; selector: string; lessFile: string; style: Record<string, any> }>;
};

/** 准备含 inline 项的 freeform 文件补丁和节点变更，统一交给 inline 历史入口提交。 */
export function createFreedomPlanWithInline({
  patchLessChange, updateInlineStyleBatchInBranch,
}: {
  patchLessChange(cssObj: Record<string, any>, change: FreedomPlan['changes'][number]): void;
  updateInlineStyleBatchInBranch(batch: InlineStyleBatch): void;
}) {
  return function applyFreedomPlanWithInline(plan: FreedomPlan) {
    const files = context.component!.params.data.files;
    const drafts = new Map<string, { previous: string; current: string }>();
    const inlineChanges = new Map<HTMLElement, Record<string, any>>();
    const lessDrafts = new Map<string, Record<string, any>>();
    const readDraft = (path: string) => {
      if (!drafts.has(path)) {
        const file = files.find((file: { fileName: string }) => file.fileName === path);
        if (!file) throw new Error(`freeform 找不到源码文件：${path}`);
        const previous = decodeURIComponent(file.source);
        drafts.set(path, { previous, current: previous });
      }
      return drafts.get(path)!;
    };
    plan.changes.forEach(change => {
      const { target, selector, lessFile, style } = change;
      if (selector === 'inline') {
        inlineChanges.set(target, { ...inlineChanges.get(target), ...style });
        return;
      }
      // 混合计划中的 Less 项仍复用同一套规则定位、属性删除与序列化。
      const path = resolveLessFilePath(lessFile, files, config.getEntryFile());
      if (!lessDrafts.has(path)) lessDrafts.set(path, parseLess(readDraft(path).previous));
      patchLessChange(lessDrafts.get(path)!, change);
    });
    lessDrafts.forEach((cssObj, path) => { readDraft(path).current = stringifyLess(cssObj); });

    // 同文件按源码位置倒序准备，父子开标签互不重叠，避免后一个整文件 patch 覆盖前一个。
    const inlineWrites = Array.from(inlineChanges).sort(([a], [b]) => JSON.parse(b.dataset.loc!).jsx.start - JSON.parse(a.dataset.loc!).jsx.start)
      .map(([target, style]) => {
        const path = JSON.parse(target.dataset.loc!).files.jsx;
        const draft = readDraft(path);
        const write = prepareFreedomInlineWrite(draft.current, target, style);
        draft.current = write.current;
        return { target, path, style, replacement: write.replacement, styleInfo: write.styleInfo };
      });
    updateInlineStyleBatchInBranch({ target: plan.changes[0].target, files: drafts, changes: inlineWrites });
  };
}
