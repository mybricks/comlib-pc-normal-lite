import i18n from "../../helpers/i18n";
export const copy = {
  close: () => i18n({ zh: "关闭", en: "Close" }),
  title: () => i18n({ zh: "业务图", en: "Business diagrams" }),
  inspiration: () =>
    i18n({ zh: "让 AI 绘制业务图", en: "Ask AI to draw a business diagram" }),
  placeholder: () =>
    i18n({
      zh: "描述要可视化的业务内容和逻辑",
      en: "Describe the business content and logic to visualize",
    }),
  placeholderAction: () => i18n({ zh: "点击生成", en: "Click to generate" }),
  placeholderSubject: () =>
    i18n({ zh: "可视化业务逻辑", en: " visual business logic" }),
  generating: () => i18n({ zh: "业务图生成中", en: "Generating diagram" }),
  unavailable: () =>
    i18n({
      zh: "请先打开项目并连接 AI",
      en: "Open a project and connect AI first",
    }),
  readError: () =>
    i18n({ zh: "读取业务图失败", en: "Could not read business diagrams" }),
  diagramFallback: () =>
    i18n({
      zh: "暂不支持此图的语法，已展示原文。",
      en: "This diagram syntax is not supported yet. Showing the source.",
    }),
  choose: () => i18n({ zh: "选择业务图", en: "Choose diagram" }),
  details: () => i18n({ zh: "查看说明", en: "View details" }),
  expand: () => i18n({ zh: "放大查看", en: "Expand diagram" }),
  empty: () =>
    i18n({
      zh: "描述业务或目录，让 AI 生成业务图",
      en: "Describe a business or directory to generate a diagram with AI.",
    }),
};
