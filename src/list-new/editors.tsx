import { Data } from './constants';
import { LayoutEditor } from './editor/layoutEditor';

export default {
  ':slot': {},
  '@init': ({ style }) => {
    style.height = 'auto';
  },
  '@resize': {
    options: ['width', 'height']
  },
  ':root': {
    style: [
      {
        title: '容器',
        options: [
          'border',
          'padding',
          { type: 'background', config: { disableBackgroundImage: true } },
          'BoxShadow'
        ],
        target: '> .list-new__root'
      },
      {
        title: '列表项（运行时生效）',
        options: [
          'border',
          'padding',
          { type: 'background', config: { disableBackgroundImage: true } },
          'BoxShadow'
        ],
        target: '.list-new__item'
      }
    ],
    items: ({}: EditorResult<Data>, cate1) => {
      cate1.title = '布局';
      cate1.items = [
        {
          title: '数据源',
          type: 'json',
          value: {
            get({ data }: EditorResult<Data>) {
              return data.dataSource || [];
            },
            set({ data }: EditorResult<Data>, dataSource: any[]) {
              data.dataSource = dataSource;
            }
          },
          binding: {
            with: 'data.dataSource',
            schema: {
              type: 'array'
            }
          }
        },
        ...LayoutEditor
      ];
    }
  }
};
