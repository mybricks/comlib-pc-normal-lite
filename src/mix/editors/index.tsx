import './resourceLoader';
import '../../utils/antd';
import React from 'react';
import context, { nextContext } from '../context';
import { buildFocusAreaConfigs } from './configs/focusArea';
import { buildExportCodeConfig } from './configs/exportCode';
import { buildPagePanel } from './configs/pagePanel';
import { buildHooks } from './hooks';
import { genStyleValue, genResizer, genImgSrcReplacer } from './styleProxy';
import { buildSvgEditorItems } from './configs/svgEditor';
import { aiSvgIcon } from './icons/ai-svg';
import { aiImgIcon } from './icons/ai-img';
import { AiEditPanel } from './components/AiEditPanel';
import type { Props, Actions } from './types';
import { registerResourcesCode } from './registerResourcesCode';
import { getDataZoneTextEditable } from './getDataZoneTextEditable'
import undoRedo from './undoRedo';
import { verify as eslintVerify } from '../eslint';
import styles from './styleProxy';

export default function (props: Props, actions: Actions) {

  registerResourcesCode(props.id, props.name)

  const comId = props.id;
  const focusAreaConfigs = buildFocusAreaConfigs(props.data, comId);
  const exportCodeConfig = buildExportCodeConfig(props);

  if (!focusAreaConfigs[':root']) {
    focusAreaConfigs[':root'] = {items: [...exportCodeConfig]};
  } else {
    focusAreaConfigs[':root'].items.push(...exportCodeConfig);
  }

  nextContext.setComponent({ params: props, actions })

  context.setAiCom(props.id, {params: props, actions});
  (window as any).__mybricksEslintVerify = () => eslintVerify(props.data.files);

  if ((window as any)._getProjectConfig_) {
    context.projectConfig = (window as any)._getProjectConfig_();
  }

  return {
    ...focusAreaConfigs,
    ...buildHooks(props),
    '[data-zone-type=page]': buildPagePanel(props),
    '[data-zone-selector]': {
      style: [
        {
          items: [
            {
              title: '样式',
              autoOptions: true,
              valueProxy: genStyleValue({comId}),
            },
            genResizer(),
          ],
        },
      ],
    },
    '[data-zone-noselector]': {
      style: [{items: []}],
    },
    '[data-library-source]': {},
    '[class]': {},
    'img': {
      '@ai': {
        title: aiImgIcon,
        desc: '通过AI创作图片',
        render(_data, {close}) {
          return <AiEditPanel close={close} mode="IMG" />;
        }
      },
      items: [
        {
          type: 'button',
          title: '更改图片',
          value: genImgSrcReplacer(),
        }
      ]
    },
    '[data-zone-svg]': {
      '@ai': {
        title: aiSvgIcon,
        desc: '通过AI创作图标',
        render(_data, {close}) {
          return <AiEditPanel close={close} mode="SVG" />;
        }
      },
      items: buildSvgEditorItems(comId),
    },
    ...getDataZoneTextEditable(),
    ...undoRedo(),
    ...styles()
  };
}
