import context from '../../context';
import { syncStylesFromFigmaJson, saveFigmaSyncBaseline } from '../figma-to-dom/sync';
import type { Props, FigmaImportItem } from '../types';

export function buildPagePanel(props: Props) {
  const comId = props.model?.runtime?.id || props.id;

  return {
    title: '页面',
    items: (pageProps: any, cate1: any) => {
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
                    onSync: (items: FigmaImportItem[], rootEl?: Element | null) =>
                      syncStylesFromFigmaJson(comId, items, { rootEl: rootEl ?? null }),
                    saveBaseline: (rootEl?: Element | null) => saveFigmaSyncBaseline(comId, rootEl ?? null),
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
