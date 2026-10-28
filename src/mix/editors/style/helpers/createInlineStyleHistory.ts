import context from '../../../context';
import { debounce } from '../../../../utils/debounce';
import { randomUUID } from '../../../utils/uuid';
import { undoRedoManager } from '../../undoRedo';
import {
  createDOMSourceLocationSnapshot,
  restoreDOMSourceLocationSnapshot,
  shiftDOMSourceLocationsAfterReplacement,
  type SourceReplacement,
} from '../../setSegment/sourceLocation';

/** 每个样式代理独立维护 inline 合并窗口，避免不同代理共享 pending 状态。 */
export function createInlineStyleHistory({
  getShadowDoc, getStyleActionTitle, endStyleFileBranch,
}: {
  getShadowDoc(): Document | ShadowRoot;
  getStyleActionTitle(ele: Element): string;
  endStyleFileBranch(): void;
}) {
  // 仅目标 inline 路径使用；一轮输入中的各次 patch 顺序重放、逆序撤销。
  let pendingInlineStyleBranch: {
    ele: Element;
    path: string;
    commands: Array<{ execute(): void; undo(): void }>;
  } | null = null;
  const finalizeInlineStyleBranch = debounce(() => { pendingInlineStyleBranch = null; }, 500);
  undoRedoManager.onBranchHistoryChange(() => {
    // 其他操作入栈以及 undo / redo / cancel 后，不能继续合并到旧命令。
    pendingInlineStyleBranch = null;
  });

  // 与画布 resize 一样，把源码、DOM 和偏移一起放进命令；公共文件写入保持原职责。
  const updateInlineStyleInBranch = (
    ele: Element | null, path: string, current: string, previous: string, applyInlinePatch: () => void,
  ) => {
    const targetEle = ele as HTMLElement;
    const shadowRoot = getShadowDoc();
    const sourceLocationSnapshot = createDOMSourceLocationSnapshot(shadowRoot, path);
    // 整体保存声明顺序和 priority，避免简写拆分后逐属性恢复互相覆盖。
    const previousInlineStyle = targetEle.style.cssText;

    // 这些 patch 只改当前开标签。取实际改动区间，复用拖拽的同文件定位同步。
    let start = 0;
    while (start < previous.length && start < current.length && previous[start] === current[start]) start++;
    let end = previous.length;
    let nextEnd = current.length;
    while (end > start && nextEnd > start && previous[end - 1] === current[nextEnd - 1]) {
      end--;
      nextEnd--;
    }
    const replacement: SourceReplacement = { start, end, newLength: nextEnd - start };
    const command = {
      execute() {
        context.updateFile({ fileName: path, content: current, type: undefined, noUpdateFileSystem: true });
        applyInlinePatch();
        // 分支已算出目标属性的精确偏移；全局位移后保留它，避免重复偏移。
        const nextStyleInfo = targetEle.dataset.styleInfo;
        shiftDOMSourceLocationsAfterReplacement(shadowRoot, path, replacement);
        targetEle.dataset.styleInfo = nextStyleInfo!;
      },
      undo() {
        context.updateFile({ fileName: path, content: previous, type: undefined, noUpdateFileSystem: true, updateSource: 'undo' });
        restoreDOMSourceLocationSnapshot(sourceLocationSnapshot);
        targetEle.style.cssText = previousInlineStyle;
      },
    };

    endStyleFileBranch();
    let branch = pendingInlineStyleBranch;
    if (!branch || branch.ele !== targetEle || branch.path !== path) {
      branch = { ele: targetEle, path, commands: [command] };
      const currentBranch = branch;
      const actionId = randomUUID();
      const title = getStyleActionTitle(targetEle);
      undoRedoManager.executeBranch({
        execute() {
          currentBranch.commands.forEach((item) => item.execute());
          context.component?.actions.addUserAction({ id: actionId, type: 'update-style', title, refElement: targetEle });
        },
        undo() {
          currentBranch.commands.slice().reverse().forEach((item) => item.undo());
          context.component?.actions.removeUserAction(actionId);
        },
      });
      // executeBranch 会通知历史变化；首次入栈完成后再开启本轮合并。
      pendingInlineStyleBranch = branch;
    } else {
      command.execute();
      branch.commands.push(command);
    }
    finalizeInlineStyleBranch();
  };

  return {
    updateInlineStyleInBranch,
    clearPendingBranch() {
      pendingInlineStyleBranch = null;
    },
  };
}
