import './resourceLoader';
import '../../utils/antd';
import context from '../context';
import { buildFocusAreaConfigs } from './configs/focusArea';
import { buildExportCodeConfig } from './configs/exportCode';
import { buildPagePanel } from './configs/pagePanel';
import { buildHooks } from './hooks';
import { genStyleValue, genResizer, genImgSrcReplacer } from './styleProxy';
import type { Props, Actions } from './types';
import { registerResourcesCode } from './registerResourcesCode';
import { getDataZoneTextEditable } from './getDataZoneTextEditable'

export default function (props: Props, actions: Actions) {
  if (!props?.data || !props?.id) return {};

  registerResourcesCode(props.id, props.name)

  const comId = props.model?.runtime?.id || props.id;
  const focusAreaConfigs = buildFocusAreaConfigs(props.data, comId);
  const exportCodeConfig = buildExportCodeConfig(props);

  if (!focusAreaConfigs[':root']) {
    focusAreaConfigs[':root'] = {items: [...exportCodeConfig]};
  } else {
    focusAreaConfigs[':root'].items.push(...exportCodeConfig);
  }

  context.setAiCom(props.id, {params: props, actions});

  if ((window as any)._getProjectConfig_) {
    context.projectConfig = (window as any)._getProjectConfig_();
  }

  const dependencies = window._sandbox_.config.componentRuntime?.getDependencies?.({ mybricks: {} }) || {}
  if (!context.projectConfig.availableLibraries) {
    context.projectConfig.availableLibraries = []
  }
  context.projectConfig.availableLibraries.push(...Object.entries(dependencies).map(([key, value]: any) => {
    return {
      name: key,
      ...value
    }
  }))

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
      items: [
        {
          type: 'button',
          title: '更改图片',
          value: genImgSrcReplacer(),
        }
      ]
    },
    ...getDataZoneTextEditable(),
  };
}
