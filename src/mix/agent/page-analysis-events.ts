/**
 * React 事件中对页面语义帮助有限、但容易造成审计噪声的事件。
 *
 * 新增事件时只维护这里；Babel 分析器和 local-iframe 中间件应使用同一份规则。
 */
export const PAGE_ANALYSIS_EVENT_BLACKLIST = [
  'onPointerEnterCapture',
  'onPointerLeaveCapture',
] as const;

const pageAnalysisEventBlacklist = new Set<string>(PAGE_ANALYSIS_EVENT_BLACKLIST);

export function isPageAnalysisEventBlacklisted(eventName: string): boolean {
  return pageAnalysisEventBlacklist.has(eventName);
}
