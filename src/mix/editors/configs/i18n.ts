function i18n(langs: Record<string, string>): string {
  const type = (window as any).__lang_type__;
  if (type && langs[type]) {
    return langs[type];
  }
  return langs['zh'] || 'zh not found';
}

const lang = {
  // exportCode
  iconLibrarySettings: i18n({ zh: '图标库设置', en: 'Icon Library' }),

  // IconLibraryModal
  selectFromIconLibrary: i18n({ zh: '从图标库选择', en: 'Select Icon' }),
  deleteIconLibrary: i18n({ zh: '删除图标库', en: 'Delete library' }),
  unnamedIconLibrary: i18n({ zh: '未命名图标库', en: 'Unnamed library' }),
  iconCountPrefix: i18n({ zh: '共', en: '' }),
  iconCountSuffix: i18n({ zh: '个图标', en: 'icons' }),
  aiInputPlaceholderOverview: i18n({ zh: '告诉 AI 你还需要什么图标库…', en: 'Tell AI what icon library you need…' }),
  backBtn: i18n({ zh: '← 返回', en: '← Back' }),
  iconLibraryFallback: i18n({ zh: '图标库', en: 'Icon Library' }),
  useIcon: i18n({ zh: '使用', en: 'Use' }),
  emptyIconLibrary: i18n({ zh: '当前图标库暂无图标', en: 'No icons in this library' }),
  aiInputPlaceholderDetail: i18n({ zh: '告诉 AI 你想怎么改这个图标', en: 'Tell AI how to edit this icon' }),
  // ImgEditor
  clickToPreview: i18n({ zh: '点击查看大图', en: 'Click to preview' }),
  uploadAndReplace: i18n({ zh: '上传图片进行替换', en: 'Upload to replace' }),
  uploadWithAI: i18n({ zh: '上传图片，AI 帮你替换', en: 'Upload image, AI will replace it' }),
  changeImage: i18n({ zh: '更改图片', en: 'Change image' }),
  downloadImage: i18n({ zh: '下载图片', en: 'Download image' }),
  imagePanelTitle: i18n({ zh: '图片', en: 'Image' }),
  // EmptyState
  noIconLibraryTitle: i18n({ zh: '还没有图标库', en: 'No icon library yet' }),
  noIconLibrarySubtitle: i18n({ zh: '描述你想要的风格，让 AI 帮你生成', en: 'Describe the style you want and let AI generate it' }),
  // AIInputBar
  generateIconLibrary: i18n({ zh: '生成图标库', en: 'Generate icon library' }),
  aiInputBarDefaultPlaceholder: i18n({ zh: '描述你想要的图标库，如「简约风格的电商图标库」', en: 'Describe an icon library, e.g. "minimal e-commerce icons"' }),
  svgPresetLine: i18n({ zh: '线条风格', en: 'Line style' }),
  svgPresetFill: i18n({ zh: '填充风格', en: 'Fill style' }),
  svgPresetFlat: i18n({ zh: '扁平设计', en: 'Flat design' }),
  svgPresetMono: i18n({ zh: '单色图标', en: 'Monochrome' }),
  // AiEditPanel
  sendBtn: i18n({ zh: '发送', en: 'Send' }),
  svgPanelPlaceholder: i18n({ zh: '描述你想要的图标，如 蓝色搜索图标', en: 'Describe the icon you want, e.g. blue search icon' }),
  imgPanelPlaceholder: i18n({ zh: '描述你想要的图片，如 夏日冲浪海报', en: 'Describe the image you want, e.g. summer surf poster' }),
  toolbarModel: i18n({ zh: '模型', en: 'Model' }),
  toolbarStyle: i18n({ zh: '风格', en: 'Style' }),
  toolbarRatio: i18n({ zh: '比例', en: 'Ratio' }),
  toolbarQuality: i18n({ zh: '画质', en: 'Quality' }),
  styleGeneral: i18n({ zh: '通用', en: 'General' }),
  stylePhoto: i18n({ zh: '写实摄影', en: 'Photography' }),
  styleIllustration: i18n({ zh: '插画', en: 'Illustration' }),
  stylePoster: i18n({ zh: '产品海报', en: 'Product poster' }),
  styleFlatDesign: i18n({ zh: '扁平设计', en: 'Flat design' }),
  styleVibrant: i18n({ zh: '高饱和配色', en: 'Vibrant colors' }),
  qualitySD: i18n({ zh: '标清', en: 'SD' }),
  qualityHD: i18n({ zh: '高清', en: 'HD' }),
  qualityUHD: i18n({ zh: '超清', en: 'UHD' }),
  // PagePanel
  uiDesignTitle: i18n({ zh: 'UI 设计', en: 'UI Design' }),
  // SvgEditor / IconEditor
  iconEditorTitle: i18n({ zh: '图标', en: 'Icon' }),
  selectFromIconLibraryTip: i18n({ zh: '从AI生成的图标库中进行选择', en: 'Select from AI-generated icon library' }),
  uploadSvg: i18n({ zh: '上传SVG', en: 'Upload SVG' }),
  noPreviewAvailable: i18n({ zh: '无法预览', en: 'No preview available' }),
  downloadSvg: i18n({ zh: '下载SVG', en: 'Download SVG' })
};

export default lang;
