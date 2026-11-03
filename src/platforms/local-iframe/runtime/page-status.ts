import context from '../../../mix/context'
import commonLang from '../../../helpers/i18n/common'
import { parseInteractiveScripts } from '../../../utils/ai-code/interactiveScripts'
import { readLocalFiles } from '../sandbox'
import myContext from '../context'
import { getPagePathWithBase } from './page-path'

type PageRoute = { path: string; src: string }

const activeZoneStatusKeys = new Map<string, string>()
let requestSequence = 0
const latestRequests = new Map<string, number>()
let debugTargetSrc = ''
const originalValues = new WeakMap<Window, Map<string, Map<string, unknown>>>()
const notifiedDocuments = new WeakMap<Window, Document>()

function resetMock(frameWindow: Window, locationId: string) {
  const mock = (frameWindow as any).__LINGSTYLE_DISPLAY_MOCK__
  if (!mock) return
  const locations = originalValues.get(frameWindow)
  locations?.get(locationId)?.forEach((value, key) => {
    mock[key] = value
  })
  locations?.delete(locationId)
}

function runScript(frameWindow: Window, locationId: string, script: string) {
  const mock = (frameWindow as any).__LINGSTYLE_DISPLAY_MOCK__
  const before = mock ? new Map<string, unknown>(Object.keys(mock).map((key) => [key, mock[key]])) : new Map<string, unknown>()
  try {
    ;(frameWindow as any).eval(script)
  } finally {
    if (mock) {
      const locations = originalValues.get(frameWindow) ?? new Map<string, Map<string, unknown>>()
      const originals = locations.get(locationId) ?? new Map<string, unknown>()
      new Set([...before.keys(), ...Object.keys(mock)]).forEach((key) => {
        if (!originals.has(key) && !Object.is(before.get(key), mock[key])) originals.set(key, before.get(key))
      })
      locations.set(locationId, originals)
      originalValues.set(frameWindow, locations)
    }
  }
}

export function setLocalDebugTarget(src: string, routes: PageRoute[]) {
  if (src === debugTargetSrc) return
  const previousSrc = debugTargetSrc
  debugTargetSrc = src

  if (src) {
    const route = routes.find((item) => item.src === src)
    const frameWindow = route && myContext.iframes.get(route.path)?.get(route.src)?.doc?.defaultView
    if (frameWindow) {
      const locationIds = [...(originalValues.get(frameWindow)?.keys() ?? [])]
      locationIds.reverse().forEach((locationId) => {
        resetMock(frameWindow, locationId)
      })
    }
  }

  if (previousSrc) {
    const route = routes.find((item) => item.src === previousSrc)
    if (route) void notifyLocalPageStatuses([route], true)
  }
}

export async function notifyLocalPageStatuses(routes: PageRoute[], reapplyActive = false) {
  const request = ++requestSequence
  routes.forEach(({ path }) => latestRequests.set(path, request))
  const projectDirectory = window.__LINGCHUANG_CONFIG__?.projectStartupDirectory
  let pagesScripts: ReturnType<typeof parseInteractiveScripts> = []
  try {
    if (projectDirectory) {
      const path = `${projectDirectory.replace(/\/$/, '')}/.lingchuang/display-mock/interactive-scripts.yaml`
      const file = (await readLocalFiles([path]))[0]
      if (file) pagesScripts = parseInteractiveScripts(file.content)
    }
  } catch (error) {
    console.error('Failed to read interactive scripts', error)
  }
  const seenPaths = new Set<string>()
  routes.forEach(({ path, src }) => {
    if (seenPaths.has(path)) return
    seenPaths.add(path)
    if (latestRequests.get(path) !== request) return
    const pagePath = getPagePathWithBase(path)
    const doc = myContext.iframes.get(path)?.get(src)?.doc
    const frameWindow = doc?.defaultView
    const page = pagesScripts.find((entry) => entry.page === pagePath)
      ?? pagesScripts.find((entry) => entry.page === path)
    if (!page || !frameWindow) {
      context.component?.actions.notifyPageStatus?.(src, doc?.querySelector('[data-zone-status]') ? [] : null)
      return
    }

    const documentChanged = notifiedDocuments.get(frameWindow) !== doc
    if (documentChanged) {
      notifiedDocuments.set(frameWindow, doc)
      originalValues.delete(frameWindow)
    }

    context.component?.actions.notifyPageStatus?.(src, page.locations.map(({ title, fileName, loc, scripts }) => {
      const locationKey = [pagePath, fileName, loc]
      const locationId = JSON.stringify(locationKey)
      const normalKey = JSON.stringify([...locationKey, 'normal'])
      return {
        title,
        items: [
          {
            title: commonLang.normal,
            activated: activeZoneStatusKeys.get(locationId) === normalKey,
            switchTo: () => {
              activeZoneStatusKeys.set(locationId, normalKey)
              resetMock(frameWindow, locationId)
            }
          },
          ...scripts.map(({ title: scriptTitle, script }, scriptIndex) => {
            const scriptKey = JSON.stringify([...locationKey, 'script', scriptTitle, scriptIndex])
            const item = {
              title: scriptTitle,
              activated: activeZoneStatusKeys.get(locationId) === scriptKey,
              switchTo: () => {
                activeZoneStatusKeys.set(locationId, scriptKey)
                if (src === debugTargetSrc) return
                try {
                  runScript(frameWindow, locationId, script)
                } catch (error) {
                  console.error(error)
                }
              }
            }
            if ((documentChanged || reapplyActive) && src !== debugTargetSrc && item.activated) {
              item.switchTo()
            }
            return item
          })
        ]
      }
    }))
  })
}
