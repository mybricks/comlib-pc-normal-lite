import React, { useState, useEffect } from 'react';
import context from '../../../context';
import {
  genIconReplacer,
  registerSvgAppliedCallback,
  applyIconWithSvg,
} from '../../styleProxy';
import IconLibraryModal from '../IconLibraryModal';
import { DownloadIcon, UploadIcon } from '../../icons/ai-img';
import * as styles from './style.lazy.less';
import { getLazyCss } from '../../../lowcodeView/utils/css';
import lang from '../i18n';

const css = getLazyCss(styles);

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

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

// ─── IconEditorPanel ──────────────────────────────────────────────────────────

const iconReplacer = genIconReplacer();

function IconEditorPanel({ editConfig, comId }: { editConfig: any; comId: string }) {
  const ele: Element | null = editConfig.editConfig?.ele ?? null;

  const iconName = ele?.getAttribute('data-zone-icon') ?? '';
  const libSource = ele?.getAttribute('data-library-source') ?? '';

  const syntheticParams = { focusArea: ele, id: comId };

  const IconComp: React.ComponentType<any> | undefined =
    context?.iconRegistry?.get(libSource)?.get(iconName);

  const svgEl = ele?.querySelector('svg') ?? ele;
  const color = getSvgComputedColor(svgEl);

  const [replacedSvg, setReplacedSvg] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const currentSvgHtml = replacedSvg ?? (svgEl?.tagName.toLowerCase() === 'svg' ? svgEl.outerHTML : (ele?.querySelector('svg')?.outerHTML ?? ''));

  useEffect(() => {
    registerSvgAppliedCallback((rawSvg: string) => {
      setReplacedSvg(rawSvg);
    });
    return () => registerSvgAppliedCallback(null);
  }, []);

  return (
    <div className={css.panel}>
      {/* 图标预览 */}
      <div className={css.preview}>
        {replacedSvg ? (
          <div
            className={css.previewInner}
            dangerouslySetInnerHTML={{ __html: normalizeSvgSize(replacedSvg) }}
          />
        ) : IconComp ? (
          React.createElement(IconComp, { style: { fontSize: 48, color } })
        ) : (
          <span className={css.previewEmpty}>{iconName || lang.noPreviewAvailable}</span>
        )}
      </div>

      {/* 操作按钮 */}
      <div className={css.btnRow}>
        <button
          type="button"
          className={css.btn}
          data-mybricks-tip={lang.selectFromIconLibraryTip}
          onClick={() => setPickerOpen(true)}
        >
          {lang.selectFromIconLibrary}
        </button>
        <button
          type="button"
          aria-label={lang.uploadSvg}
          data-mybricks-tip={JSON.stringify({ content: lang.uploadSvg, position: 'left' })}
          onClick={() => iconReplacer.set(syntheticParams)}
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
          <UploadIcon style={{ display: 'block', width: '100%', height: '100%' }} />
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
        applyFn={applyIconWithSvg}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

// ─── export ───────────────────────────────────────────────────────────────────

export function buildIconEditorItems(comId: string) {
  return [
    {
      title: lang.iconEditorTitle,
      type: 'editorRender',
      options: {
        render(editConfig: any) {
          return <IconEditorPanel editConfig={editConfig} comId={comId} />;
        },
      },
    },
  ];
}
