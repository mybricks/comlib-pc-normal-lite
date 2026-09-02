import './resourceLoader';
import '../../utils/antd';
import React from 'react';
import context, { config } from '../context';
import { buildExportCodeConfig } from './configs/exportCode';
import { buildPagePanel } from './configs/pagePanel';
import { buildGuiCardPromptItems } from './configs/guiCard';
import { buildHooks } from './hooks';
import { genStyleValue, genSvgResizer } from './styleProxy';
import { buildImgEditorItems } from './configs/ImgEditor';
import { buildSvgEditorItems } from './configs/SvgEditor';
import { buildIconEditorItems } from './configs/IconEditor';
import { buildElementReplacerItems } from './configs/ElementReplacerEditor';
import { aiSvgIcon5 } from './icons/ai-svg-5';
import { aiImgIcon } from './icons/ai-img';
import { AiEditPanel } from './components/AiEditPanel';
import type { Props, Actions } from './types';
import { registerResourcesCode } from './registerResourcesCode';
import { getDataZoneTextEditable } from './getDataZoneTextEditable'
import undoRedo from './undoRedo';
import { verify as eslintVerify } from '../eslint';
import setSegment from './setSegment';
import setStyle from './style/setStyle'
import resizer from './style/resizer'
import getEditors from '../../platforms/react-native/editors'

function getElementRefSelectorCandidates(ele: Element | null | undefined) {
  const escapeSelectorValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const splitZoneClassnames = (value: string) => value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)

  const getNearestAttribute = (attribute: string) => {
    if (!ele) {
      return null
    }

    const target = ele.hasAttribute(attribute)
      ? ele
      : ele.closest(`[${attribute}]`)

    return target?.getAttribute(attribute) ?? null
  }

  const filename = getNearestAttribute('data-zone-filename')
  const widgetName = getNearestAttribute('data-widget-name')
  const classnames = getNearestAttribute('data-zone-classnames')

  const fileSelector = filename ? `[data-zone-filename="${filename}"]` : ''
  const widgetSelector = widgetName ? `[data-widget-name="${widgetName}"]` : ''
  const classTokens = classnames && classnames !== 'root'
    ? splitZoneClassnames(classnames)
    : []
  const normalizedClassnames = classTokens.join(' ')
  const exactClassSelector = normalizedClassnames
    ? `[data-zone-classnames="${escapeSelectorValue(normalizedClassnames)}"]`
    : ''
  const legacyClassSelector = classTokens.length
    ? `[data-zone-classnames*="${escapeSelectorValue(classTokens.join(','))}"]`
    : ''

  const buildSelectors = (classSelector: string) => {
    if (classSelector) {
      return [
        `${fileSelector}${widgetSelector}${classSelector}`,
        `${fileSelector}${widgetSelector} ${classSelector}`,
        `${fileSelector} ${widgetSelector}${classSelector}`,
        `${fileSelector} ${widgetSelector} ${classSelector}`,
      ]
    }

    return [
      `${fileSelector}${widgetSelector}`,
      `${fileSelector} ${widgetSelector}`,
    ]
  }

  return {
    exactSelectors: buildSelectors(exactClassSelector)
      .map((selector) => `${selector.trim()}:not([data-wrap-container])`),
    legacySelectors: buildSelectors(legacyClassSelector)
      .map((selector) => `${selector.trim()}:not([data-wrap-container])`),
  }
}

function getElementRefSelector(ele: Element | null | undefined, noteRender?: Record<string, any>) {
  const { exactSelectors, legacySelectors } = getElementRefSelectorCandidates(ele)
  if (noteRender) {
    const legacyKey = legacySelectors.find((key) => Object.prototype.hasOwnProperty.call(noteRender, key))
    if (legacyKey) {
      const value = noteRender[legacyKey]
      const exactKey = exactSelectors[0] ?? legacyKey

      if (exactKey !== legacyKey) {
        noteRender[exactKey] = value
        delete noteRender[legacyKey]
      }

      return exactKey
    }

    const exactKey = exactSelectors.find((key) => Object.prototype.hasOwnProperty.call(noteRender, key))
    if (exactKey) {
      return exactKey
    }
  }
  return exactSelectors[0] ?? legacySelectors[0] ?? ''
}

