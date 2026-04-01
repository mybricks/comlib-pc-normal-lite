import { ANTD_KNOWLEDGES_MAP, ANTD_ICONS_KNOWLEDGES_MAP } from '../../knowledges';
import { genStyleValue, genResizer } from '../styleProxy';

/**
 * 根据 runtimeJsxConstituency 构建 focusAreaConfigs。
 * 每个选区对应一条样式编辑配置。
 */
export function buildFocusAreaConfigs(data: any, comId: string): Record<string, any> {
  const focusAreaConfigs: Record<string, any> = {};

  if (!data.runtimeJsxConstituency) return focusAreaConfigs;

  data.runtimeJsxConstituency.forEach(({ className, component, source, jsdoc, selectors }: any) => {
    if (!component) return;

    if (typeof className === 'string') {
      className = [className];
    }

    let knowledge: any = null;
    if (source === 'antd') {
      knowledge = ANTD_KNOWLEDGES_MAP[component.toUpperCase()];
    } else if (source === '@ant-design/icons') {
      knowledge = ANTD_ICONS_KNOWLEDGES_MAP[component.toUpperCase()];
    }

    if (!knowledge?.editors) return;

    Object.keys(knowledge.editors).forEach((key) => {
      const editor = knowledge.editors[key];
      const styleItems = [
        {
          title: '样式',
          autoOptions: true,
          valueProxy: genStyleValue({ comId }),
        },
        genResizer(),
      ];

      selectors?.forEach((selector: string) => {
        const nextSelector = key === ':root' ? selector : `${selector} ${key}`;
        if (!focusAreaConfigs[nextSelector]) {
          focusAreaConfigs[nextSelector] = {
            title: editor.title || `.${className[0]}`,
            items: [],
            style: [{ items: styleItems }],
          };
        } else {
          focusAreaConfigs[nextSelector].style = [{ items: styleItems }];
        }
      });
    });
  });

  return focusAreaConfigs;
}
