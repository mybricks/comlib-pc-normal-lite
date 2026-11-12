import { domInfoI18n as copy } from "../../helpers/dom/dom-info.i18n";

/** 画布标识只描述节点归属，不扩大选区任务的处理范围。 */
export function formatDomCanvasInfo(element: Element): string | undefined {
  const canvasTag = element.closest('[data-canvas-tag]')?.getAttribute('data-canvas-tag');
  if (!canvasTag) return undefined;

  const type = canvasTag.startsWith('page:')
    ? copy.pageCanvas()
    : canvasTag.startsWith('popup:')
      ? copy.popupCanvas()
      : undefined;
  if (!type) return undefined;

  return [
    `  - ${copy.canvas()}`,
    `    - ${copy.canvasType(type)}`,
    `    - ${copy.canvasId(canvasTag)}`,
  ].join('\n');
}
