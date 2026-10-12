import React, { useState, useRef, useLayoutEffect } from 'react';
import { AiSendIcon } from '../../components/AiSendIcon';
import * as styleNS from './style.lazy.less';
import { getLazyCss } from '../../../lowcodeView/utils/css';
import lang from '../i18n';

const css = getLazyCss(styleNS);

const SVG_PRESETS = [lang.svgPresetLine, lang.svgPresetFill, lang.svgPresetFlat, lang.svgPresetMono];

export default function AIInputBar({
  onGenerate,
  placeholder = lang.aiInputBarDefaultPlaceholder,
  showPresets = true,
}: {
  onGenerate: (content: string) => void;
  placeholder?: string;
  showPresets?: boolean;
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
      <div className={css.inputWrap}>
        <textarea
          ref={textareaRef}
          className={css.textarea}
          value={value}
          placeholder={placeholder}
          rows={1}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={css.sendButton}
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-label={lang.generateIconLibrary}
        >
          <AiSendIcon disabled={!canSubmit} size={19} />
        </button>
      </div>
      {showPresets && (
        <div className={css.presetWrap}>
          {SVG_PRESETS.map(preset => (
            <button
              key={preset}
              type="button"
              className={css.presetButton}
              onClick={() => appendPreset(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
