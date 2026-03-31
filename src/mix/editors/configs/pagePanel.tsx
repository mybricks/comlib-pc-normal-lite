import React from 'react';
import context from '../../context';
import { syncStylesFromFigmaJson } from '../figma-to-dom/sync';
import { ExportFigmaBtn } from '../dom-to-figma/ExportBtn';
import { DownloadFigmaPlugin } from '../dom-to-figma/DownloadPlugin';
import type { Props } from '../types';
import type { FigmaImportItem } from '../types';

const figmaUiButtonStyle: React.CSSProperties = {
  cursor: 'pointer',
  width: '100%',
  textAlign: 'center',
  height: '26px',
  lineHeight: '26px',
  borderRadius: 6,
  border: '1px solid rgba(2, 9, 16, 0.13)',
  backgroundColor: 'var(--mybricks-bg-color-hover, #F5F5F5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  color: 'var(--mybricks-text-color-main)',
  padding: 0,
  boxSizing: 'border-box',
};

export function buildPagePanel(props: Props) {
  const comId = props.model?.runtime?.id || props.id;

  return {
    title: '页面',
    items: (pageProps: any, cate1: any) => {
      const { focusArea } = pageProps;

      cate1.title = '页面';
      cate1.items = [
        {
          title: 'UI设计',
          items: [
            {
              title: '导出到 Figma',
              type: 'editorRender',
              options: {
                render: () => (
                  <ExportFigmaBtn
                    buttonStyle={figmaUiButtonStyle}
                    focusArea={focusArea}
                    comId={comId}
                  />
                ),
              },
            },
            {
              title: '从 Figma 同步样式',
              type: 'editorRender',
              options: {
                render: () => (
                  <div style={{ padding: '4px 0' }}>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.readText().then(
                          (text) => {
                            if (!text || String(text).trim() === '') {
                              alert('剪切板无内容，请先从 Figma 复制后再同步');
                              return;
                            }
                            try {
                              const parsed = JSON.parse(text);
                              const figmaItems: FigmaImportItem[] = Array.isArray(parsed) ? parsed : [parsed];
                              syncStylesFromFigmaJson(comId, figmaItems);
                            } catch (e) {
                              console.error('[从 Figma 同步页面] 剪切板内容不是合法 JSON', e);
                              alert('剪切板内容不是合法 JSON，请确认已从 Figma 正确复制');
                            }
                          },
                          (err) => {
                            console.error('[从 Figma 同步页面] 读取剪切板失败', err);
                            alert('读取剪切板失败，请检查浏览器权限或剪切板是否有内容');
                          }
                        );
                      }}
                      style={figmaUiButtonStyle}
                    >
                      从 Figma 同步样式
                    </button>
                  </div>
                ),
              },
            },
            {
              title: '下载Figma插件',
              type: 'editorRender',
              options: {
                render: () => <DownloadFigmaPlugin buttonStyle={figmaUiButtonStyle} />,
              },
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
          ],
        },
      ];
      return;
    },
  };
}
