import React from 'react';
import ReactDOM from 'react-dom';
import type { ParsedRequirement, RequirementFeature } from '../ai-code/md';

interface RequirementViewModalProps {
  compiled: ParsedRequirement;
  onClose: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  new: '新需求',
  edit: '变更需求',
};

function TypeTag({ type }: { type: string }) {
  const label = TYPE_LABEL[type] ?? type;
  const isNew = type === 'new';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '0 8px',
      height: 20,
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.02em',
      backgroundColor: isNew
        ? 'var(--mybricks-color-primary, #1677ff)'
        : 'color-mix(in srgb, var(--mybricks-color-primary, #1677ff) 15%, transparent)',
      color: isNew ? '#fff' : 'var(--mybricks-color-primary, #1677ff)',
      border: isNew
        ? 'none'
        : '1px solid color-mix(in srgb, var(--mybricks-color-primary, #1677ff) 35%, transparent)',
      flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

function RelatedTag({ name }: { name: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '0 6px',
      height: 18,
      borderRadius: 3,
      fontSize: 11,
      backgroundColor: 'var(--mybricks-bg-color-hover)',
      color: 'var(--mybricks-text-color-main)',
      border: '1px solid var(--mybricks-border-color-main)',
      flexShrink: 0,
    }}>
      {name.trim()}
    </span>
  );
}

/** 将概述文本中的 flowchart/graph 单行提取出来，单独渲染为流程图区域（不包裹代码块） */
function OverviewContent({ text, renderPrd }: { text: string; renderPrd: any }) {
  // 将 overview 文本按行扫描，把 flowchart/graph 行独立出来
  const segments: Array<{ type: 'md' | 'flowchart'; content: string }> = [];
  let mdBuf: string[] = [];

  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('flowchart ') || t.startsWith('graph ')) {
      if (mdBuf.length) {
        segments.push({ type: 'md', content: mdBuf.join('\n') });
        mdBuf = [];
      }
      segments.push({ type: 'flowchart', content: t });
    } else {
      mdBuf.push(line);
    }
  }
  if (mdBuf.length) segments.push({ type: 'md', content: mdBuf.join('\n') });

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'flowchart') {
          return (
            <div key={i} style={{
              margin: '8px 0',
              textAlign: 'center',
              borderRadius: 8,
              padding: '8px 0',
              border: '1px solid var(--mybricks-border-color-main)',
            }}>
              {renderPrd({ content: `\`\`\`mermaid\n${seg.content}\n\`\`\``, showTitle: false })}
            </div>
          );
        }
        const trimmed = seg.content.trim();
        if (!trimmed) return null;
        return <div key={i}>{renderPrd({ content: trimmed, showTitle: false })}</div>;
      })}
    </>
  );
}

function FeatureItem({ feature, renderPrd }: { feature: RequirementFeature; renderPrd: any }) {
  const relatedList = feature.related ? feature.related.split(',').map(s => s.trim()).filter(Boolean) : [];

  // 剥除 type:/related: 行，剩余内容交给 renderPrd
  const bodyLines = feature.body
    .split('\n')
    .filter(l => !/^type\s*:/i.test(l.trim()) && !/^related\s*:/i.test(l.trim()));
  const bodyText = bodyLines.join('\n').trim();

  return (
    <div style={{ marginBottom: 20 }}>
      {/* 标签行：type tag + title + related tags */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: bodyText ? 4 : 0 }}>
        {feature.type && <TypeTag type={feature.type} />}
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--mybricks-text-color-main)' }}>
          {feature.title}
        </span>
        {relatedList.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {relatedList.map((r, i) => <RelatedTag key={i} name={r} />)}
          </div>
        )}
      </div>
      {/* 功能点内容：直接用 _render_comp_prd 渲染 */}
      {bodyText && (
        <div style={{ paddingLeft: 2 }}>
          {renderPrd({ content: bodyText, showTitle: false })}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--mybricks-text-color-main)',
      marginBottom: 10,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    }}>
      <span style={{
        display: 'inline-block',
        width: 3,
        height: 13,
        borderRadius: 2,
        backgroundColor: 'var(--mybricks-color-primary, #1677ff)',
        flexShrink: 0,
      }} />
      {children}
    </div>
  );
}

export function RequirementViewModal({ compiled, onClose }: RequirementViewModalProps) {
  const renderPrd = typeof window !== 'undefined' && (window as any)._render_comp_prd;

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

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {/* 标题/描述：居中展示 */}
          {(compiled.title || compiled.desc) && (
            <div style={{
              textAlign: 'center',
              marginBottom: 24,
              paddingBottom: 20,
              borderBottom: '1px solid var(--mybricks-border-color-main)',
            }}>
              {compiled.title && (
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, color: 'var(--mybricks-text-color-main)' }}>
                  {compiled.title}
                </div>
              )}
              {compiled.desc && (
                <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--mybricks-text-color-main)' }}>
                  {renderPrd
                    ? renderPrd({ content: compiled.desc, showTitle: false })
                    : compiled.desc
                  }
                </div>
              )}
            </div>
          )}

          {/* 概述：流程图单独提取，文字用 renderPrd */}
          {compiled.overview && (
            <div style={{ marginBottom: 20 }}>
              <SectionTitle>概述</SectionTitle>
              {renderPrd
                ? <OverviewContent text={compiled.overview} renderPrd={renderPrd} />
                : <pre style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{compiled.overview}</pre>
              }
            </div>
          )}

          {/* 功能点列表 */}
          {compiled.features.length > 0 && (
            <div>
              <SectionTitle>功能点列表</SectionTitle>
              {compiled.features.map((f, i) => (
                renderPrd
                  ? <FeatureItem key={i} feature={f} renderPrd={renderPrd} />
                  : <div key={i} style={{ marginBottom: 16 }}>{f.title}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
