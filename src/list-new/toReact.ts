import { Data, Layout } from './constants';

export default function ({ data, slots }: { data: Data; slots: any }) {
  // 获取插槽内容
  const slotContent = slots?.item?.render() || '';

  // 根据布局类型生成不同的 JSX
  let jsx = '';

  if (data.layout === Layout.Vertical) {
    // 垂直布局
    jsx = `<div className="list-new__root" style={{ width: '100%', height: '100%' }}>
  {${JSON.stringify(data.dataSource || [])}?.map((item, index) => (
    <div key={index} className="list-new__item" style={{ marginBottom: '${data.grid?.gutter?.[1] || 16}px' }}>
      ${slotContent}
    </div>
  ))}
</div>`;
  } else if (data.layout === Layout.Horizontal) {
    // 横向布局
    const isUniform = data.horizonLayout === 'UniformLayout';
    jsx = `<div className="list-new__root" style={{ 
  width: '100%', 
  height: '100%', 
  overflowX: 'auto',
  whiteSpace: 'nowrap',
  ${isUniform ? "display: 'flex', justifyContent: 'space-between'" : ''}
}}>
  {${JSON.stringify(data.dataSource || [])}?.map((item, index) => (
    <div 
      key={index} 
      className="list-new__item" 
      style={{ 
        display: 'inline-block',
        width: '${data.itemWidth || 'auto'}',
        marginRight: '${data.grid?.gutter?.[0] || 0}px'
      }}
    >
      ${slotContent}
    </div>
  ))}
</div>`;
  } else if (data.layout === Layout.Grid) {
    // 栅格布局
    const column = data.grid?.column || 3;
    jsx = `<List
  grid={{ column: ${column}, gutter: ${JSON.stringify(data.grid?.gutter || [0, 16])} }}
  dataSource={${JSON.stringify(data.dataSource || [])}}
  renderItem={(item, index) => (
    <List.Item key={index} className="list-new__item">
      ${slotContent}
    </List.Item>
  )}
/>`;
  }

  return {
    imports: [
      {
        from: 'antd',
        coms: ['List']
      }
    ],
    jsx,
    style: ``,
    js: ''
  };
}
