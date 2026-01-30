import { transformComStyle } from "../utils/toReact";

export default function ({ id, data, slots, style }) {
  const jsx = `<div 
    className="${id} carouselWrapper" 
    ${transformComStyle({...style, overflow: "hidden"})}
  >
    <Carousel style={{ width: "100%", height: "100%" }}>
      ${data.items.map((item, index) => `<div 
        style={{ width: "100%", height: "100%" }} 
        key={${index}}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            ${item.url ? `background: "url(${item.url}) no-repeat center center",` : ''}
            backgroundSize: "${item.bgSize || 'contain'}",
            backgroundColor: "${item.bgColor?.background || ''}"
          }}
        >
          ${item.slotId ? slots[item.slotId]?.render() : ''}
        </div>
      </div>`).join('')}
    </Carousel>
  </div>`;

  return {
    imports: [
      {
        from: 'antd',
        coms: ['Carousel']
      }
    ],
    jsx,
    style: ``,
    js: ''
  };
}