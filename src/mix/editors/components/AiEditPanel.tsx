import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
    presets: [],
    placeholder: '描述你想要的图片，如 夏日冲浪海报 ',
    messagePrefix: '调用图片生成工具，生成图片，用户需求：',
  },
};

type ToolbarKey = 'model' | 'style' | 'ratio' | 'quality';

const TOOLBAR_CONFIG: Array<{ key: ToolbarKey; label: string; options: string[] }> = [
  { key: 'model', label: '模型', options: ['banana', 'gpt-image-2'] },
  { key: 'style', label: '风格', options: ['通用', '写实摄影', '插画', '产品海报', '扁平设计', '高饱和配色'] },
  { key: 'ratio', label: '比例', options: ['1:1', '4:3', '16:9', '9:16', '3:4'] },
  { key: 'quality', label: '画质', options: ['标清', '高清', '超清'] },
];

const DEFAULT_SELECTIONS: Record<ToolbarKey, string> = {
  model: 'banana',
  style: '通用',
  ratio: '1:1',
  quality: '高清',
};

function ChevronIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
      <path
        d="M2 3.5L4.5 6L7 3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AiEditPanel({ close, mode }: { close: () => void; mode: EditMode }) {
  const [value, setValue] = useState('');
  const [selections, setSelections] = useState<Record<ToolbarKey, string>>(DEFAULT_SELECTIONS);
  const [openDropdown, setOpenDropdown] = useState<ToolbarKey | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dropdownRefs = useRef<Partial<Record<ToolbarKey, HTMLDivElement>>>({});
  const modeConfig = MODE_CONFIG[mode];
  const canSubmit = Boolean(value.trim());

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [value]);

  useEffect(() => {
    if (!openDropdown) return;
    const handler = (e: MouseEvent) => {
      const el = dropdownRefs.current[openDropdown];
      if (el && el.contains(e.target as Node)) return;
      setOpenDropdown(null);
    };
    // 捕获阶段，确保弹窗内部点击也能触发（绕过框架的 stopPropagation）
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [openDropdown]);

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

    let extras = '';
    if (mode === 'IMG') {
      const { model, style, ratio, quality } = selections;
      extras += `，模型：${model}`;
      if (style !== DEFAULT_SELECTIONS.style) extras += `，风格：${style}`;
      if (ratio !== DEFAULT_SELECTIONS.ratio) extras += `，比例：${ratio}`;
      if (quality !== DEFAULT_SELECTIONS.quality) extras += `，画质：${quality}`;
    }

    plugins?.showAIDialog?.();
    try {
      const result = aiService?.request({
        message: `${modeConfig.messagePrefix}${content}${extras}`,
        mentionFocus: true,
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
    if (event.shiftKey) return;
    event.preventDefault();
    handleSubmit();
  };

  return (
    <div className={css.panel} ref={panelRef}>
      <div className={css.inputWrap}>
        <div className={css.textareaRow}>
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

        {mode === 'IMG' && (
          <div className={css.toolbar}>
            {TOOLBAR_CONFIG.map(({ key, label, options }, idx) => {
              const isOpen = openDropdown === key;
              const selected = selections[key];
              const isActive = selected !== DEFAULT_SELECTIONS[key];
              return (
                <React.Fragment key={key}>
                  {idx > 0 && <span className={css.toolbarSep} />}
                  <div
                    key={key}
                    className={css.dropdownWrap}
                    ref={el => { dropdownRefs.current[key] = el || undefined; }}
                  >
                  <button
                    type="button"
                    className={`${css.dropdownTrigger}${isActive ? ` ${css.dropdownTriggerActive}` : ''}`}
                    onClick={() => setOpenDropdown(isOpen ? null : key)}
                  >
                    <span className={css.dropdownValue}>{selected}</span>
                    <span
                      className={`${css.dropdownChevron}${isOpen ? ` ${css.dropdownChevronOpen}` : ''}`}
                    >
                      <ChevronIcon />
                    </span>
                  </button>
                  {isOpen && (
                    <div className={css.dropdownMenu}>
                      <div className={css.dropdownMenuTitle}>{label}</div>
                      {options.map(opt => (
                        <button
                          key={opt}
                          type="button"
                          className={`${css.dropdownItem}${opt === selected ? ` ${css.dropdownItemActive}` : ''}`}
                          onClick={() => {
                            setSelections(prev => ({ ...prev, [key]: opt }));
                            setOpenDropdown(null);
                          }}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {mode === 'SVG' && modeConfig.presets.length > 0 && (
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
      )}
    </div>
  );
}
