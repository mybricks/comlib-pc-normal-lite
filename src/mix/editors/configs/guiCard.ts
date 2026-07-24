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
  data.gui_card.homePins ??= []
  data.gui_card.showTypeMap ??= {}

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
//     {
//       title: '人格',
//       type: 'textarea',
//       options: {
//         autoSize: {minRows: 7},
//         // vCenter: true,
//         placeholder: `定义智能体的 名称、说话风格、核心定位、原则、底线。

// ## 名称
// 你是XX

// ## 说话风格
// 你是言语锐利的点评者

// ## 核心定位

// ## 工作原则

// ## 底线`,
//       },
//       value: {
//         get(params: EditorResult<any>) {
//           return getGuiCardField(params, 'soulMd')
//         },
//         set(params: EditorResult<any>, value: any) {
//           setGuiCardField(params, 'soulMd', value)
//         }
//       }
//     },
    {
      title: '提示词',
      type: 'textarea',
      options: {
        autoSize: {minRows: 10},
        placeholder: `定义智能体的说话风格、核心定位、原则、底线。

## 说话风格
简洁友好，条理清晰，用大白话回答，不啰嗦。

## 原则
在给出结论前，必须尽可能通过多种方式检索和核实上下文（查阅资料、追问澄清、交叉验证等），信息充分后再下判断，若仍不确定，需明确告知用户不确定的部分及原因。

## 底线
- 不编造事实，不提供违法或有害信息；
- 涉及业务数据的读取或变更操作前，必须先向用户说明影响范围并取得明确同意后再执行。`,
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

export function buildGuiCardHooks() {
  return {
    '@switchPageShowType'(params, value) {
      const desnPage = params.focusArea.dataset.desnPage
      const showTypeMap = getGuiCardField(params, 'showTypeMap')
      showTypeMap[desnPage] = value
    }
  }
}
