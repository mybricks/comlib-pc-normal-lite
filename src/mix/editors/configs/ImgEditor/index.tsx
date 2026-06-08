import React from 'react';
import context from '../../../context';
import { STATIC_SRC_RE, genImgSrcReplacer } from '../../styleProxy';
import { AiBlingblingIcon } from '../../icons/ai-svg-blingbling';
import * as styles from './style.lazy.less';
import { getLazyCss } from '../../../lowcodeView/utils/css';

const css = getLazyCss(styles);

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

  return (
    <button
      type="button"
      className={css.btn}
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
