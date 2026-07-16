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

  // 仅允许替换无子元素的通用文本容器，避免在复杂容器上重复展示操作入口
  if (!['div', 'span'].includes(tag || '') || ele?.childElementCount) {
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
      data-mybricks-tip="支持上传图片 / SVG 图标，AI 将其替换为当前选中的元素"
      onClick={() => elementReplacer.set(syntheticParams)}
    >
      <AiBlingblingIcon style={{ flexShrink: 0, marginRight: 4, transform: 'rotate(180deg)' }} />
      上传图标并替换当前元素
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
