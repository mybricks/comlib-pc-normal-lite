function i18n<T extends Record<string, Record<string, string>>>(langs: T): { [K in keyof T]: string } {
  return new Proxy(langs, {
    get(target, key) {
      const entry = target[key as keyof T]
      if (!entry) return undefined

      const langType = (window as any).__lang_type__ || 'zh'
      return entry[langType] || entry.zh || `${langType} not found`
    },
  }) as unknown as { [K in keyof T]: string }
}

export default i18n({
  // exportCode
  iconLibrarySettings: { zh: '图标库设置', en: 'Icon Library' },

  // IconLibraryModal
  selectFromIconLibrary: { zh: '从图标库选择', en: 'Select Icon' },
  deleteIconLibrary: { zh: '删除图标库', en: 'Delete library' },
  unnamedIconLibrary: { zh: '未命名图标库', en: 'Unnamed library' },
  iconCountPrefix: { zh: '共', en: '' },
  iconCountSuffix: { zh: '个图标', en: 'icons' },
  aiInputPlaceholderOverview: { zh: '告诉 AI 你还需要什么图标库…', en: 'Tell AI what icon library you need…' },
  backBtn: { zh: '← 返回', en: '← Back' },
  iconLibraryFallback: { zh: '图标库', en: 'Icon Library' },
  useIcon: { zh: '使用', en: 'Use' },
  emptyIconLibrary: { zh: '当前图标库暂无图标', en: 'No icons in this library' },
  aiInputPlaceholderDetail: { zh: '告诉 AI 你想怎么改这个图标', en: 'Tell AI how to edit this icon' },
  // ImgEditor
  clickToPreview: { zh: '点击查看大图', en: 'Click to preview' },
  uploadAndReplace: { zh: '上传图片进行替换', en: 'Upload to replace' },
  uploadWithAI: { zh: '上传图片，AI 帮你替换', en: 'Upload image, AI will replace it' },
  changeImage: { zh: '更改图片', en: 'Change image' },
  downloadImage: { zh: '下载图片', en: 'Download image' },
  imagePanelTitle: { zh: '图片', en: 'Image' },
  // EmptyState
  noIconLibraryTitle: { zh: '还没有图标库', en: 'No icon library yet' },
  noIconLibrarySubtitle: { zh: '描述你想要的风格，让 AI 帮你生成', en: 'Describe the style you want and let AI generate it' },
  // AIInputBar
  generateIconLibrary: { zh: '生成图标库', en: 'Generate icon library' },
  aiInputBarDefaultPlaceholder: { zh: '描述你想要的图标库，如「简约风格的电商图标库」', en: 'Describe an icon library, e.g. "minimal e-commerce icons"' },
  svgPresetLine: { zh: '线条风格', en: 'Line style' },
  svgPresetFill: { zh: '填充风格', en: 'Fill style' },
  svgPresetFlat: { zh: '扁平设计', en: 'Flat design' },
  svgPresetMono: { zh: '单色图标', en: 'Monochrome' },
  // AiEditPanel
  sendBtn: { zh: '发送', en: 'Send' },
  svgPanelPlaceholder: { zh: '描述你想要的图标，如 蓝色搜索图标', en: 'Describe the icon you want, e.g. blue search icon' },
  imgPanelPlaceholder: { zh: '描述你想要的图片，如 夏日冲浪海报', en: 'Describe the image you want, e.g. summer surf poster' },
  toolbarModel: { zh: '模型', en: 'Model' },
  toolbarStyle: { zh: '风格', en: 'Style' },
  toolbarRatio: { zh: '比例', en: 'Ratio' },
  toolbarQuality: { zh: '画质', en: 'Quality' },
  styleGeneral: { zh: '通用', en: 'General' },
  stylePhoto: { zh: '写实摄影', en: 'Photography' },
  styleIllustration: { zh: '插画', en: 'Illustration' },
  stylePoster: { zh: '产品海报', en: 'Product poster' },
  styleFlatDesign: { zh: '扁平设计', en: 'Flat design' },
  styleVibrant: { zh: '高饱和配色', en: 'Vibrant colors' },
  qualitySD: { zh: '标清', en: 'SD' },
  qualityHD: { zh: '高清', en: 'HD' },
  qualityUHD: { zh: '超清', en: 'UHD' },
  // PagePanel
  uiDesignTitle: { zh: 'UI 设计', en: 'UI Design' },
  // SvgEditor / IconEditor
  iconEditorTitle: { zh: '图标', en: 'Icon' },
  selectFromIconLibraryTip: { zh: '从AI生成的图标库中进行选择', en: 'Select from AI-generated icon library' },
  uploadSvg: { zh: '上传SVG', en: 'Upload SVG' },
  noPreviewAvailable: { zh: '无法预览', en: 'No preview available' },
  downloadSvg: { zh: '下载SVG', en: 'Download SVG' },
  svgGenMessagePrefix: { zh: '调用图标生成工具，生成图标，用户需求：', en: 'Call the icon generation tool to generate an icon, user requirement: ' },
  imgGenMessagePrefix: { zh: '调用图片生成工具，生成图片，用户需求：', en: 'Call the image generation tool to generate an image, user requirement: ' },
})
