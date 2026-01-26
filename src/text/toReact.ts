import { getPropsFromObject } from '../utils/toReact';
import css from "./runtime.less"

export default function ({ data,style }) {
  // const style = { ...data.style };
  delete style.styleEditorUnfold;

    const propsStr = getPropsFromObject({
    style: {
      ...style,
      wordBreak: 'break-all'
    },
  });

  const jsx = `<div
>
<Typography.Text
      className=${css.text}
  ${propsStr}
>
  ${data.content || ''}
</Typography.Text>
</div>
`;

  return {
    imports: [
      {
        from: 'antd',
        coms: ['Typography']
      },
      {
        from: 'antd/dist/antd.css',
        coms: []
      }
    ],
    jsx,
    style: '',
    js: ''
  };
}
