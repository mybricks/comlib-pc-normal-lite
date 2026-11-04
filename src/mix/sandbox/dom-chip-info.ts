/** 画布标识只描述节点归属，不扩大选区任务的处理范围。 */
export function formatDomCanvasInfo(element: Element): string | undefined {
  const canvasTag = element.closest('[data-canvas-tag]')?.getAttribute('data-canvas-tag');
  if (!canvasTag) return undefined;

  const type = canvasTag.startsWith('page:')
    ? '页面画布'
    : canvasTag.startsWith('popup:')
      ? '浮层画布'
      : undefined;
  if (!type) return undefined;

  return [
    '  - 所属画布：',
    `    - 类型：${type}`,
    `    - 标识：${canvasTag}`,
  ].join('\n');
}
