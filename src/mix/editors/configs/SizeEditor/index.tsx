import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AspectRadiolock } from '../../icons/aspect-radio-lock';
import { AspectRadioUnlock } from '../../icons/aspect-radio-unlock';
import * as styles from './style.lazy.less';
import { getLazyCss } from '../../../lowcodeView/utils/css';
import { useDragLabel } from '../hooks/useDragLabel';

const css = getLazyCss(styles);

// ─── SizeField ────────────────────────────────────────────────────────────────

function SizeField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(value > 0 ? String(value) : '');
  const [focused, setFocused] = useState(false);

  const getValue = useCallback(() => value, [value]);
  const dragLabelProps = useDragLabel(getValue, onCommit);

  useEffect(() => {
    if (!focused) setDraft(value > 0 ? String(value) : '');
  }, [value, focused]);

  const tryCommit = () => {
    const n = parseFloat(draft);
    if (!isNaN(n) && n > 0) onCommit(n);
    else setDraft(String(value));
  };

  return (
    <>
      <span className={css.sizeLabel} {...dragLabelProps}>{label}</span>
      <input
        className={css.sizeField}
        type="text"
        inputMode="decimal"
        pattern="[0-9]*[.]?[0-9]*"
        value={draft}
        onChange={e => {
          // 中文输入法或部分数字键盘会输入全角句点/逗号，统一为小数点。
          const nextDraft = e.target.value.replace(/[，。]/g, '.');
          if (/^\d*\.?\d*$/.test(nextDraft)) setDraft(nextDraft);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          tryCommit();
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </>
  );
}

// ─── SizeEditor ───────────────────────────────────────────────────────────────

function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface SizeEditorProps {
  size: { w: number; h: number };
  onCommit: (size: { width: number; height: number }) => void;
  /** 禁止解锁宽高比（如三方库图标），始终锁定且不可点击 */
  disableLock?: boolean;
}

export function SizeEditor({ size: initialSize, onCommit, disableLock = false }: SizeEditorProps) {
  const [w, setW] = useState(initialSize.w);
  const [h, setH] = useState(initialSize.h);
  const [locked, setLocked] = useState(true);
  const ratioRef = useRef<number>(
    initialSize.h > 0 && initialSize.w > 0 ? initialSize.h / initialSize.w : 1,
  );

  useEffect(() => {
    setW(initialSize.w);
    setH(initialSize.h);
    if (initialSize.w > 0 && initialSize.h > 0) {
      ratioRef.current = initialSize.h / initialSize.w;
    }
  }, [initialSize.w, initialSize.h]);

  const commit = useCallback(
    (newW: number, newH: number) => {
      if (newW > 0 && newH > 0) {
        onCommit({ width: newW, height: newH });
        ratioRef.current = newH / newW;
      }
    },
    [onCommit],
  );

  const handleWCommit = useCallback(
    (val: number) => {
      const newW = Math.max(1, val);
      if (locked && ratioRef.current > 0) {
        const newH = Math.max(1, roundToTwoDecimals(newW * ratioRef.current));
        setW(newW);
        setH(newH);
        commit(newW, newH);
      } else {
        setW(newW);
        commit(newW, h);
      }
    },
    [locked, h, commit],
  );

  const handleHCommit = useCallback(
    (val: number) => {
      const newH = Math.max(1, val);
      if (locked && ratioRef.current > 0) {
        const newW = Math.max(1, roundToTwoDecimals(newH / ratioRef.current));
        setW(newW);
        setH(newH);
        commit(newW, newH);
      } else {
        setH(newH);
        commit(w, newH);
      }
    },
    [locked, w, commit],
  );

  return (
    <div className={css.sizeRow}>
      <div className={css.sizeInput}>
        <SizeField label="宽度" value={w} onCommit={handleWCommit} />
      </div>

      {locked && <span className={css.linkDot} />}

      <div className={css.sizeInput}>
        <SizeField label="高度" value={h} onCommit={handleHCommit} />
      </div>

      <button
        type="button"
        className={`${css.lockBtn} ${locked ? css.lockBtnActive : ''} ${disableLock ? css.lockBtnDisabled : ''}`}
        data-mybricks-tip={JSON.stringify({ content: disableLock ? '三方库组件图标不允许修改宽高比' : locked ? '解锁宽高比' : '锁定宽高比', position: 'left' })}
        onClick={() => { if (!disableLock) setLocked(v => !v); }}
      >
        {locked ? <AspectRadiolock /> : <AspectRadioUnlock />}
      </button>
    </div>
  );
}
