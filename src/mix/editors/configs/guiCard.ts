export function ensureGuiCard(data: any) {
  if (!data.gui_card) {
    data.gui_card = {}
  }

  data.gui_card.assistantTitle ??= '智能助手'
  data.gui_card.icon ??= 'https://f2.eckwai.com/kos/nlav12333/aicode/logo/newlogo.png'
  data.gui_card.title ??= '欢迎使用'
  data.gui_card.titleHighlight ??= 'AI 助手'
  data.gui_card.subtitle ??= '你可以向我提问'
  data.gui_card.colorPrimary ??= '#FA6400'

  return data.gui_card
}

export function getGuiCardField(params: EditorResult<any>, key: string) {
  return ensureGuiCard(params.data)[key]
}

export function setGuiCardField(params: EditorResult<any>, key: string, value: any) {
  const nextValue = typeof value === 'string' ? value.trim() : value
  if (nextValue === '' || nextValue == null) {
    return
  }

  const guiCard = ensureGuiCard(params.data)
  params.data.gui_card = {
    ...guiCard,
    [key]: nextValue
  }
}

export function buildGuiCardPromptItems() {
  return [
    {
      title: '人格',
      type: 'textarea',
      options: {
        autoSize: {minRows: 7},
        // vCenter: true,
        placeholder: `定义智能体的 名称、说话风格、核心定位、原则、底线。

## 名称
你是XX

## 说话风格
你是言语锐利的点评者

## 核心定位

## 工作原则

## 底线`,
      },
      value: {
        get(params: EditorResult<any>) {
          return getGuiCardField(params, 'soulMd')
        },
        set(params: EditorResult<any>, value: any) {
          setGuiCardField(params, 'soulMd', value)
        }
      }
    },
    {
      title: '操作手册',
      type: 'textarea',
      options: {
        autoSize: {minRows: 2},
        placeholder: `定义智能体的操作手册，行为方式`,
      },
      value: {
        get(params: EditorResult<any>) {
          return getGuiCardField(params, 'agentsMd')
        },
        set(params: EditorResult<any>, value: any) {
          setGuiCardField(params, 'agentsMd', value)
        }
      }
    },
  ]
}
