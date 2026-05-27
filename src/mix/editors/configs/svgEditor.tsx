import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { genSvgReplacer, applyRawSvg, scanIconsFromDOM, registerSvgAppliedCallback } from '../styleProxy';
import context from '../../context';

// ─── SvgPreview ──────────────────────────────────────────────────────────────

function SvgPreview({ editConfig }: { editConfig: any }) {
  const svgEl: Element | null = editConfig.editConfig.ele ?? null;
  const [svgHtml, setSvgHtml] = useState(svgEl?.outerHTML ?? '');

  useEffect(() => {
    // 平台替换 SVG 后不会重新 render 编辑面板，editConfig.ele 始终是旧引用。
    // 通过 applyRawSvg 成功后触发的回调，把新 rawSvg 直接推给预览。
    registerSvgAppliedCallback((rawSvg: string) => setSvgHtml(rawSvg));
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
        background: 'var(--mybricks-bg-2, #f5f5f5)',
        borderRadius: 4,
        overflow: 'hidden',
        minHeight: 60,
      }}
    >
      <div
        style={{ display: 'inline-flex', maxWidth: '100%', maxHeight: 80 }}
        dangerouslySetInnerHTML={{ __html: svgHtml }}
      />
    </div>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

const SVG_PRESETS = ['线条风格', '填充风格', '扁平设计', '单色图标'];

function EmptyState({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('');

  const appendPreset = (preset: string) => {
    setValue(prev => {
      const trimmed = prev.trim();
      return trimmed ? `${trimmed}，${preset}` : preset;
    });
  };

  const handleSubmit = () => {
    const content = value.trim();
    if (!content) return;
    const plugins = (context as any).plugins as any;
    const aiService = plugins?.aiService;
    // 先打开对话框，再发请求
    plugins?.showAIDialog?.();
    try {
      const result = aiService?.request({
        message: `调用图标生成工具，生成图标，用户需求：${content}`,
        attachments: [],
      });
      if (result && typeof result.then === 'function') {
        result.then(
          (r: any) => console.log('[svgEditor] request resolved:', r),
          (e: any) => console.error('[svgEditor] request rejected:', e),
        );
      }
    } catch (e) {
      console.error('[svgEditor] AI request threw:', e);
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div style={{ padding: 12 }}>
      <div
        style={{
          padding: 8,
          border: '1px solid #e5e7ef',
          borderRadius: 8,
          background: '#fff',
          boxShadow: '0 1px 2px rgba(17,24,39,0.04)',
          marginBottom: 8,
        }}
      >
        <textarea
          value={value}
          placeholder="描述你想要的图标库，如「简约风格的电商图标库」"
          rows={2}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            width: '100%',
            padding: 0,
            minHeight: 40,
            border: 'none',
            outline: 'none',
            resize: 'none',
            color: '#1f2430',
            fontSize: 13,
            lineHeight: '20px',
            background: 'transparent',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {SVG_PRESETS.map(preset => (
          <button
            key={preset}
            type="button"
            onClick={() => appendPreset(preset)}
            style={{
              height: 26,
              padding: '0 8px',
              border: '1px solid #e5e7ef',
              borderRadius: 6,
              background: '#fafbff',
              color: '#3f4656',
              fontSize: 12,
              lineHeight: '24px',
              cursor: 'pointer',
            }}
          >
            {preset}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={handleSubmit}
          style={{
            height: 26,
            minWidth: 48,
            padding: '0 12px',
            border: 'none',
            borderRadius: 6,
            background: 'var(--mybricks-color-primary)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          确定
        </button>
      </div>
    </div>
  );
}

// ─── IconItem ─────────────────────────────────────────────────────────────────

function IconItem({ icon, params, onClose }: { icon: { name: string; svg: string }; params: any; onClose: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      title={icon.name}
      onClick={() => { applyRawSvg(params, icon.svg); onClose(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '10px 4px',
        background: hovered ? 'var(--mybricks-bg-2, #f5f5f5)' : 'transparent',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        width: '100%',
      }}
    >
      <div
        style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}
        dangerouslySetInnerHTML={{ __html: icon.svg }}
      />
      <span
        style={{
          fontSize: 10,
          color: 'var(--mybricks-font-color, #333)',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {icon.name}
      </span>
    </button>
  );
}

// ─── IconLibraryPicker ────────────────────────────────────────────────────────

function calcPickerPos(triggerEl: HTMLElement, panelWidth: number) {
  const rect = triggerEl.getBoundingClientRect();
  let left = rect.left;
  if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;
  return { top: rect.bottom + 10, left };
}

function IconLibraryPicker({ params, triggerEl, onClose }: { params: any; triggerEl: HTMLElement; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const PANEL_WIDTH = 260;
  const [pos, setPos] = useState(() => calcPickerPos(triggerEl, PANEL_WIDTH));
  const icons = scanIconsFromDOM();

  useEffect(() => {
    const reposition = () => setPos(calcPickerPos(triggerEl, PANEL_WIDTH));
    window.addEventListener('scroll', reposition, true);
    return () => window.removeEventListener('scroll', reposition, true);
  }, [triggerEl]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && e.target !== triggerEl) {
        onClose();
      }
    };
    // 延迟注册，避免触发按钮的当前点击事件立即关闭
    const timer = setTimeout(() => document.addEventListener('click', handleClickOutside, true), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside, true);
    };
  }, [onClose, triggerEl]);

  return (
    <div ref={panelRef} style={{ position: 'fixed', zIndex: 9999, top: pos.top, left: pos.left }}>
      {/* 小箭头 */}
      <div
        style={{
          width: 0,
          height: 0,
          borderLeft: '7px solid transparent',
          borderRight: '7px solid transparent',
          borderBottom: '7px solid var(--mybricks-bg-1, #fff)',
          marginLeft: 16,
          filter: 'drop-shadow(0 -2px 2px rgba(0,0,0,0.08))',
        }}
      />
      {/* 内容面板 */}
      <div
        style={{
          background: 'var(--mybricks-bg-1, #fff)',
          borderRadius: 8,
          width: PANEL_WIDTH,
          maxHeight: 360,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.07)',
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: '12px 12px 10px',
            borderBottom: '1px solid var(--mybricks-border-color, #f0f0f0)',
            textAlign: 'center',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--mybricks-font-color, #333)' }}>
            {icons.length === 0 ? '当前无图标，请先AI生成图标库' : '从已生成图标库中选择'}
          </span>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {icons.length === 0 ? (
            <EmptyState onClose={onClose} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', padding: '10px 12px 12px' }}>
              {icons.map(icon => (
                <IconItem key={icon.name} icon={icon} params={params} onClose={onClose} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SvgEditorPanel ───────────────────────────────────────────────────────────

const svgReplacer = genSvgReplacer();

function SvgEditorPanel({ editConfig, comId }: { editConfig: any; comId: string }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
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
          ref={triggerRef}
          type="button"
          style={{ ...btnStyle, gap: 4 }}
          onClick={() => setPickerOpen(v => !v)}
        >
          从图标库选择
          <svg
            data-mybricks-tip="让 AI 生成一个图标展示页，页面中的图标会自动出现在图标库中"
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
      {pickerOpen && triggerRef.current && createPortal(
        <IconLibraryPicker
          params={syntheticParams}
          triggerEl={triggerRef.current}
          onClose={() => setPickerOpen(false)}
        />,
        document.body,
      )}
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
