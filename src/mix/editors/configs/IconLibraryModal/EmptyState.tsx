import React from 'react';
import context from '../../../context';
import AIInputBar from './AIInputBar';
import * as styleNS from './style.lazy.less';
import { getLazyCss } from '../../../lowcodeView/utils/css';

const css = getLazyCss(styleNS);

export default function EmptyState({ onClose }: { onClose: () => void }) {
  const handleGenerate = (content: string) => {
    const plugins = (context as any).plugins as any;
    const aiService = plugins?.aiService;
    plugins?.showAIDialog?.();
    try {
      const result = aiService?.request({
        message: `调用图标生成工具，生成图标，用户需求：${content}`,
        attachments: [],
      });
      if (result && typeof result.then === 'function') {
        result.then(
          (r: any) => console.log('[svgEditor] request resolved:', r),
          (e: any) => console.error('[svgEditor] request rejected:', e),
        );
      }
    } catch (e) {
      console.error('[svgEditor] AI request threw:', e);
    }
    onClose();
  };

  return (
    <div className={css.emptyState}>
      <div className={css.guideIcon}>
        <svg viewBox="0 0 24 24" width={24} height={24}>
          <path
            d="M11 3l1.9 4.6L17.5 9.5l-4.6 1.9L11 16l-1.9-4.6L4.5 9.5l4.6-1.9L11 3z"
            fill="currentColor"
          />
          <path
            d="M17.8 13.2l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"
            fill="currentColor"
          />
        </svg>
      </div>
      <div className={css.title}>还没有图标库</div>
      <div className={css.subtitle}>描述你想要的风格，让 AI 帮你生成</div>
      <AIInputBar onGenerate={handleGenerate} />
    </div>
  );
}
