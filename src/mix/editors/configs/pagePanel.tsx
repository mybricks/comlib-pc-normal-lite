import context from '../../context';
import { syncFromFigmaJson } from '../figma-to-dom/sync';
import type { Props, FigmaComponentPatch, FigmaImportItem } from '../types';
import { ensureGuiCard, getGuiCardField, setGuiCardField } from './guiCard';

export function buildPagePanel(props: Props) {
  const comId = props.model?.runtime?.id || props.id;

  return {
    items: (pageProps: any, cate1: any, _cate2: any) => {
      if (pageProps.focusArea.dataset.desnPage === 'GUI_AGENT') {
        cate1.title = '智能体';
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
            type: 'STRINGARRAY',
            options: {
              defaultValue: '点击编辑'
            },
            value: {
              get(params) {
                return getGuiCardField(params, 'groups') || []
              },
              set(params, value) {
                setGuiCardField(params, 'groups', value)
              }
            }
          },
        ];
        return
      }

      cate1.title = '页面';
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
