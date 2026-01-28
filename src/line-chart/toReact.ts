export default function ({ data, style }) {
  const mockData = data.mockData || data.chartData || [
    { year: "1991", value: 3, category: "类型1" },
    { year: "1992", value: 4, category: "类型1" },
    { year: "1993", value: 3.5, category: "类型1" },
    { year: "1994", value: 1, category: "类型1" },
    { year: "1995", value: 2, category: "类型1" },
    { year: "1996", value: 5, category: "类型1" },
  ];

  const { xField = 'year', yField = 'value', seriesField = 'category' } = data.config || {};

  const jsx = `<Line
    style={${JSON.stringify({ width: style.width, height: style.height })}}
    data={${JSON.stringify(mockData)}}
    xField="${xField}"
    yField="${yField}"
    seriesField="${seriesField}"
  />`;

  return {
    imports: [
      {
        from: '@ant-design/charts',
        coms: ['Line']
      }
    ],
    jsx,
    style: ``,
    js: ''
  };
}