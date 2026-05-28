import React, { useState } from 'react';
import context from '../../context';
import styles from './AiEditPanel.less';

type EditMode = 'IMG' | 'SVG';

const MODE_CONFIG: Record<
  EditMode,
  { presets: string[]; placeholder: string; messagePrefix: string }
> = {
  SVG: {
    presets: ['线条风格', '填充风格', '扁平设计', '单色图标'],
    placeholder: '描述你想要的图标，如「蓝色搜索放大镜」',
    messagePrefix: '调用图标生成工具，生成图标，用户需求：',
  },
  IMG: {
    presets: ['写实风格', '插画风格', '产品海报', '高饱和配色'],
    placeholder: '描述你想要的图片，如「夏日海边冲浪海报」',
    messagePrefix: '调用图片生成工具，生成图片，用户需求：',
  },
};

export function AiEditPanel({ close, mode }: { close: () => void; mode: EditMode }) {
  const [value, setValue] = useState('');
  const modeConfig = MODE_CONFIG[mode];

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
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    handleSubmit();
  };

  return (
    <div className={styles.panel}>
      <div className={styles.inputWrap}>
        <textarea
          value={value}
          placeholder={modeConfig.placeholder}
          rows={2}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className={styles.textarea}
        />
      </div>
      <div className={styles.presetWrap}>
        {modeConfig.presets.map(preset => (
          <button
            key={preset}
            type="button"
            onClick={() => appendPreset(preset)}
            className={styles.presetButton}
          >
            {preset}
          </button>
        ))}
      </div>
      <div className={styles.submitWrap}>
        <button
          type="button"
          onClick={handleSubmit}
          className={styles.submitButton}
        >
          确定
        </button>
      </div>
    </div>
  );
}
