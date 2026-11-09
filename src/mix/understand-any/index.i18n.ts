import i18n from "../../helpers/i18n";
export const copy = {
  close: () => i18n({ zh: "关闭", en: "Close" }),
  title: () => i18n({ zh: "可视化解读", en: "Visual explain" }),
  document: () => i18n({ zh: "未命名文档", en: "Untitled document" }),
  inspiration: () =>
    i18n({ zh: "让 AI 可视化解读代码", en: "Ask AI to visualize and explain code" }),
  placeholder: () =>
    i18n({
      zh: "请描述下想要可视化展示什么内容",
      en: "Describe what you would like to visualize",
    }),
  placeholderHint: () =>
    i18n({
      zh: "用图解读代码结构、流程或关系",
      en: "Visualize code structure, flows, or relationships",
    }),
  generating: () => i18n({ zh: "正在生成中...", en: "Generating..." }),
  unavailable: () =>
    i18n({
      zh: "请先打开项目并连接 AI",
      en: "Open a project and connect AI first",
    }),
  readError: () =>
    i18n({ zh: "读取图表失败", en: "Could not read diagrams" }),
  diagramRenderError: () =>
    i18n({
      zh: "图表暂时无法显示，已展示原文。",
      en: "The diagram could not be displayed. Showing the source.",
    }),
  choose: () => i18n({ zh: "选择图表", en: "Choose diagram" }),
  details: () => i18n({ zh: "查看说明", en: "View details" }),
  expand: () => i18n({ zh: "放大查看", en: "Expand diagram" }),
  diagramControls: () => i18n({ zh: "图表缩放工具", en: "Diagram zoom controls" }),
  empty: () =>
    i18n({
      zh: "描述想要解读的代码或问题，让 AI 生成图表",
      en: "Describe the code or question to visualize with AI.",
    }),
};
