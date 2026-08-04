import React, { useState, useEffect } from 'react';
import context from '../../../context';
import { STATIC_SRC_RE, genImgSrcReplacer, registerImgAppliedCallback } from '../../styleProxy';
import { AiBlingblingIcon } from '../../icons/ai-svg-blingbling';
import * as styles from './style.lazy.less';
import { getLazyCss } from '../../../lowcodeView/utils/css';
import { DownloadIcon } from '../../icons/ai-img';

const css = getLazyCss(styles);

const imgReplacer = genImgSrcReplacer();

function readImgSrc(ele: HTMLElement | null): string {
  if (!ele) return '';
  return ele.getAttribute('src') || (ele as HTMLImageElement).currentSrc || (ele as HTMLImageElement).src || '';
}

function getImageFileName(src: string): string {
  return new URL(src, window.location.href).pathname.split('/').pop() || 'image';
}

function triggerDownload(href: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function copyImageUrl(src: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(src);
    return;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = src;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    } catch {
      // The image is still opened in a new tab when clipboard access is unavailable.
    }
  }
}

async function downloadImage(src: string): Promise<void> {
  if (!src) return;

  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Image download failed: ${response.status}`);

    const objectUrl = URL.createObjectURL(await response.blob());
    triggerDownload(objectUrl, getImageFileName(src));
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  } catch {
    await copyImageUrl(src);
    window.open(src, '_blank', 'noopener,noreferrer');
  }
}

function ImgPreview({ src }: { src: string }) {
  if (!src) return null;
  return (
    <div className={css.preview}>
      <div className={css.previewInner}>
        <img src={src} alt="" />
      </div>
    </div>
  );
}

function ImgEditorPanel({ editConfig, comId }: { editConfig: any; comId: string }) {
  const ele = editConfig.editConfig?.ele as HTMLElement | null;
  const loc = JSON.parse((ele as any)?.dataset?.loc ?? '{}');
  const jsxPath = loc.files?.jsx;
  const source = jsxPath
    ? decodeURIComponent(
        context.component?.params?.data?.files?.find(
          (f: { fileName: string }) => f.fileName === jsxPath
        )?.source ?? ''
      )
    : '';
  const snippet = source ? source.slice(loc.jsx?.start, loc.jsx?.end) : '';
  const isDynamic = Boolean(source && !STATIC_SRC_RE.test(snippet));
  const [currentSrc, setCurrentSrc] = useState(() => readImgSrc(ele));

  useEffect(() => {
    registerImgAppliedCallback((src: string) => {
      setCurrentSrc(src);
    });
    return () => registerImgAppliedCallback(null);
  }, []);

  const syntheticParams = {
    focusArea: ele,
    id: comId,
    env: context.component?.params?.env,
  };

  return (
    <div className={css.panel}>
      <ImgPreview src={currentSrc} />
      <div className={css.btnRow}>
        <button
          type="button"
          className={css.btn}
          data-mybricks-tip={isDynamic ? '上传图片，AI 帮你替换' : '上传图片进行替换'}
          onClick={() => imgReplacer.set(syntheticParams)}
        >
          {isDynamic && <AiBlingblingIcon style={{ flexShrink: 0, marginRight: 4, transform: 'rotate(180deg)' }} />}
          更改图片
        </button>
        <button
          type="button"
          aria-label="下载图片"
          data-mybricks-tip={JSON.stringify({ content: '下载图片', position: 'left' })}
          onClick={() => downloadImage(currentSrc)}
          style={{
            flexShrink: 0,
            width: 26,
            height: 26,
            padding: 4,
            boxSizing: 'border-box',
            border: '1px solid var(--mybricks-border-color-main, #ddd)',
            borderRadius: 6,
            backgroundColor: 'var(--mybricks-bg-color-main, #fff)',
            cursor: 'pointer',
          }}
        >
          <DownloadIcon style={{ display: 'block', width: '100%', height: '100%' }} />
        </button>
      </div>
    </div>
  );
}

export function buildImgEditorItems(comId: string) {
  return [
    {
      title: '',
      type: 'editorRender',
      options: {
        render(editConfig: any) {
          return <ImgEditorPanel editConfig={editConfig} comId={comId} />;
        },
      },
    },
  ];
}
