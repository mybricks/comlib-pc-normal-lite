import React, { useLayoutEffect, useRef, useState } from 'react';
import context from '../../context';
import * as styles from './AiEditPanel.lazy.less';
import { getLazyCss } from '../../lowcodeView/utils/css';

const css = getLazyCss(styles);
import { AiSendIcon } from './AiSendIcon';

type EditMode = 'IMG' | 'SVG';

const MODE_CONFIG: Record<
  EditMode,
  { presets: string[]; placeholder: string; messagePrefix: string }
> = {
  SVG: {
    presets: ['线条风格', '填充风格', '扁平设计', '单色图标'],
    placeholder: '描述你想要的图标，如 蓝色搜索图标',
    messagePrefix: '调用图标生成工具，生成图标，用户需求：',
  },
  IMG: {
    presets: ['写实风格', '插画风格', '产品海报', '高饱和配色'],
    placeholder: '描述你想要的图片，如 夏日冲浪海报 ',
    messagePrefix: '调用图片生成工具，生成图片，用户需求：',
  },
};

export function AiEditPanel({ close, mode }: { close: () => void; mode: EditMode }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modeConfig = MODE_CONFIG[mode];
  const canSubmit = Boolean(value.trim());

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [value]);

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
        message: `${modeConfig.messagePrefix}${content}`,
        attachments: [],
      });
      console.log('[AiEditPanel] request result:', result);
      if (result && typeof result.then === 'function') {
        result.then(
          (r: any) => console.log('[AiEditPanel] request resolved:', r),
          (e: any) => console.error('[AiEditPanel] request rejected:', e),
        );
      }
    } catch (e) {
      console.error('[AiEditPanel] request threw:', e);
    }
    setValue('');
    close();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    handleSubmit();
  };

  return (
    <div className={css.panel}>
      <div className={css.inputWrap}>
        <textarea
          ref={textareaRef}
          value={value}
          placeholder={modeConfig.placeholder}
          rows={1}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className={css.textarea}
        />
        <button
          type="button"
          onClick={handleSubmit}
          className={css.sendButton}
          aria-label="发送"
          disabled={!canSubmit}
        >
          <AiSendIcon disabled={!canSubmit} />
        </button>
      </div>
      <div className={css.presetWrap}>
        {modeConfig.presets.map(preset => (
          <button
            key={preset}
            type="button"
            onClick={() => appendPreset(preset)}
            className={css.presetButton}
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}
