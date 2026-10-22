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
  splitTopLevelCommaKeys, splitCommaMergedTopLevelRuleForWrite,
}: {
  splitTopLevelCommaKeys(key: string): string[];
  splitCommaMergedTopLevelRuleForWrite(cssObj: LessObject, targetKey: string, fullSelector: string): string;
}) {
  return function patchResolvedLessRule(cssObj: LessObject, params: ResolvedLessRuleParams) {
    const { rawSelector, fullSelector, eleClassList, nestedCandidate, lessValue, explicitClearPatch } = params;
    // freeform 计划已明确实例范围，只复用完整路径相同的规则，不能缩回公共类或吸收其他规则。
    const targetKey = fullSelector;
    const nestedTarget = !cssObj[fullSelector] && nestedCandidate?.score === 4 ? nestedCandidate : undefined;
    const targetContainer = nestedTarget?.container ?? cssObj;
    let resolvedTargetKey = nestedTarget?.key ?? targetKey;

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