export default function (props: Props, actions: Actions) {

  registerResourcesCode(props.id, props.name)

  const comId = props.id;
  const focusAreaConfigs = {};
  const exportCodeConfig = buildExportCodeConfig(props);
  context.setComponent({ params: props, actions });
  (window as any).__mybricksEslintVerify = () => eslintVerify(props.data.files);
  if ((window as any)._getProjectConfig_) {
    context.projectConfig = (window as any)._getProjectConfig_();
  }

  const frontendMode = config.getFrontendMode()

  // if (frontendMode === 'react-native') {
  //   return getEditors()
  // }


  if (config.getFrontendMode() === 'gui_card') {
    const projectItems = buildGuiCardPromptItems();
    // const uiItems = [
    //   ...exportCodeConfig,
    // ]
    // // 应用没配置
    // if (!focusAreaConfigs[':root']) {
    //   focusAreaConfigs[':root'] = 
    // }

    // focusAreaConfigs[':root']= ({}, cate0, cate1, cate2) => {
    //   cate0.title = ''
    //   cate0.items = [
    //     {
    //       items: projectItems,
    //     },
    //   ]

    //   cate1.title = 'UI',
    //   cate1.items = [
    //     {
    //       items: uiItems
    //     }
    //   ]
    // }

    if (!focusAreaConfigs[':root']) {
      focusAreaConfigs[':root'] = { items: [...projectItems] };
    } else {
      focusAreaConfigs[':root'].items.push(...projectItems);
    }
  } else {
    const rootItems = exportCodeConfig;
    if (!focusAreaConfigs[':root']) {
      focusAreaConfigs[':root'] = { items: [...rootItems] };
    } else {
      focusAreaConfigs[':root'].items.push(...rootItems);
    }
  }

  if (config.getFrontendMode() === 'local-iframe') {
    delete focusAreaConfigs[':root']
  }

  return {
    ...focusAreaConfigs,
    ...buildHooks(props),
    '[data-zone-type=page]': buildPagePanel(props),
    '[data-zone-type=skill]': {
      title: '技能',
      items: [],
    },
    '[data-zone-selector]': {
      style: [
        {
          items: [
            {
              title: '样式',
              autoOptions: true,
              valueProxy: genStyleValue(props),
            },
            resizer(),
          ],
        },
      ],
    },
    '[data-zone-noselector]': {
      style: [{ items: [] }],
    },
    '[data-library-source]': {},
    '[data-zone-icon]': {
      // '@ai': {
      //   title: aiSvgIcon5,
      //   desc: '通过AI创作图标',
      //   render(_data, { close }) {
      //     return <AiEditPanel close={close} mode="SVG" />;
      //   }
      // },
      items: buildIconEditorItems(comId),
    },
    '[class]': {
      style: [
        {
          items: [
            {
              title: '样式',
              autoOptions: true,
              valueProxy: genStyleValue(props),
            },
            // resizer(),
          ],
        },
      ],
      items: [
        {
          title: '',
          type: 'noteRender',
          value: {
            get(params) {
              const data = context.component!.params.data;
              if (!data._noteRender) {
                data._noteRender = {}
              }
              const key = getElementRefSelector(params.focusArea?.ele, data._noteRender)

              return data._noteRender[key] || []
            },
            set(params, value) {
              const data = context.component!.params.data;
              const key = getElementRefSelector(params.focusArea?.ele)
              console.log('_noteRender', {
                key,
                value
              })
              data._noteRender[key] = value
              context.component?.actions.notifyChanged("_noteRender", 'update', {
                comments: Object.entries(data._noteRender)
                  .filter(([key, value]) => {
                    return value?.length
                  })
                  .map(([key, value]) => {
                    const operator = value[0].operator
                    return {
                      refSelector: key,
                      author: {
                        name: operator?.name || operator?.userName || operator?.email || '-'
                      }
                    }
                  }),
                events: [],
                services: [],
                store: []
              })
            }
          }
        }
      ]
      // items: buildElementReplacerItems(comId),
    },
    'img': {
      // '@ai': {
      //   title: aiImgIcon,
      //   desc: '通过AI创作图片',
      //   render(_data, { close }) {
      //     return <AiEditPanel close={close} mode="IMG" />;
      //   }
      // },
      items: buildImgEditorItems(comId),
    },
    '[data-zone-type="page"] svg': {
      // '@ai': {
      //   title: aiSvgIcon5,
      //   desc: '通过AI创作图标',
      //   render(_data, { close }) {
      //     return <AiEditPanel close={close} mode="SVG" />;
      //   }
      // },
      style: [
        {
          items: [
            {
              title: '样式',
              autoOptions: true,
              valueProxy: genStyleValue(props),
            },
            genSvgResizer(),
          ],
        },
      ],
      items: buildSvgEditorItems(comId),
    },
    ...(frontendMode === 'react-native' ? {
      '[style]': {}
    } : {}),
    // ...getDataZoneTextEditable(),
    ...undoRedo(),
    ...setStyle(),
    ...setSegment(),
  };
}
