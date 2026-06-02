import React from 'react';
import LowcodeView, {lowcodeViewEvents} from '../lowcodeView';
import lowcodeViewCss from '../lowcodeView/index.lazy.less';
import consoleViewCss from '../lowcodeView/console/index.lazy.less';
import versionViewCss from '../lowcodeView/version/index.lazy.less';
import treeViewCss from '../lowcodeView/tree/index.lazy.less';
import exportCodeCss from './configs/style.lazy.less';
import iconLibraryModalCss from './configs/IconLibraryModal/style.lazy.less';

import * as lowcodeViewCssNS from '../lowcodeView/index.lazy.less';
import * as consoleViewCssNS from '../lowcodeView/console/index.lazy.less';
import * as versionViewCssNS from '../lowcodeView/version/index.lazy.less';
import * as treeViewCssNS from '../lowcodeView/tree/index.lazy.less';
import * as exportCodeCssNS from './configs/style.lazy.less';
import * as iconLibraryModalCssNS from './configs/IconLibraryModal/style.lazy.less';


import context from '../context';
import type {Props} from './types';

const errorSet = new Set();

export function buildHooks(props: Props) {
  return {
    '@error': (err: Error) => {
      const events = context.component!.events
      events.emit('runtimeError', err)
    },

    '@lowcode': {
      render(params: any, plugins: any) {
        context.plugins = plugins;
        const showAIDialog = plugins.showAIDialog;
        (window as any)._showAIDialog_ = showAIDialog;
        return <LowcodeView {...params} />;
      },
      useCSS() {
        function transform(ns) {
          if (ns.default?.locals) {
            return ns.default.locals
          } else {
            return ns
          }
        }

        const genUse = (css) => {
          return css
        }

        return [
          {
            css: transform(lowcodeViewCssNS),
            use: genUse(lowcodeViewCss)
          },
          {
            css: transform(consoleViewCssNS),
            use: genUse(consoleViewCss)
          },
          {
            css: transform(versionViewCssNS),
            use: genUse(versionViewCss)
          },
          {
            css: transform(treeViewCssNS),
            use: genUse(treeViewCss)
          },
          {
            css: transform(exportCodeCssNS),
            use: genUse(exportCodeCss)
          },
          {
            css: transform(iconLibraryModalCssNS),
            use: genUse(iconLibraryModalCss)
          }
        ]
      },
    },

    '@getDocs'(params: any) {
      return {}
      // let result: any = {};

      // try {
      //   const themesData = params?.data?.themes;
      //   if (themesData) {
      //     const activeTheme = themesData.themes?.find((t: any) => t.id === themesData.activeThemeId) || themesData.themes?.[0];
      //     if (activeTheme?.vars) {
      //       (window as any).MYBRICKS_AICOM_THEME_VARIABLES = activeTheme.vars;
      //     }
      //   }
      // } catch (e) {
      //   // console.error('[@getDocs syncTheme error]', e);
      // }

      // try {
      //   const mdCompiled = params.data.files.find((file: any) => file.fileName === 'README.md')?.compiled;
      //   if (mdCompiled) {
      //     const focusElement = params.focusArea.ele;
      //     const parentElement = focusElement.closest('[data-widget-name]');
      //     if (parentElement) {
      //       const widgetName = parentElement.getAttribute('data-widget-name');
      //       const docs = mdCompiled[widgetName];
      //       if (docs) {
      //         result['title'] = docs.title;
      //         result['summary'] = docs.summary;
      //         result['type'] = focusElement.getAttribute('data-zone-type');
      //         const events = focusElement.getAttribute('data-zone-events');
      //         if (events) {
      //           const eventsArray = JSON.parse(events);
      //           result['events'] = eventsArray.reduce((acc: any[], eventId: string) => {
      //             const found = docs.events?.find((event: any) => event.id === eventId);
      //             if (found) acc.push(found);
      //             return acc;
      //           }, []);
      //         }
      //       }
      //     }
      //   }
      // } catch (e) {
      //   // console.error('[@getDocs error]', e);
      // }

      // return result;
    },

    '@getThemes'(_params: any) {
      return [
        {
          varName: 'primary',
          varTitle: '主色调',
          value: {
            get: (_p: any) => 'red',
            set: (_p: any, _v: any) => {
            },
          },
        },
      ];
    },

    '@debug'(params: any, stop: any) {
      const events = context.component!.events;
      if (stop) {
        events.emit('debugTarget', undefined);
        return;
      }

      const page = params.focusArea.ele.closest('[data-desn-page]');
      const pageIndex = page?.getAttribute('data-desn-page');

      if (pageIndex) {
        const pageBCR = page.getBoundingClientRect();
        const rootEl = page.closest('[data-com-title]');
        const rootBCR = rootEl.getBoundingClientRect();
        const rootComputedStyle = window.getComputedStyle(rootEl);

        const paddingLeft = parseFloat(rootComputedStyle.paddingLeft || '0');
        const paddingRight = parseFloat(rootComputedStyle.paddingRight || '0');
        const paddingTop = parseFloat(rootComputedStyle.paddingTop || '0');
        const borderLeft = parseFloat(rootComputedStyle.borderLeftWidth || '0');

        const layoutWidth = rootEl.offsetWidth;
        events.emit('debugTarget', {
          type: 'page',
          pageIndex,
          style: {
            transform: `scale(1) translate(${(pageBCR.left - rootBCR.left) / (rootBCR.width / layoutWidth) - borderLeft - paddingLeft}px, 0px)`,
            width: params.data?.frameStyle?.width ?? page.offsetWidth,
          },
          rootStyle: {
            width: layoutWidth - paddingLeft - paddingRight,
            height: 'fit-content',
          },
        });
      }

      const data = context.component!.params?.data;
      const envNames: string[] = data?._debugEnvs ?? [];
      const debugEnvOptions: { label: string; value: string }[] = [{label: '正式环境', value: 'prod'}];

      let defaultEnv = 'prod'

      if (envNames.includes('mock')) {
        debugEnvOptions.unshift({label: '测试环境', value: 'mock'})
        defaultEnv = 'mock'
      }
      envNames.forEach(name => {
        if (name !== 'mock' && name !== 'prod') {
          debugEnvOptions.push({label: name, value: name});
        }
      });
      // 默认prod模式
      data._activeDebugEnv = defaultEnv

      return debugEnvOptions;
    },

    '@setDebugEnv'(ctx: any, option: { label: string; value: string }) {
      const aiComParams = context.component!.params;
      if (!aiComParams?.data) return;
      aiComParams.data._activeDebugEnv = option?.value ?? 'prod';
      context.component?.actions?.notifyChanged?.();
    },

    '@viewCode'(params: any) {
      const dataLoc = params.focusArea.ele.closest('[data-loc]')?.getAttribute('data-loc');
      if (dataLoc) {
        const loc = JSON.parse(dataLoc);
        const {codeLine, files} = loc;
        if (codeLine && files?.jsx) {
          const {start, end} = codeLine;
          lowcodeViewEvents.emit('viewCode', {fileName: files.jsx, codeLine: [start, end]});
        } else {
          // console.error('[@viewCode] 请重新编译jsx，支持codeLine/files', params);
        }
      } else {
        // console.error('[@viewCode] 未找到 data-loc', params);
      }
    },

    '@openDocs'() {
      const events = context.component!.events
      setTimeout(() => {
        events.emit('openDocs', () => {});
      }, 300)
    },
  };
}
