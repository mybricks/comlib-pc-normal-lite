import React, { useState, useEffect, useCallback } from 'react';
import context from '../../../context';
import {
  genIconReplacer,
  registerSvgAppliedCallback,
  applyIconWithSvg,
  patchIconSizeInTsx,
  patchSvgSizeInTsx,
  readIconSizeFromJsx,
} from '../../styleProxy';
import IconLibraryModal from '../IconLibraryModal';
import { SizeEditor } from '../SizeEditor';
import * as styles from './style.lazy.less';
import { getLazyCss } from '../../../lowcodeView/utils/css';

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

/** 从三方图标的 DOM 元素读取实际渲染尺寸（多种 fallback） */
function readIconDomSize(ele: Element | null): { w: number; h: number } {
  if (!ele) return { w: 0, h: 0 };

  // 直接读 ele 本身
  const elW = (ele as HTMLElement).offsetWidth;
  const elH = (ele as HTMLElement).offsetHeight;
  if (elW > 0 && elH > 0) return { w: elW, h: elH };

  // 内部 SVG
  const svgEl = ele.querySelector('svg') as HTMLElement | null;
  if (svgEl) {
    const w = svgEl.offsetWidth;
    const h = svgEl.offsetHeight;
    if (w > 0 && h > 0) return { w, h };

    const rect = svgEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { w: rect.width, h: rect.height };
    }
  }

  // ele 的 getBoundingClientRect
  const rect = ele.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { w: rect.width, h: rect.height };
  }

  return { w: 0, h: 0 };
}

/** 从替换后的 SVG HTML 字符串读取 width/height 属性 */
function readSvgHtmlSize(svgHtml: string): { w: number; h: number } {
  const wMatch = svgHtml.match(/\bwidth="([^"]+)"/);
  const hMatch = svgHtml.match(/\bheight="([^"]+)"/);
  const w = parseFloat(wMatch?.[1] ?? '');
  const h = parseFloat(hMatch?.[1] ?? '');
  return !isNaN(w) && w > 0 && !isNaN(h) && h > 0
    ? { w, h }
    : { w: 0, h: 0 };
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
  const currentSvgHtml = replacedSvg ?? (svgEl?.tagName.toLowerCase() === 'svg' ? svgEl.outerHTML : '');

  useEffect(() => {
    registerSvgAppliedCallback((rawSvg: string) => {
      setReplacedSvg(rawSvg);
    });
    return () => registerSvgAppliedCallback(null);
  }, []);

  // 替换为内联 SVG 后从 HTML 字符串读取；否则优先从 JSX 源码读显式尺寸，fallback 到 DOM 测量
  const iconSize = replacedSvg
    ? readSvgHtmlSize(replacedSvg)
    : (() => {
        const jsxSize = readIconSizeFromJsx(syntheticParams);
        return jsxSize.w > 0 ? jsxSize : readIconDomSize(ele);
      })();

  const handleSizeCommit = useCallback(
    (size: { width: number; height: number }) => {
      if (replacedSvg) {
        patchSvgSizeInTsx(syntheticParams, size);
      } else {
        patchIconSizeInTsx(syntheticParams, size);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replacedSvg],
  );

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
          <span className={css.previewEmpty}>{iconName || '无法预览'}</span>
        )}
      </div>

      {/* 尺寸编辑器：三方组件图标不支持非等比变形，禁止解锁宽高比 */}
      <SizeEditor size={iconSize} onCommit={handleSizeCommit} svg={currentSvgHtml} disableLock={!replacedSvg} />

      {/* 操作按钮 */}
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
          onClick={() => iconReplacer.set(syntheticParams)}
        >
          上传SVG
        </button>
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
      title: '',
      type: 'editorRender',
      options: {
        render(editConfig: any) {
          return <IconEditorPanel editConfig={editConfig} comId={comId} />;
        },
      },
    },
  ];
}
