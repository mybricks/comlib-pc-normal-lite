import React from 'react';
import context from '../../../context';
import { genElementReplacer } from '../../styleProxy';
import { AiBlingblingIcon } from '../../icons/ai-svg-blingbling';
import * as styles from '../ImgEditor/style.lazy.less';
import { getLazyCss } from '../../../lowcodeView/utils/css';

const css = getLazyCss(styles);

const elementReplacer = genElementReplacer();

function ElementReplacerPanel({ editConfig, comId }: { editConfig: any; comId: string }) {
  const ele = editConfig.editConfig?.ele as HTMLElement | null;
  const tag = ele?.tagName?.toLowerCase?.();

  // img 元素已有「更改图片」面板，svg / data-zone-svg 已有 SVG 编辑面板，不重复显示
  if (tag === 'img' || tag === 'svg' || ele?.hasAttribute?.('data-zone-svg')) {
    return null;
  }

  const syntheticParams = {
    focusArea: ele,
    id: comId,
    env: context.component?.params?.env,
  };

  return (
    <button
      type="button"
      className={css.btn}
      data-mybricks-tip="上传图片或 SVG 文件，AI 帮你替换当前选中的元素"
      onClick={() => elementReplacer.set(syntheticParams)}
    >
      <AiBlingblingIcon style={{ flexShrink: 0, marginRight: 4, transform: 'rotate(180deg)' }} />
      替换为图片/SVG
    </button>
  );
}

export function buildElementReplacerItems(comId: string) {
  return [
    {
      title: '',
      type: 'editorRender',
      options: {
        render(editConfig: any) {
          return <ElementReplacerPanel editConfig={editConfig} comId={comId} />;
        },
      },
    },
  ];
}
