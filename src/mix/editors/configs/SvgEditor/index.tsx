import React, { useState, useEffect } from 'react';
import { genSvgReplacer, registerSvgAppliedCallback, applyRawSvg } from '../../styleProxy';
import IconLibraryModal from '../IconLibraryModal';
import { DownloadIcon } from '../../icons/ai-img';
import * as styles from './style.lazy.less';
import { getLazyCss } from '../../../lowcodeView/utils/css';
import lang from '../i18n';

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

function downloadSvg(svg: string): void {
  const objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'icon.svg';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
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

  return (
    <div className={css.panel}>
      <SvgPreview svgHtml={currentSvgHtml} color={svgColor} />
      <div className={css.btnRow}>
        <button
          type="button"
          className={css.btn}
          onClick={() => setPickerOpen(true)}
        >
          {lang.selectFromIconLibrary}
          <svg
            data-mybricks-tip={lang.selectFromIconLibraryTip}
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
          {lang.uploadSvg}
        </button>
        {currentSvgHtml && (
          <button
            type="button"
            aria-label={lang.downloadSvg}
            data-mybricks-tip={JSON.stringify({ content: lang.downloadSvg, position: 'left' })}
            onClick={() => downloadSvg(currentSvgHtml)}
            style={{
              flexShrink: 0,
              width: 26,
              height: 26,
              padding: 4,
              boxSizing: 'border-box',
              border: '1px solid var(--mybricks-border-color-main, #ddd)',
              borderRadius: 6,
              backgroundColor: 'var(--mybricks-bg-color-main, #fff)',
              cursor: 'pointer',
            }}
          >
            <DownloadIcon style={{ display: 'block', width: '100%', height: '100%' }} />
          </button>
        )}
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
      title: lang.iconEditorTitle,
      type: 'editorRender',
      options: {
        render(editConfig: any) {
          return <SvgEditorPanel editConfig={editConfig} comId={comId} />;
        },
      },
    },
  ];
}
