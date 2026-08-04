import React, { useState, useEffect } from 'react';
import { genSvgReplacer, registerSvgAppliedCallback, applyRawSvg, patchSvgSizeInTsx } from '../../styleProxy';
import IconLibraryModal from '../IconLibraryModal';
import { SizeEditor } from '../SizeEditor';
import * as styles from './style.lazy.less';
import { getLazyCss } from '../../../lowcodeView/utils/css';

const css = getLazyCss(styles);

// ─── helpers ──────────────────────────────────────────────────────────────────

function normalizeSvgSize(svgHtml: string, size = 48): string {
  return svgHtml
    .replace(/(<svg\b[^>]*?)\s+width="[^"]*"/i, '$1')
    .replace(/(<svg\b[^>]*?)\s+height="[^"]*"/i, '$1')
    .replace(/(<svg\b)/i, `$1 width="${size}" height="${size}"`);
}

function getSvgComputedColor(el: Element | null): string | undefined {
  if (!el) return undefined;
  const style = window.getComputedStyle(el);
  const fill = style.getPropertyValue('fill');
  if (fill && fill !== 'none' && fill !== 'auto' && !fill.startsWith('url')) return fill;
  return style.getPropertyValue('color') || undefined;
}

/** 从 SVG HTML 字符串或 DOM 元素读取 width/height */
function readSvgSize(svgHtml: string, el: SVGElement | null): { w: number; h: number } {
  // 优先从 HTML 属性字符串解析
  const wMatch = svgHtml.match(/\bwidth="([^"]+)"/);
  const hMatch = svgHtml.match(/\bheight="([^"]+)"/);
  const wAttr = parseFloat(wMatch?.[1] ?? '');
  const hAttr = parseFloat(hMatch?.[1] ?? '');
  if (!isNaN(wAttr) && wAttr > 0 && !isNaN(hAttr) && hAttr > 0) {
    return { w: wAttr, h: hAttr };
  }
  // fallback 1：offsetWidth/offsetHeight（Shadow DOM 内可读）
  if (el) {
    const ow = (el as unknown as HTMLElement).offsetWidth;
    const oh = (el as unknown as HTMLElement).offsetHeight;
    if (ow > 0 && oh > 0) return { w: ow, h: oh };
  }
  // fallback 2：getBoundingClientRect
  if (el) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { w: rect.width, h: rect.height };
    }
  }
  return { w: 0, h: 0 };
}

// ─── SvgPreview ───────────────────────────────────────────────────────────────

function SvgPreview({ svgHtml, color }: { svgHtml: string; color: string | undefined }) {
  if (!svgHtml) return null;
  return (
    <div className={css.preview}>
      <div
        className={css.previewInner}
        style={{ color }}
        dangerouslySetInnerHTML={{ __html: normalizeSvgSize(svgHtml) }}
      />
    </div>
  );
}

// ─── SvgEditorPanel ──────────────────────────────────────────────────────────

const svgReplacer = genSvgReplacer();

function SvgEditorPanel({ editConfig, comId }: { editConfig: any; comId: string }) {
  const svgEle = editConfig.editConfig?.ele as SVGElement | null;
  // 存在代码标注，则代表 svg 是真实存在代码里的，否则可能是引入的三方库
  const isSvgElement = !!svgEle?.dataset.loc;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [currentSvgHtml, setCurrentSvgHtml] = useState(svgEle?.outerHTML ?? '');
  const [svgColor] = useState<string | undefined>(() => getSvgComputedColor(svgEle));

  useEffect(() => {
    registerSvgAppliedCallback((rawSvg: string) => {
      setCurrentSvgHtml(rawSvg);
    });
    return () => registerSvgAppliedCallback(null);
  }, []);

  const syntheticParams = {
    focusArea: isSvgElement ? svgEle : svgEle?.closest('[data-loc]'),
    id: comId,
  };
  const svgSize = readSvgSize(currentSvgHtml, svgEle);

  return (
    <div className={css.panel}>
      <SvgPreview svgHtml={currentSvgHtml} color={svgColor} />
      {currentSvgHtml && isSvgElement && (
        <SizeEditor
          size={svgSize}
          onCommit={(size) => patchSvgSizeInTsx(syntheticParams, size)}
          svg={currentSvgHtml}
        />
      )}
      <div className={css.btnRow}>
        <button
          type="button"
          className={css.btn}
          onClick={() => setPickerOpen(true)}
        >
          从图标库选择
          <svg
            data-mybricks-tip="从AI生成的图标库中进行选择"
            viewBox="0 0 1024 1024"
            xmlns="http://www.w3.org/2000/svg"
            style={{ width: 13, height: 13, flexShrink: 0, opacity: 0.30, display: 'block' }}
            onClick={e => e.stopPropagation()}
          >
            <path d="M512 64C264.8 64 64 264.8 64 512s200.8 448 448 448 448-200.8 448-448S759.2 64 512 64z m32 704h-64v-64h64v64z m11.2-203.2l-5.6 4.8c-3.2 2.4-5.6 8-5.6 12.8v58.4h-64v-58.4c0-24.8 11.2-48 29.6-63.2l5.6-4.8c56-44.8 83.2-68 83.2-108C598.4 358.4 560 320 512 320c-49.6 0-86.4 36.8-86.4 86.4h-64C361.6 322.4 428 256 512 256c83.2 0 150.4 67.2 150.4 150.4 0 72.8-49.6 112.8-107.2 158.4z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className={css.btn}
          onClick={() => svgReplacer.set(syntheticParams)}
        >
          上传SVG
        </button>
      </div>
      <IconLibraryModal
        visible={pickerOpen}
        params={syntheticParams}
        comId={comId}
        applyFn={applyRawSvg}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

// ─── export ───────────────────────────────────────────────────────────────────

export function buildSvgEditorItems(comId: string) {
  return [
    {
      title: '',
      type: 'editorRender',
      options: {
        render(editConfig: any) {
          return <SvgEditorPanel editConfig={editConfig} comId={comId} />;
        },
      },
    },
  ];
}
