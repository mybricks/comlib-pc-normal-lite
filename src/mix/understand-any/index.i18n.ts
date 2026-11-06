import i18n from "../../helpers/i18n";
export const copy = {
  close: () => i18n({ zh: "关闭", en: "Close" }),
  title: () => i18n({ zh: "业务图", en: "Business diagrams" }),
  inspiration: () =>
    i18n({ zh: "让 AI 绘制业务图", en: "Ask AI to draw a business diagram" }),
  placeholder: () =>
    i18n({
      zh: "描述要可视化的业务流程",
      en: "Describe the business flow to visualize",
    }),
  placeholderHint: () =>
    i18n({
      zh: "用可视化的方式展示业务流程",
      en: "Visualize your business flow",
    }),
  generating: () => i18n({ zh: "正在生成中...", en: "Generating..." }),
  unavailable: () =>
    i18n({
      zh: "请先打开项目并连接 AI",
      en: "Open a project and connect AI first",
    }),
  readError: () =>
    i18n({ zh: "读取业务图失败", en: "Could not read business diagrams" }),
  diagramRenderError: () =>
    i18n({
      zh: "图表暂时无法显示，已展示原文。",
      en: "The diagram could not be displayed. Showing the source.",
    }),
  choose: () => i18n({ zh: "选择业务图", en: "Choose diagram" }),
  details: () => i18n({ zh: "查看说明", en: "View details" }),
  expand: () => i18n({ zh: "放大查看", en: "Expand diagram" }),
  diagramControls: () => i18n({ zh: "图表缩放工具", en: "Diagram zoom controls" }),
  empty: () =>
    i18n({
      zh: "描述业务或目录，让 AI 生成业务图",
      en: "Describe a business or directory to generate a diagram with AI.",
    }),
};
