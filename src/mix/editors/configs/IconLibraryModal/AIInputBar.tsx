import React, { useState, useRef, useLayoutEffect } from 'react';
import { AiSendIcon } from '../../components/AiSendIcon';
import styles from './style.less';

const SVG_PRESETS = ['线条风格', '填充风格', '扁平设计', '单色图标'];

export default function AIInputBar({
  onGenerate,
  placeholder = '描述你想要的图标库，如「简约风格的电商图标库」',
}: {
  onGenerate: (content: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');
  const canSubmit = Boolean(value.trim());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
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
    onGenerate(content);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      <div className={styles.inputWrap}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={value}
          placeholder={placeholder}
          rows={1}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={styles.sendButton}
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-label="生成图标库"
        >
          <AiSendIcon disabled={!canSubmit} size={19} />
        </button>
      </div>
      <div className={styles.presetWrap}>
        {SVG_PRESETS.map(preset => (
          <button
            key={preset}
            type="button"
            className={styles.presetButton}
            onClick={() => appendPreset(preset)}
          >
            {preset}
          </button>
        ))}
      </div>
    </>
  );
}
