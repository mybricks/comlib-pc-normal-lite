import { randomUUID } from '../../../mix/utils/uuid'
import { getElementCodeLocation } from '../../../helpers/dom'

export default function ({ id, focusArea }) {
  const ele = focusArea.ele
  const testDocument = ele.ownerDocument
  const codeLocation = getElementCodeLocation(ele)

  // @ts-ignore
  window.__APP__.runTestEvents.emit('test', {
    document: testDocument,
    window: testDocument.defaultView
  })

  const chipId = randomUUID()
  const label = ele.tagName.toLowerCase()

  const chip = {
    id: chipId,
    label: `测试 ${label}`,
    type: 'element-test',
    data: {
      inlineText: `执行「${chipId}」，`,
      detailText: [
        `<element-test id="${chipId}">`,
        '# 使用 SKILL： web-control',
        '',
        '## 操作意图',
        '阅读测试目标元素的对应代码，理解上下文，编写测试脚本进行功能测试',
        '',
        '## 测试目标元素',
        `- 名称：${label}`,
        `- 代码位置：${codeLocation}`,
        '</element-test>',
      ].join('\n'),
    }
  }

  window._sandbox_.helpers.sendToAgent(id, {
    message: `[[chip:${chip.id}]]`,
    meta: {
      chips: [chip],
    },
  });
}
