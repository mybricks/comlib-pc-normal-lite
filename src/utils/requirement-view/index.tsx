import React from 'react';
import ReactDOM from 'react-dom';
import type { ParsedRequirement } from '../ai-code/md';
import { useDarkMode } from '../hooks';

interface RequirementViewModalProps {
  compiled: ParsedRequirement;
  onClose: () => void;
}

export function RequirementViewModal({ compiled, onClose }: RequirementViewModalProps) {
  const renderPrd = typeof window !== 'undefined' && (window as any)._sandbox_?.helpers?.renders?.renderPrdView;
  const isDark = useDarkMode();

  const modal = (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '80vw',
          maxWidth: 1400,
          maxHeight: '80vh',
          borderRadius: 8,
          border: '1px solid var(--mybricks-border-color-main)',
          backgroundColor: 'var(--mybricks-bg-color-main, #fff)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 1,
            width: 24,
            height: 24,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--mybricks-text-color-main)',
            fontSize: 16,
            padding: 0,
            borderRadius: 4,
          }}
          title="关闭"
        >
          ✕
        </button>

        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px' }}>
          {/* YAML 元信息：左侧对齐，优化排版 */}
          {(compiled.title || compiled.desc) && (
            <div style={{
              marginBottom: 32,
              paddingBottom: 24,
              borderBottom: '1px solid var(--mybricks-border-color-main)',
            }}>
              {compiled.title && (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'flex-end', 
                  gap: 12, 
                  marginBottom: 16 
                }}>
                  <h1 style={{ 
                    fontSize: 24, 
                    fontWeight: 600, 
                    margin: 0,
                    lineHeight: 1.2,
                    color: 'var(--mybricks-text-color-main)' 
                  }}>
                    {compiled.title}
                  </h1>
                  <span style={{ 
                    fontSize: 13, 
                    fontStyle: 'italic', 
                    color: 'var(--mybricks-text-color-sub, #888)',
                    paddingBottom: 2,
                    userSelect: 'none'
                  }}>
                    需求文档
                  </span>
                </div>
              )}
              {compiled.desc && (
                <div style={{ 
                  fontSize: 14, 
                  lineHeight: 1.6, 
                  color: 'var(--mybricks-text-color-main)',
                }}>
                  {compiled.desc}
                </div>
              )}
            </div>
          )}

          {/* 正文：body 已预处理（flowchart → mermaid block，meta 行 → HTML），直接渲染 */}
          {compiled.body && (
            renderPrd
              ? renderPrd({ content: compiled.body, showTitle: false, darkMode: isDark })
              : <pre style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{compiled.body}</pre>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
