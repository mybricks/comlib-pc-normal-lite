import React, { useState, useEffect } from 'react';
import { genSvgReplacer, registerSvgAppliedCallback } from '../styleProxy';
import IconLibraryModal from './IconLibraryModal';

// ─── SvgPreview ──────────────────────────────────────────────────────────────

/**
 * 部分 SVG 自带 width="0" height="0" 或完全缺失尺寸属性，导致预览不可见。
 * 统一移除原有 width/height，改为固定预览尺寸，同时保留 viewBox 以保证比例。
 */
function normalizeSvgSize(svgHtml: string, size = 48): string {
  return svgHtml
    .replace(/(<svg\b[^>]*?)\s+width="[^"]*"/i, '$1')
    .replace(/(<svg\b[^>]*?)\s+height="[^"]*"/i, '$1')
    .replace(/(<svg\b)/i, `$1 width="${size}" height="${size}"`);
}

/** 从 SVG DOM 元素上读取计算后的颜色，用于预览时还原 currentColor 继承链 */
function getSvgComputedColor(el: Element | null): string | undefined {
  if (!el) return undefined;
  const style = window.getComputedStyle(el);
  // 优先取 fill（SVG 专属），若是 none/auto 等无效值则退回 color
  const fill = style.getPropertyValue('fill');
  if (fill && fill !== 'none' && fill !== 'auto' && !fill.startsWith('url')) {
    return fill;
  }
  const color = style.getPropertyValue('color');
  return color || undefined;
}

function SvgPreview({ editConfig }: { editConfig: any }) {
  const svgEl: Element | null = editConfig.editConfig.ele ?? null;
  const [svgHtml, setSvgHtml] = useState(svgEl?.outerHTML ?? '');
  // 初始颜色从 DOM 读取；替换图标后颜色由新 SVG 自身决定，重置为 undefined
  const [svgColor] = useState<string | undefined>(() => getSvgComputedColor(svgEl));
  const [previewColor, setPreviewColor] = useState<string | undefined>(svgColor);

  useEffect(() => {
    // 平台替换 SVG 后不会重新 render 编辑面板，editConfig.ele 始终是旧引用。
    // 通过 applyRawSvg 成功后触发的回调，把新 rawSvg 直接推给预览。
    registerSvgAppliedCallback((rawSvg: string) => {
      setSvgHtml(rawSvg);
      // 新上传/选择的 SVG 通常已含颜色信息，不再依赖外层 color 继承
      setPreviewColor(undefined);
    });
    return () => registerSvgAppliedCallback(null);
  }, []);

  if (!svgHtml) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 0',
        background: 'repeating-conic-gradient(#e0e0e0 0% 25%, #f8f8f8 0% 50%) 0 0 / 12px 12px',
        borderRadius: 4,
        overflow: 'hidden',
        minHeight: 60,
      }}
    >
      <div
        style={{ display: 'inline-flex', maxWidth: '100%', maxHeight: 80, color: previewColor }}
        dangerouslySetInnerHTML={{ __html: normalizeSvgSize(svgHtml) }}
      />
    </div>
  );
}

// ─── SvgEditorPanel ───────────────────────────────────────────────────────────

const svgReplacer = genSvgReplacer();

function SvgEditorPanel({ editConfig, comId }: { editConfig: any; comId: string }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const syntheticParams = { focusArea: editConfig.editConfig?.ele, id: comId };

  const btnStyle: React.CSSProperties = {
    cursor: 'pointer',
    width: '100%',
    height: 26,
    borderRadius: 6,
    border: '1px solid var(--mybricks-border-color-main)',
    backgroundColor: 'var(--mybricks-bg-color-main)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--mybricks-text-color-main)',
    fontSize: 12,
    padding: 0,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <SvgPreview editConfig={editConfig} />
      <div style={{ display: 'flex', gap: 8, width: '100%', marginTop: 10 }}>
        <button
          type="button"
          style={{ ...btnStyle, gap: 4 }}
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
        <button type="button" style={btnStyle} onClick={() => svgReplacer.set(syntheticParams)}>
          上传SVG
        </button>
      </div>
      <IconLibraryModal
        visible={pickerOpen}
        params={syntheticParams}
        comId={comId}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

// ─── buildSvgEditorItems ──────────────────────────────────────────────────────

export function buildSvgEditorItems(comId: string) {
  return [
    {
      title: '',
      type: 'editorRender',
      options: {
        render(editConfig: any) {
          // editorRender 的 render(editConfig) 没有 params.id / params.focusArea，
          // 用 editConfig.editConfig.ele（聚焦 SVG 元素）+ 外层闭包传入的 comId 手动拼装。
          return <SvgEditorPanel editConfig={editConfig} comId={comId} />;
        },
      },
    },
  ];
}
