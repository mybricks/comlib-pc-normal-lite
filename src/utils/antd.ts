import { message } from 'antd';

message.config({
  getContainer: () => {
    // 不挂#_geoview-wrapper_ [data-canvas='debug']的话，提示不居中，shadowRoot宽度比调试的画布要快
    // const container = document.getElementById('_mybricks-geo-webview_')?.shadowRoot;
    // 挂#_geoview-wrapper_ [data-canvas='debug']，取消调试时如果message还没结束，下去调试还会再弹出来
    const container = document.getElementById('_mybricks-geo-webview_')?.shadowRoot?.querySelector("#_geoview-wrapper_ [data-canvas='debug']");
    return container as HTMLElement;
  }
})
