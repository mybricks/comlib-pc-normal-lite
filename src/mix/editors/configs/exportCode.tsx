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
          if (params.data._themesModified) {
            return params.data.themes;
          }
          const projectThemes = context.projectConfig.themes;
          return (projectThemes && projectThemes.length > 0) ? projectThemes : params.data.themes;
        },
        set(params: any, themes: any) {
          params.data._themesModified = true;
          params.data.themes = themes;
        },
      },
    },
  ];
}
