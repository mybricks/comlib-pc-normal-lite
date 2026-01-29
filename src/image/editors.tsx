import { Data, ObjectFit} from './constants';

export default {
  '@init': ({ style }: EditorResult<Data>) => {
    style.width = '200px';
    style.height = 'auto';
  },
  '@resize': {
    options: ['height', 'width']
  },
  ':root': {
    style: [
      {
        items: [
          {
            title: '默认',
            catelog: '默认',
            options: [
              'border',
              'padding',
              { type: 'background', config: { disableBackgroundImage: true } }
            ],
            target: '.ant-image-img'
          },
          {
            title: 'Hover',
            catelog: 'Hover',
            options: [
              'border',
              'padding',
              { type: 'background', config: { disableBackgroundImage: true } }
            ],
            target: '.ant-image-img:hover'
          }
        ]
      }
    ],
    items: ({}: EditorResult<Data>, cate1) => {
      cate1.title = '常规';
      cate1.items = [
        {
          title: '图片地址',
          type: 'ImageSelector',
          description:
            '嵌入的图片资源的地址或路径，可以使用URL链接或者相对路径，需要确保资源能够正常访问，文件类型需要是jpg、png、base64字符串等图片格式',
          value: {
            get({ data }: EditorResult<Data>) {
              return data.src;
            },
            set({ data }: EditorResult<Data>, value: string) {
              data.src = value;
            }
          },
          binding: {
            with: 'data.src',
            schema: {
              type: 'string'
            }
          }
        },
        {
          title: '填充模式',
          type: 'Select',
          description:
            '指定图片的内容如何适应容器的高度与宽度，可以图片进行保留原始比例的裁剪、缩放或者直接进行拉伸等',
          options: [
            {
              label: '拉伸图片 (fill)',
              value: 'fill'
            },
            {
              label: '按比例缩小，可能会留白 (contain)',
              value: 'contain'
            },
            {
              label: '按比例放大，保证铺满 (cover)',
              value: 'cover'
            },
            {
              label: '原始尺寸 (none)',
              value: 'none'
            }
          ],
          value: {
            get({ data }: EditorResult<Data>) {
              return data.objectFit || 'fill';
            },
            set({ data }: EditorResult<Data>, value: ObjectFit) {
              data.objectFit = value;
            }
          }
        }
      ];
    }
  }
};
