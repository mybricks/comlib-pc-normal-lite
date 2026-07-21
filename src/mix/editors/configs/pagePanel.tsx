import context, { config } from '../../context';
import { syncFromFigmaJson } from '../figma-to-dom/sync';
import type { Props, FigmaComponentPatch, FigmaImportItem } from '../types';
import { ensureGuiCard, getGuiCardField, setGuiCardField } from './guiCard';

export function buildPagePanel(props: Props) {
  const comId = props.model?.runtime?.id || props.id;
  const frontendMode = config.getFrontendMode();

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

      let title = '页面'
      const items: any[] = [
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
          ],
        },
      ]

       if (frontendMode === 'gui_card') {
        title = '卡片'
        const getHomePinName = (params: EditorResult<any>) => params.focusArea.dataset.zoneName
        const getHomePin = (params: EditorResult<any>) => {
          const pins = getGuiCardField(params, 'homePins') || []
          const name = getHomePinName(params)
          return pins.find((pin: any) => pin.name === name)
        }
        const setHomePin = (params: EditorResult<any>, nextPin: any) => {
          const pins = getGuiCardField(params, 'homePins') || []
          const index = pins.findIndex((pin: any) => pin.name === nextPin.name)
          const nextPins = [...pins]

          if (index === -1) {
            nextPins.push(nextPin)
          } else {
            nextPins[index] = {
              ...nextPins[index],
              ...nextPin
            }
          }

          setGuiCardField(params, 'homePins', nextPins)
        }

        items.push({
          title: '默认收藏',
          description: '将卡片默认收藏到首页',
          type: 'switch',
          value: {
            get(params) {
              return getHomePin(params)?.enabled === true
            },
            set(params, value) {
              const name = getHomePinName(params)
              const pin = getHomePin(params)

              setHomePin(params, {
                name,
                props: pin?.props || encodeURIComponent("{}"),
                enabled: value === true
              })
            }
          }
        }, {
          title: '参数',
          type: 'code',
          description: '请查看配置文件了解参数信息',
          ifVisible(params) {
            return getHomePin(params)?.enabled === true
          },
          options: {
            language: 'json',
            minimap: {
              enabled: false
            },
          },
          value: {
            get(params) {
              return getHomePin(params)?.props
            },
            set(params, value) {
              const name = getHomePinName(params)
              const pin = getHomePin(params)

              setHomePin(params, {
                name,
                enabled: pin?.enabled === true,
                props: value
              })
            }
          }
        })
      }

      cate1.title = title;
      cate1.items = items;
      return;
    },
  };
}
