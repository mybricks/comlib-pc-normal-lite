import React, { useState, useEffect } from 'react';
import { RequirementViewModal } from '../../../utils/requirement-view';
import context, { config } from '../../context';
import type { Props, FigmaImportItem } from '../types';
import IconLibraryModal from './IconLibraryModal';
import * as styles from './style.lazy.less';
import { getLazyCss } from "../../lowcodeView/utils/css";

const css = getLazyCss(styles)

function ProjectActionsBar({ comId, props }: { comId: string; props: Props }) {
  const [prdVisible, setPrdVisible] = useState(false);
  const [iconLibVisible, setIconLibVisible] = useState(false);

  const compiled = React.useMemo(() => {
    const files = context.component?.params?.data?.files;
    if (!files) return null;
    try {
      return (files as any[]).find((f: any) => f.fileName === 'requirement.md')?.compiled ?? null;
    } catch {
      return null;
    }
  }, [comId]);

  useEffect(() => {
    const events = context.component?.events as any;
    const handler = () => setPrdVisible(true);
    events.on('openDocs', handler, false);
    return () => events.off('openDocs', handler);
  }, [comId]);

  return (
    <div className={css.actionsBar}>
      {compiled && (
        <button type="button" className={css.actionBtn} onClick={() => setPrdVisible(true)}>
          查看PRD文档
        </button>
      )}
      <button type="button" className={css.actionBtn} onClick={() => setIconLibVisible(true)}>
        图标库设置
      </button>
      {prdVisible && compiled && (
        <RequirementViewModal compiled={compiled} onClose={() => setPrdVisible(false)} />
      )}
      <IconLibraryModal
        visible={iconLibVisible}
        params={props}
        comId={comId}
        mode="manage"
        onClose={() => setIconLibVisible(false)}
      />
    </div>
  );
}

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

  ensureGuiCard(params.data)[key] = nextValue
}

export function buildExportCodeConfig(props: Props) {

  const mode = config.getFrontendMode()
  const expand: any[] = []
  if (mode === 'gui_card') {
    expand.push({
      title: 'Agent',
      items: [
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
          title: '图片',
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
          title: '默认场景',
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
      ]
    })
  }

  return [
    {
      title: '',
      type: 'editorRender',
      options: {
        render: () => <ProjectActionsBar comId={props.id} props={props} />,
      },
    },
    {
      title: 'Figma',
      type: 'figma',
      value: {
        get() {
          return {
            getCanvasList: () => context.getCanvasList(),
            onSync: (items: FigmaImportItem[], rootEl?: Element | null) => {}
          };
        },
      },
    },
    ...expand
    // {
    //   title: '导出',
    //   items: [
    //     {
    //       title: '代码',
    //       type: 'editorRender',
    //       options: {
    //         render: () => <ExportCodePanel comId={props.id} data={props.data} />,
    //       },
    //     },
    //   ],
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
  ];
}
