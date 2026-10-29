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
import { getInitialInlineStyleSnapshot, applyInlineStyleSnapshots } from './createSetStyleHandler';
import type { StyleInfoEntry } from './patchJsxInlineStyle';

export type InlineStyleBatch = {
  target: HTMLElement;
  /** 上游已准备好的整文件补丁：Less 中的 CSS 规则，以及 JSX/TSX 中的 style={{ ... }}。 */
  files: Map<string, { previous: string; current: string }>;
  /** 仅包含 inline 节点；path 是其 JSX/TSX 文件，按补丁准备顺序同步 DOM 和源码偏移。 */
  changes: Array<{
    target: HTMLElement;
    path: string;
    style: Record<string, any>;
    replacement: SourceReplacement;
    styleInfo: Record<string, StyleInfoEntry>;
  }>;
};

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

  // 普通单节点 inline：只写 JSX/TSX 中的 style，再由 applyInlinePatch 更新 DOM style，不写 Less。
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

  /**
   * freeform 混合写入，例如父节点写 Less、子节点写 style={{ ... }}；分流和文件补丁已由上游准备。
   * 顺序：写 Less → 若触发热更新则等新 DOM 提交 → 写 JSX/TSX 的 style → 写 DOM style 预览。
   * 整批共用一条历史命令，撤销也按此顺序恢复；不参与普通 inline 的连续输入合并。
   */
  const updateInlineStyleBatchInBranch = ({ target, files, changes }: InlineStyleBatch) => {
    const shadowRoot = getShadowDoc();
    const locations = new Map<string, ReturnType<typeof createDOMSourceLocationSnapshot>>();
    changes.forEach(({ path }) => {
      if (!locations.has(path)) locations.set(path, createDOMSourceLocationSnapshot(shadowRoot, path));
    });
    const snapshots = changes.flatMap(({ target, style }) => Object.entries(style)
      .map(([key, value]) => getInitialInlineStyleSnapshot(target, key, value == null ? '' : String(value))));
    // changes.path 都是写 inline style 的 JSX/TSX 文件；files 中其余补丁就是本批要写的 Less。
    const lessFiles = Array.from(files).filter(([path]) => !locations.has(path));
    const renderFiles = new Set([JSON.parse(target.dataset.loc!).files.jsx, ...Array.from(locations.keys())]);
    const nodePaths = new Map<Element, number[]>();
    const rememberNode = (element: Element) => {
      const path: number[] = [];
      for (let node: Node = element; node !== shadowRoot; node = node.parentNode!) {
        path.unshift(Array.prototype.indexOf.call(node.parentNode!.childNodes, node));
      }
      nodePaths.set(element, path);
    };
    rememberNode(target);
    snapshots.forEach(({ ele }) => rememberNode(ele));
    locations.forEach(snapshot => snapshot.forEach((_, ele) => rememberNode(ele)));
    // 本批只改样式，沿原节点路径关联提交后的 DOM。
    const currentElement = (element: Element) => nodePaths.get(element)!
      .reduce<Node>((node, index) => node.childNodes[index], shadowRoot) as HTMLElement;
    // 运行时仍可能使用旧 TSX，先恢复本批修改前的定位，再应用本批偏移。
    const restoreLocations = () => locations.forEach(snapshot => {
      const currentSnapshot = new Map(Array.from(snapshot, ([ele, value]) => [currentElement(ele), value] as const));
      restoreDOMSourceLocationSnapshot(currentSnapshot);
    });
    let offRendered = () => {};
    const updateLessThenInline = (phase: 'execute' | 'undo', applyInline: () => void) => {
      offRendered();
      if (!lessFiles.length) {
        applyInline();
        return;
      }
      const fileSystem = context.fileSystem!;
      // 先订阅再写 Less：若类名映射变化导致组件重载，等 HotComponent 提交新 DOM 后再写 inline。
      // false 表示不回放历史 rendered 事件，只接续本次更新。
      offRendered = fileSystem.events.on('rendered', ({ filename }) => {
        if (!renderFiles.has(filename)) return;
        offRendered();
        applyInline();
      }, false);
      let refresh = false;
      // ① 写 Less 文件：更新 CSS 规则；execute 写新内容，undo 写回原内容。
      lessFiles.forEach(([path, { current, previous }]) => {
        const before = fileSystem.filesMap[path]?.module.classMap;
        context.updateFile({ fileName: path, content: phase === 'execute' ? current : previous, type: undefined,
          ...(phase === 'undo' ? { updateSource: 'undo' } : {}) });
        const after = fileSystem.filesMap[path].module.classMap;
        if (!before || Object.keys(before).join('') !== Object.keys(after).join('')) refresh = true;
      });
      // classMap 未变时不会重载组件，直接接续现有 inline 写入。
      if (!refresh) {
        offRendered();
        applyInline();
      }
    };
    const actionId = randomUUID();
    endStyleFileBranch();
    pendingInlineStyleBranch = null;
    undoRedoManager.executeBranch({
      execute() {
        updateLessThenInline('execute', () => {
          // ② 写 style 源码：只提交 JSX/TSX 文件，current 已包含上游生成的 style={{ ... }}。
          // noUpdateFileSystem 不触发组件重载，DOM 预览由下面的第 ③ 步直接更新。
          files.forEach(({ current }, path) => {
            if (locations.has(path)) context.updateFile({ fileName: path, content: current, type: undefined, noUpdateFileSystem: true });
          });
          restoreLocations();
          changes.forEach(({ target, path, replacement, styleInfo }) => {
            shiftDOMSourceLocationsAfterReplacement(shadowRoot, path, replacement);
            currentElement(target).dataset.styleInfo = JSON.stringify(styleInfo);
          });
          // ③ 写 DOM style：将内联属性应用到当前节点，让画布立即显示这批 style 修改。
          applyInlineStyleSnapshots(snapshots.map(snapshot => ({ ...snapshot, ele: currentElement(snapshot.ele) })), 'execute');
          const currentTarget = currentElement(target);
          context.component?.actions.addUserAction({ id: actionId, type: 'update-style', title: getStyleActionTitle(currentTarget), refElement: currentTarget });
        });
      },
      undo() {
        // 撤销：先恢复 Less（第 ① 步），完成必要的 DOM 提交后，再恢复下面的 TSX 源码与 DOM style。
        updateLessThenInline('undo', () => {
          // 恢复 JSX/TSX 中原来的 style，不触发组件重载。
          files.forEach(({ previous }, path) => {
            if (locations.has(path)) context.updateFile({ fileName: path, content: previous, type: undefined, noUpdateFileSystem: true, updateSource: 'undo' });
          });
          restoreLocations();
          // 恢复当前 DOM 节点原来的内联样式，使画布预览与撤销后的源码一致。
          applyInlineStyleSnapshots(snapshots.map(snapshot => ({ ...snapshot, ele: currentElement(snapshot.ele) })), 'undo');
          context.component?.actions.removeUserAction(actionId);
        });
      },
    });
  };

  return {
    updateInlineStyleInBranch,
    updateInlineStyleBatchInBranch,
    clearPendingBranch() {
      pendingInlineStyleBranch = null;
    },
  };
}
