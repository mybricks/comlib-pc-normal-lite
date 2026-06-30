import context from '../../context';
import { syncFromFigmaJson } from '../figma-to-dom/sync';
import type { Props, FigmaComponentPatch, FigmaImportItem } from '../types';

function ensureGuiCard(data: any) {
  if (!data.gui_card) {
    data.gui_card = {}
  }

  data.gui_card.assistantTitle ??= '智能助手'
  data.gui_card.icon ??= 'https://f2.eckwai.com/kos/nlav12333/aicode/logo/newlogo.png'
  data.gui_card.title ??= '欢迎使用'
  data.gui_card.titleHighlight ??= 'AI 助手'
  data.gui_card.subtitle ??= '你可以向我提问'
  data.gui_card.colorPrimary ??= '#FA6400'

  return data.gui_card
}

function getGuiCardField(params: EditorResult<any>, key: string) {
  return ensureGuiCard(params.data)[key]
}

function setGuiCardField(params: EditorResult<any>, key: string, value: any) {
  const nextValue = typeof value === 'string' ? value.trim() : value
  if (nextValue === '' || nextValue == null) {
    return
  }

  const guiCard = ensureGuiCard(params.data)
  params.data.gui_card = {
    ...guiCard,
    [key]: nextValue
  }
}

export function buildPagePanel(props: Props) {
  const comId = props.model?.runtime?.id || props.id;

  return {
    title: '页面',
    items: (pageProps: any, cate1: any) => {
      cate1.title = '页面';

      if (pageProps.focusArea.dataset.desnPage === 'GUI_AGENT') {
        cate1.items = [
          {
            title: '主题色',
            type: 'colorPicker',
            value: {
              get({ data }: EditorResult<any>) {
                return ensureGuiCard(data).colorPrimary
              },
              set(params: EditorResult<any>, value) {
                setGuiCardField(params, 'colorPrimary', value)
              }
            }
          },
          {
            title: '主标题',
            type: 'text',
            value: {
              get(params) {
                return getGuiCardField(params, 'title')
              },
              set(params, value) {
                setGuiCardField(params, 'title', value)
              }
            }
          },
          {
            title: '高亮文字',
            type: 'text',
            description: '主标题中高亮展示的部分',
            value: {
              get(params) {
                return getGuiCardField(params, 'titleHighlight')
              },
              set(params, value) {
                setGuiCardField(params, 'titleHighlight', value)
              }
            },
          },
          {
            title: '副标题',
            type: 'text',
            value: {
              get(params) {
                return getGuiCardField(params, 'subtitle')
              },
              set(params, value) {
                setGuiCardField(params, 'subtitle', value)
              }
            }
          },
          {
            title: '输入提示',
            type: 'text',
            value: {
              get(params) {
                return getGuiCardField(params, 'placeholder')
              },
              set(params, value) {
                setGuiCardField(params, 'placeholder', value)
              }
            }
          },
          {
            title: '助手标题',
            type: 'text',
            value: {
              get(params) {
                return getGuiCardField(params, 'assistantTitle')
              },
              set(params, value) {
                setGuiCardField(params, 'assistantTitle', value)
              }
            }
          },
          {
            title: '助手 Logo',
            type: 'text',
            value: {
              get(params) {
                return getGuiCardField(params, 'icon')
              },
              set(params, value) {
                setGuiCardField(params, 'icon', value)
              }
            }
          },
          {
            title: '推荐问题',
            type: 'code',
            options: {
              language: 'json',
              minimap: {
                enabled: false
              }
            },
            value: {
              get(params) {
                const groups = getGuiCardField(params, 'groups')
                if (groups) {
                  return JSON.stringify(groups, null, 2)
                }
                return
              },
              set(params, value) {
                const trimValue = typeof value === 'string' ? value.trim() : ''
                if (trimValue) {
                  setGuiCardField(params, 'groups', JSON.parse(decodeURIComponent(trimValue)))
                }
              }
            }
          },
        ]
        return
      }

      cate1.items = [
        {
          title: 'UI设计',
          items: [
            {
              title: 'Figma',
              type: 'figma',
              value: {
                get() {
                  return {
                    getCanvasList: () => context.getCanvasList(),
                    onSync: (
                      items: FigmaImportItem[],
                      componentPatches?: FigmaComponentPatch[],
                      rootEl?: Element | null
                    ) => {
                      return syncFromFigmaJson(comId, items, componentPatches || [], { rootEl: rootEl ?? null });
                    },
                  };
                },
                set() {
                  
                },
              },
            },
            // {
            //   title: '下载Figma插件',
            //   type: 'editorRender',
            //   options: {
            //     render: () => <DownloadFigmaPlugin buttonStyle={figmaUiButtonStyle} />,
            //   },
            // },
            // {
            //   type: 'themes',
            //   value: {
            //     get(params: any) {
            //       if (params.data._themesModified) {
            //         return params.data.themes;
            //       }
            //       const projectThemes = context.projectConfig.themes;
            //       return (projectThemes && projectThemes.length > 0) ? projectThemes : params.data.themes;
            //     },
            //     set(params: any, themes: any) {
            //       params.data._themesModified = true;
            //       params.data.themes = themes;
            //     },
            //   },
            // },
          ],
        },
      ];
      return;
    },
  };
}
