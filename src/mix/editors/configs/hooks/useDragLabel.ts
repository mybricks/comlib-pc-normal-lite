import { useRef, useEffect, useCallback } from 'react';
import type React from 'react';

/**
 * 在标签元素上按住鼠标左右拖拽来修改数值。
 * 每次 mousemove 实时调用 onCommit，支持锁定宽高比时同步更新关联字段。
 */
export function useDragLabel(getValue: () => number, onCommit: (v: number) => void, min = 1) {
  const dragRef = useRef({ active: false, startX: 0, startValue: 0 });
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const getValueRef = useRef(getValue);
  getValueRef.current = getValue;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { active: true, startX: e.clientX, startValue: getValueRef.current() };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const state = dragRef.current;
      if (!state.active) return;
      const delta = e.clientX - state.startX;
      const next = Math.max(min, Math.round(state.startValue + delta));
      onCommitRef.current(next);
    };
    const onUp = () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [min]);

  return {
    style: { cursor: 'ew-resize' } as React.CSSProperties,
    onMouseDown: handleMouseDown,
  };
}
