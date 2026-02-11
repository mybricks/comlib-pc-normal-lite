import context from "../context";
import { parseLess, stringifyLess } from "../utils/transform/less";

export const MYBRICKS_KNOWLEDGES_MAP = {
  CONTAINER: {
    editors: {
      ":root": {
        title: '容器',
        style: [
          {
            title: '布局',
            type: 'layout',
            value: {
              get({ id, focusArea }) {
                const { cn } = JSON.parse(focusArea.dataset.loc);
                const aiComParams = context.getAiComParams(id);
                const cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));

                return cssObj[`.${cn}`];
              },
              set({ id, focusArea }, value) {
                const { cn } = JSON.parse(focusArea.dataset.loc);
                const aiComParams = context.getAiComParams(id);
                const cssObj = parseLess(decodeURIComponent(aiComParams.data.styleSource));
                Object.entries(value).forEach(([key, value]) => {
                  cssObj[`.${cn}`][key] = value;
                })
                const cssStr = stringifyLess(cssObj);
                context.updateFile(id, { fileName: 'style.less', content: cssStr });
              }
            }
          },
          {
            items: [
              {
                title: '样式',
                options: ['Background', 'Border', 'Padding', 'BoxShadow']
              }
            ]
          }
        ]
      }
    }
  }
}

export const HTML_KNOWLEDGES_MAP = new Proxy({}, {
  get() {
    return {
      editors: {
        ":root": {}
      }
    }
  }
})

// export const HTML_KNOWLEDGES_MAP = {
//   DIV: {
//     editors: {
//       ":root": {
//         style: [
//           {
//             items: [
//               {
//                 title: '样式',
//                 autoOptions: true,
//                 // options: ['background', 'border', 'padding', 'margin']
//               }
//             ]
//           }
//         ]
//       }
//     }
//   }
// }
