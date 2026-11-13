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
import getLocalIframeEditors from '../../platforms/local-iframe/editors'
import { getClosestDomLoc, escapeCssAttributeValue } from '../../helpers/dom'

function scopeNoteRenderSelector(ele: Element, selector: string) {
  const canvasTag = ele.closest('[data-canvas-tag]')?.getAttribute('data-canvas-tag')
  if (canvasTag == null) {
    return selector
  }

  const canvasSelector = `[data-canvas-tag='${escapeCssAttributeValue(canvasTag)}']`
  return `${canvasSelector} ${selector}`
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

  if (config.getFrontendMode() === 'local-iframe') {
    return getLocalIframeEditors(props)
  }

  return {
    ...focusAreaConfigs,
    ...buildHooks(props),
    '[data-zone-type=page]': buildPagePanel(props),
    '[data-zone-type=skill]': {
      title: '技能',
      items: [],
    },
    '[data-library-source]': {},
    // 这里同时还兼容了三方库组件
    '[class],[data-zone-noselector]': {
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
              const ele = params.focusArea.ele
              const loc = getClosestDomLoc(ele)
              if (!loc) {
                return []
              }
              const { files, codeLine } = loc;
              const codeLineValue = `"codeLine":{"start":${codeLine.start},"end":${codeLine.end}}`
              const locKey = `[data-loc*='${escapeCssAttributeValue(files.jsx)}']` + `[data-loc*='${escapeCssAttributeValue(codeLineValue)}']` + ':not([data-wrap-container])'
              const key = scopeNoteRenderSelector(ele, locKey)

              return data._noteRender[key] || []
            },
            set(params, value) {
              const data = context.component!.params.data;
              const loc = getClosestDomLoc(params.focusArea.ele)
              if (!loc) {
                return []
              }
              const { files, codeLine } = loc;
              const codeLineValue = `"codeLine":{"start":${codeLine.start},"end":${codeLine.end}}`
              const locKey = `[data-loc*='${escapeCssAttributeValue(files.jsx)}']` + `[data-loc*='${escapeCssAttributeValue(codeLineValue)}']` + ':not([data-wrap-container])'
              const key = scopeNoteRenderSelector(params.focusArea.ele, locKey)

              if (!data._noteRender) {
                data._noteRender = {}
              }
              data._noteRender[key] = value
              context.component?.actions.notifyChanged("_noteRender", 'update', {
                comments: Object.entries(data._noteRender)
                  .filter(([key, value]: any) => {
                    return value?.length
                  })
                  .map(([key, value]: any) => {
                    return {
                      refSelector: key,
                      ...value[0],
                      type: value.find(({ type }) => type === 'todo') ? 'todo' : 'default'
                    }
                  }),
              })
            }
          }
        },
      ]
    },
    '[data-zone-icon]': {
      items: buildIconEditorItems(comId),
    },
    'img': {
      items: buildImgEditorItems(comId),
    },
    '[data-zone-type="page"] svg': {
      items: [
        ...buildSvgEditorItems(comId),
        genSvgResizer(),
      ],
    },
    // 为带有[data-zone-icon]的三方图标的svg节点增加样式面板
    '[data-zone-type="page"] [data-zone-icon] svg:not([class],[data-zone-noselector],[data-zone-selector])': {
      items: [
        {
          title: '样式',
          type: '_style',
          autoOptions: true,
          valueProxy: genStyleValue(props),
        },
      ]
    },
    '[class]': {
      items: [
        {
          title: '样式',
          type: '_style',
          autoOptions: true,
          valueProxy: genStyleValue(props),
        },
      ]
    },
    '[data-zone-noselector]': {
      items: [
        {
          title: '样式',
          type: '_style',
          autoOptions: true,
          valueProxy: genStyleValue(props),
        },
      ]
    },
    '[data-zone-selector]': {
      items: [
        {
          title: '样式',
          type: '_style',
          autoOptions: true,
          valueProxy: genStyleValue(props),
        },
        resizer(),
      ]
    },
    ...(frontendMode === 'react-native' ? {
      '[style]': {}
    } : {}),
    // ...getDataZoneTextEditable(),
    ...undoRedo(),
    ...setStyle(),
    ...setSegment(),
    '@getCode'() {
      return context.component?.params.data.files.map(({ fileName, source }) => {
        return {
          path: fileName,
          content: decodeURIComponent(source)
        }
      })
    },
    '@setCode'(params: {
      /** 相对于组件文件根目录的文件路径，例如 pages/Home/index.tsx */
      path: string;
      /** 未编码的源码内容；删除文件时可省略 */
      content: string;
      type: 'update' | 'delete';
    }) {
      context.updateFile({
        fileName: params.path,
        content: params.content,
        type: params.type,
      });
    }
  };
}
