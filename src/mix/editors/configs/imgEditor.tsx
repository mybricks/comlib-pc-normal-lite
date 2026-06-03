import React from 'react';
import context from '../../context';
import { STATIC_SRC_RE, genImgSrcReplacer } from '../styleProxy';
import { AiBlingblingIcon } from '../icons/ai-svg-blingbling';

const imgReplacer = genImgSrcReplacer();

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

  const syntheticParams = {
    focusArea: ele,
    id: comId,
    env: context.component?.params?.env,
  };

  const btnStyle: React.CSSProperties = {
    cursor: 'pointer',
    width: '100%',
    height: 26,
    borderRadius: 6,
    border: '1px solid var(--mybricks-border-color-main)',
    backgroundColor: 'var(--mybricks-bg-color-main)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--mybricks-text-color-main)',
    fontSize: 12,
    padding: 0,
  };

  return (
    <button
      type="button"
      style={btnStyle}
      data-mybricks-tip={isDynamic ? '上传图片，AI 帮你替换' : '上传图片进行替换'}
      onClick={() => imgReplacer.set(syntheticParams)}
    >
      {isDynamic && <AiBlingblingIcon style={{ flexShrink: 0, marginRight: 4, transform: 'rotate(180deg)' }} />}
      更改图片
    </button>
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
