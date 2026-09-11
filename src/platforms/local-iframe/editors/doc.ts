import { getClosestDomLoc, getElementCodeLocation, getElementClassNames } from '../../../helpers/dom'
import myContext from '../context'
import { randomUUID } from '../../../mix/utils/uuid'
import { executeLocalShellCommand, readLocalFiles } from '../sandbox'

const ANALYZE_FILE_PATH = '.lingchuang/.local/analyze.md'

export default function () {
  return {
    '@getDoc'(params) {
      const loc = getClosestDomLoc(params.focusArea.ele)
      if (!loc) {
        return ''
      }
      const { files, codeLine } = loc
      const key = myContext.doc.buildKey(files, codeLine)
      return myContext.doc.get(key)
    },
    '@updateDoc'(params, { onComplete }) {
      const ele = params.focusArea.ele
      const loc = getClosestDomLoc(params.focusArea.ele)
      if (!loc) {
        return null
      }
      const { files, codeLine } = loc
      const key = myContext.doc.buildKey(files, codeLine)
      const chipId = randomUUID()
      const label = ele.tagName.toLowerCase()
      const chip = {
        id: chipId,
        label: `分析 ${label}，总结文档`,
        type: 'element-analyze',
        data: {
          inlineText: `执行「${chipId}」，`,
          detailText: [
            `<element-analyze id="${chipId}">`,
            '## 操作意图',
            '分析目标元素及其数据流，将分析结果写入文件 .lingchuang/.local/analyze.md。',
            '',
            '## 目标元素',
            `- 名称：${label}`,
            `- 类名：${getElementClassNames(ele) || '无'}`,
            '  注意：若类名包含当前样式文件的前缀，说明它来自该样式文件。当前 CSS Modules 命名规则为 [filepath]--[local]--[hash:base64:8]。',
            `- 代码位置：${getElementCodeLocation(ele)}`,
            '',
            '</element-analyze>',
          ].join('\n'),
        }
      }
    
      window._sandbox_.helpers.sendToAgent(params.id, {
        message: `[[chip:${chip.id}]]`,
        meta: {
          chips: [chip],
        },
        extra: {
          async onComplete(md?: string) {
            const analyzeFile = (await readLocalFiles([ANALYZE_FILE_PATH]))[0]
            const result = analyzeFile?.content ?? md ?? ''

            if (analyzeFile) {
              executeLocalShellCommand(`rm -f "${ANALYZE_FILE_PATH}"`)
            }

            if (result) {
              myContext.doc.set(key, result)
            }
            onComplete(result)
          }
        }
      });
    },
  }
}
