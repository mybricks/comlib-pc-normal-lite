import React, { useState, useEffect } from 'react';
import { genSvgReplacer, registerSvgAppliedCallback, applyRawSvg } from '../../styleProxy';
import IconLibraryModal from '../IconLibraryModal';
import * as styles from './style.lazy.less';
import { getLazyCss } from '../../../lowcodeView/utils/css';

const css = getLazyCss(styles);

// ─── SvgPreview ───────────────────────────────────────────────────────────────

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

function SvgPreview({ editConfig }: { editConfig: any }) {
  const svgEl: Element | null = editConfig.editConfig.ele ?? null;
  const [svgHtml, setSvgHtml] = useState(svgEl?.outerHTML ?? '');
  const [svgColor] = useState<string | undefined>(() => getSvgComputedColor(svgEl));
  const [previewColor, setPreviewColor] = useState<string | undefined>(svgColor);

  useEffect(() => {
    registerSvgAppliedCallback((rawSvg: string) => {
      setSvgHtml(rawSvg);
      setPreviewColor(undefined);
    });
    return () => registerSvgAppliedCallback(null);
  }, []);

  if (!svgHtml) return null;

  return (
    <div className={css.preview}>
      <div
        className={css.previewInner}
        style={{ color: previewColor }}
        dangerouslySetInnerHTML={{ __html: normalizeSvgSize(svgHtml) }}
      />
    </div>
  );
}

// ─── SvgEditorPanel ──────────────────────────────────────────────────────────

const svgReplacer = genSvgReplacer();

function SvgEditorPanel({ editConfig, comId }: { editConfig: any; comId: string }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const syntheticParams = { focusArea: editConfig.editConfig?.ele, id: comId };

  return (
    <div className={css.panel}>
      <SvgPreview editConfig={editConfig} />
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
