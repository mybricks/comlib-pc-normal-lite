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

export function buildExportCodeConfig(props: Props) {

  const mode = config.getFrontendMode()
  const expand: any[] = []
  if (mode === 'gui_card') {
    expand.push({
      title: 'Agent',
      items: [
        {
          title: '主标题',
          type: 'text',
          value: {
            get(params) {
              if (!params.data.gui_card) {
                params.data.gui_card = {
                  title: '欢迎使用',
                  titleHighlight: 'AI 助手',
                  subtitle: '你可以向我提问'
                }
              }

              return params.data.gui_card.title
            },
            set(params, value) {
              const trimValue = value.trim()
              if (trimValue) {
                params.data.gui_card = {
                  ...params.data.gui_card,
                  title: trimValue
                }
              }
            }
          }
        },
        {
          title: '高亮文字',
          type: 'text',
          description: '主标题中高亮展示的部分',
          value: {
            get(params) {
              return params.data.gui_card.titleHighlight
            },
            set(params, value) {
              const trimValue = value.trim()
              if (trimValue) {
                params.data.gui_card = {
                  ...params.data.gui_card,
                  titleHighlight: trimValue
                }
              }
            }
          }
        },
        {
          title: '副标题',
          type: 'text',
          value: {
            get(params) {
              return params.data.gui_card.subtitle
            },
            set(params, value) {
              const trimValue = value.trim()
              if (trimValue) {
                params.data.gui_card = {
                  ...params.data.gui_card,
                  subtitle: trimValue
                }
              }
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
