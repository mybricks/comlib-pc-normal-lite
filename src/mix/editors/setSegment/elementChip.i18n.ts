import getI18n from '../../../helpers/i18n'

type Placement = 'before' | 'after' | 'child'
export const elementChipI18n = {
  delete: (chip: string) => getI18n({ zh: `删除 ${chip}.`, en: `Delete ${chip}.` }),
  text: (chip: string, content: string) => getI18n({ zh: `将 ${chip} 文本修改为「${content}」.`, en: `Change the text of ${chip} to "${content}".` }),
  image: (chip: string, src: string) => getI18n({ zh: `将 ${chip} 图片地址修改为「${src}」.`, en: `Change the image URL of ${chip} to "${src}".` }),
  svg: (chip: string) => getI18n({ zh: `将 ${chip} JSX 替换为：`, en: `Replace the JSX of ${chip} with:` }),
  style: (chip: string) => getI18n({ zh: `调整 ${chip} 样式：`, en: `Update the styles of ${chip}:` }),
  removeStyle: (property: string) => getI18n({ zh: `  - 删除 ${property}`, en: `  - Remove ${property}` }),
  updateStyle: (property: string, value: string | number) => getI18n({ zh: `  - 更新 ${property} ${value}`, en: `  - Update ${property} to ${value}` }),
  textNode: (text?: string) => getI18n({ zh: text ? ` 内的文本节点「${text}」` : ' 内的文本节点', en: text ? ` text node "${text}"` : ' text node' }),
  textNodeLabel: () => getI18n({ zh: '文本节点', en: 'text node' }),
  move: (from: string, to: string, placement: Placement) => getI18n({
    zh: `将 ${from} 移动到 ${to} ${{ before: '前', after: '后', child: '内' }[placement]}.`,
    en: `Move ${from} ${{ before: 'before', after: 'after', child: 'inside' }[placement]} ${to}.`,
  }),
  duplicate: (chip: string) => getI18n({ zh: `复制 ${chip}，将复制出的完整节点插入到原节点之后，并与原节点保持同级.`, en: `Duplicate ${chip} and insert the complete copy immediately after it as a sibling.` }),
  insert: (target: string, placement: Placement) => getI18n({
    zh: `在 ${target} ${{ before: '前', after: '后', child: '内' }[placement]} 插入 JSX 片段：`,
    en: `Insert the following JSX ${{ before: 'before', after: 'after', child: 'inside' }[placement]} ${target}:`,
  }),
  noText: () => getI18n({ zh: '无可识别文本', en: 'No recognizable text' }),
  noOtherStyles: () => getI18n({ zh: '无（除本次目标样式外）', en: 'None (excluding the styles being modified)' }),
}
