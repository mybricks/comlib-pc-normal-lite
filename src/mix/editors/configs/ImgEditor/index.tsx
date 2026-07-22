import React, { useState, useEffect } from 'react';
import context from '../../../context';
import { STATIC_SRC_RE, genImgSrcReplacer, registerImgAppliedCallback } from '../../styleProxy';
import { AiBlingblingIcon } from '../../icons/ai-svg-blingbling';
import * as styles from './style.lazy.less';
import { getLazyCss } from '../../../lowcodeView/utils/css';

const css = getLazyCss(styles);

const imgReplacer = genImgSrcReplacer();

function readImgSrc(ele: HTMLElement | null): string {
  if (!ele) return '';
  return ele.getAttribute('src') || (ele as HTMLImageElement).currentSrc || (ele as HTMLImageElement).src || '';
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
      <button
        type="button"
        className={css.btn}
        data-mybricks-tip={isDynamic ? '上传图片，AI 帮你替换' : '上传图片进行替换'}
        onClick={() => imgReplacer.set(syntheticParams)}
      >
        {isDynamic && <AiBlingblingIcon style={{ flexShrink: 0, marginRight: 4, transform: 'rotate(180deg)' }} />}
        更改图片
      </button>
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
