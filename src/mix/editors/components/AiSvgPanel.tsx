import React, { useState } from 'react';
import context from '../../context';

const SVG_PRESETS = ['线条风格', '填充风格', '扁平设计', '单色图标'];

export function AiSvgPanel({ close }: { close: () => void }) {
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
    const plugins = context.plugins as any;
    const aiService = plugins?.aiService;
    // 先打开对话框，再发请求
    plugins?.showAIDialog?.();
    try {
      const result = aiService?.request({
        message: `调用图标生成工具，生成图标，用户需求：${content}`,
        attachments: [],
      });
      console.log('[AiSvgPanel] request result:', result);
      if (result && typeof result.then === 'function') {
        result.then(
          (r: any) => console.log('[AiSvgPanel] request resolved:', r),
          (e: any) => console.error('[AiSvgPanel] request rejected:', e),
        );
      }
    } catch (e) {
      console.error('[AiSvgPanel] request threw:', e);
    }
    setValue('');
    close();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    handleSubmit();
  };

  return (
    <div style={{ width: '310px' }}>
      <div
        style={{
          padding: 8,
          border: '1px solid #e5e7ef',
          borderRadius: 8,
          background: '#fff',
          boxShadow: '0 1px 2px rgba(17,24,39,0.04)',
        }}
      >
        <textarea
          value={value}
          placeholder="描述你想要的图标，如「蓝色搜索放大镜」"
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
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
