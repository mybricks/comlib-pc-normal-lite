import { getPropsFromObject } from '../utils/toReact';

export default function ({ data }) {

    const propsStr = getPropsFromObject({
    style: {
      wordBreak: 'break-all'
    },
  });

  const jsx = `<div
>
<Typography.Text
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
