import React from 'react';
import ReactDOM from 'react-dom';

interface MarkdownViewModalProps {
  content: string;
  onClose: () => void;
}

export function MarkdownViewModal({ content, onClose }: MarkdownViewModalProps) {
  const renderPrd = typeof window !== 'undefined' && (window as any)._sandbox_?.helpers?.renders?.renderPrdView;

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
          maxHeight: '80vh',
          borderRadius: 8,
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
            color: 'var(--mybricks-text-color-secondary, #999)',
            fontSize: 16,
            padding: 0,
            borderRadius: 4,
          }}
          title="关闭"
        >
          ✕
        </button>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 28px',
          }}
        >
          {renderPrd
            ? renderPrd({ content, showTitle: true, title: 'README' })
            : (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--mybricks-text-color-main)' }}>
                {content}
              </pre>
            )
          }
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
