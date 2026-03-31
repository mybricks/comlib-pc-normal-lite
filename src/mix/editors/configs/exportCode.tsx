import React from 'react';
import ExportCodePanel from '../../../utils/code-export/render';
import context from '../../context';
import type { Props } from '../types';

export function buildExportCodeConfig(props: Props) {
  return [
    {
      title: '导出',
      items: [
        {
          title: '代码',
          type: 'editorRender',
          options: {
            render: () => <ExportCodePanel comId={props.id} data={props.data} />,
          },
        },
      ],
    },
    {
      type: 'themes',
      value: {
        get(params: any) {
          const projectThemes = context.projectConfig.themes;
          return (projectThemes && projectThemes.length > 0) ? projectThemes : params.data.themes;
        },
        set(params: any, themes: any) {
          if(context.projectConfig.themes && context.projectConfig.themes.length > 0) {
            context.projectConfig.themes = themes;
            return
          }
          params.data.themes = themes;
        },
      },
    },
  ];
}
