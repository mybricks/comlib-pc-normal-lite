type LessObject = Record<string, any>;

type ResolvedLessRuleParams = {
  rawSelector: string;
  fullSelector: string;
  eleClassList: string[];
  nestedCandidate: {
    container: LessObject;
    key: string;
    score: number;
    branch?: string;
  } | undefined;
  lessValue: Record<string, any>;
  explicitClearPatch?: { writes: Record<string, string>; deletions: string[] } | null;
};

/** 仅供 freeform：复用原源码定位工具，直接应用编辑器给出的最终声明。 */
export function createResolvedLessRulePatcher({
  resolveTargetKey, getNestedSelectorMatchScore, absorbOrphans,
  splitTopLevelCommaKeys, splitCommaMergedTopLevelRuleForWrite,
}: {
  resolveTargetKey(params: Pick<ResolvedLessRuleParams, 'rawSelector' | 'fullSelector' | 'eleClassList'> & { cssObj: LessObject }): string;
  getNestedSelectorMatchScore(fullSelector: string, candidate: string): number;
  absorbOrphans(cssObj: LessObject, targetKey: string): void;
  splitTopLevelCommaKeys(key: string): string[];
  splitCommaMergedTopLevelRuleForWrite(cssObj: LessObject, targetKey: string, fullSelector: string): string;
}) {
  return function patchResolvedLessRule(cssObj: LessObject, params: ResolvedLessRuleParams) {
    const { rawSelector, fullSelector, eleClassList, nestedCandidate, lessValue, explicitClearPatch } = params;
    const targetKey = resolveTargetKey({ cssObj, fullSelector, eleClassList, rawSelector });
    const topLevelTarget = cssObj[targetKey] && typeof cssObj[targetKey] === 'object'
      ? cssObj[targetKey] as Record<string, any>
      : undefined;
    const nestedCandidateStyle = nestedCandidate
      ? nestedCandidate.container[nestedCandidate.key] as Record<string, any> | undefined
      : undefined;
    const topLevelDeclarations = topLevelTarget
      ? Object.keys(topLevelTarget).filter(key => typeof topLevelTarget[key] !== 'object')
      : [];
    const isLikelyNestedOrphan = !!nestedCandidateStyle && !!topLevelTarget &&
      topLevelDeclarations.length > 0 &&
      topLevelDeclarations.length === Object.keys(topLevelTarget).length &&
      topLevelDeclarations.every(key => nestedCandidateStyle[key] !== undefined);
    const nestedTarget = nestedCandidate && (
      !topLevelTarget ||
      nestedCandidate.score > getNestedSelectorMatchScore(fullSelector, targetKey) ||
      isLikelyNestedOrphan
    )
      ? nestedCandidate
      : undefined;
    const targetContainer = nestedTarget?.container ?? cssObj;
    let resolvedTargetKey = nestedTarget?.key ?? targetKey;

    // 清理旧逻辑已经追加到文件末尾、并覆盖嵌套规则同名声明的重复短规则。
    if (!explicitClearPatch && nestedTarget && isLikelyNestedOrphan) {
      delete cssObj[targetKey];
    }

    // 若 targetKey 是独立单类（如 ".cyan"），清除 cssObj 中可能残留的旧版复合选择器键。
    // 例：历史写入产生了 ".topFeatureItem.cyan" 或 ".topFeatureItem.pages_xxx--cyan"，
    // 它们的 CSS 优先级（0,2,0）高于 ".cyan"（0,1,0），会覆盖新写入的规则。
    if (!explicitClearPatch && !nestedTarget && /^\.[\w-]+$/.test(targetKey)) {
      const targetClass = targetKey.slice(1);
      Object.keys(cssObj).forEach(key => {
        if (key === targetKey) return;
        const keyLastSeg = (key.trim().split(/\s+/).pop() || '');
        const keyClasses = (keyLastSeg.match(/\.([^.#[:]+)/g) ?? []).map(c => c.slice(1));
        if (keyClasses.length < 2) return; // 非复合类选择器，不处理
        // 将哈希类名还原为原始类名（pages_xxx--cyan → cyan）
        const normalizedClasses = keyClasses.map(c => {
          const ddIdx = c.lastIndexOf('--');
          return ddIdx > 0 ? c.slice(ddIdx + 2) : c;
        });
        if (normalizedClasses.includes(targetClass)) {
          delete cssObj[key];
        }
      });
    }

    if (!explicitClearPatch && !nestedTarget) {
      absorbOrphans(cssObj, targetKey);
    }

    // 嵌套逗号规则也要拆分后只修改当前分支，且拆分发生在原 at-rule/父规则容器内。
    if (nestedTarget?.branch && nestedTarget.key !== nestedTarget.branch) {
      const sharedStyle = targetContainer[nestedTarget.key];
      if (sharedStyle && typeof sharedStyle === 'object' && !Array.isArray(sharedStyle)) {
        splitTopLevelCommaKeys(nestedTarget.key).forEach(branchKey => {
          const existing = targetContainer[branchKey];
          targetContainer[branchKey] = existing && typeof existing === 'object' && !Array.isArray(existing)
            ? { ...sharedStyle, ...existing }
            : { ...sharedStyle };
        });
        delete targetContainer[nestedTarget.key];
        resolvedTargetKey = nestedTarget.branch;
      }
    }

    // 顶层逗号规则与嵌套规则采用相同的隔离语义：各分支继承原共享声明，
    // 本次变更只落到面板当前选中的唯一分支。
    if (!nestedTarget) {
      resolvedTargetKey = splitCommaMergedTopLevelRuleForWrite(
        cssObj,
        resolvedTargetKey,
        fullSelector,
      );
    }

    if (explicitClearPatch && resolvedTargetKey.includes(',')) {
      console.warn('[style-proxy][style-clear-skip]', {
        selector: rawSelector,
        reason: 'ambiguous-comma-selector',
      });
      return;
    }

    if (!targetContainer[resolvedTargetKey]) {
      targetContainer[resolvedTargetKey] = {};
    }
    const targetStyle = targetContainer[resolvedTargetKey] as Record<string, any>;

    Object.assign(targetStyle, lessValue);
    return { targetKey, targetContainer, resolvedTargetKey, targetStyle, explicitClearDidMutate: false };
  };
}
