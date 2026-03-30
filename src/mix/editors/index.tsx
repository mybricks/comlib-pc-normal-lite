import './resourceLoader';
import '../../utils/antd';
import './dom-to-figma/index';
import context from '../context';
import { buildFocusAreaConfigs } from './configs/focusArea';
import { buildExportCodeConfig } from './configs/exportCode';
import { buildPagePanel } from './configs/pagePanel';
import { buildHooks } from './hooks';
import { genStyleValue, genResizer } from './styleProxy';
import type { Props, Actions } from './types';

export default function (props: Props, actions: Actions) {
  if (!props?.data || !props?.id) return {};

  const comId = props.model?.runtime?.id || props.id;
  const focusAreaConfigs = buildFocusAreaConfigs(props.data, comId);
  const exportCodeConfig = buildExportCodeConfig(props);

  if (!focusAreaConfigs[':root']) {
    focusAreaConfigs[':root'] = { items: [...exportCodeConfig] };
  } else {
    focusAreaConfigs[':root'].items.push(...exportCodeConfig);
  }

  context.setAiCom(props.id, { params: props, actions });

  if ((window as any)._getProjectConfig_) {
    context.projectConfig = (window as any)._getProjectConfig_();
  }

  context.createVibeCodingAgent({ register: (window as any)._registerAgent_ });

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
              valueProxy: genStyleValue({ comId }),
            },
            genResizer(),
          ],
        },
      ],
    },
    '[data-zone-noselector]': {
      style: [{ items: [] }],
    },
    '[data-library-source]': {},
  };
}
