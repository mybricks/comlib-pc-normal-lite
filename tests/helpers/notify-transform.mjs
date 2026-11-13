import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const readSource = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const helperUrl = moduleUrl(stripTypeScriptTypes(await readSource('src/helpers/ai-code/transformForNotifyChanged.ts')))
const adapterUrl = async path => moduleUrl(stripTypeScriptTypes(await readSource(path))
  .replace(/'[^']*helpers\/ai-code\/transformForNotifyChanged'/, JSON.stringify(helperUrl)))

export const mainTransformUrl = await adapterUrl('src/mix/context/notifyChanged.ts')
export const localTransformUrl = await adapterUrl('src/platforms/local-iframe/sandbox/notifyChanged.ts')
export const { transformNewFormatForNotifyChanged: transformMain } = await import(mainTransformUrl)
export const { transformLocalIframeFormatForNotifyChanged: transformLocal } = await import(localTransformUrl)
