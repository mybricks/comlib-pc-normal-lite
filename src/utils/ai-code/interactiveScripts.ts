import YAML from 'yaml'

/** 一个可在运行时执行的 window._proxy_ 展示场景。 */
export interface InteractiveScript {
  title: string
  script: string
}

/** 页面内一组绑定到同一个 JSX 位置的展示场景。 */
export interface InteractiveScriptLocation {
  title: string
  fileName: string
  loc: string
  scripts: InteractiveScript[]
}

export interface InteractiveScriptPage {
  page: string
  locations: InteractiveScriptLocation[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function warnInteractiveScriptIssue(path: string, message: string): void {
  console.warn(`interactive-scripts.yaml 的 ${path} ${message}`)
}

function requiredString(value: unknown, path: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    warnInteractiveScriptIssue(path, '必须是非空字符串')
    return undefined
  }
  return value
}

function isLocation(value: string): boolean {
  const match = value.trim().match(/^([A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$-]*)*):([1-9]\d*)(?:-([1-9]\d*))?$/)
  return !!match && (!match[3] || Number(match[3]) >= Number(match[2]))
}

/**
 * 解析 .agent/proxy-mock/interactive-scripts.yaml。
 *
 * 文件顶层是页面数组，每页包含 JSX 展示位置及其可执行场景。解析时会
 * 丢弃结构不完整的条目，避免一条错误记录阻断其余交互脚本的使用。
 */
export function parseInteractiveScripts(content: string): InteractiveScriptPage[] {
  let raw: unknown
  try {
    raw = YAML.parse(content)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnInteractiveScriptIssue('顶层', `YAML 解析失败：${message}`)
    return []
  }

  if (!Array.isArray(raw)) {
    warnInteractiveScriptIssue('顶层', '必须是数组')
    return []
  }

  const pages: InteractiveScriptPage[] = []
  raw.forEach((value, index) => {
    const path = `[${index}]`
    if (!isRecord(value)) {
      warnInteractiveScriptIssue(path, '必须是对象')
      return
    }

    const page = requiredString(value.page, `${path}.page`)
    if (!page) return
    if (!Array.isArray(value.locations)) {
      warnInteractiveScriptIssue(`${path}.locations`, '必须是数组')
      return
    }

    const locations: InteractiveScriptLocation[] = []
    value.locations.forEach((locationValue, locationIndex) => {
      const locationPath = `${path}.locations[${locationIndex}]`
      if (!isRecord(locationValue)) {
        warnInteractiveScriptIssue(locationPath, '必须是对象')
        return
      }

      const title = requiredString(locationValue.title, `${locationPath}.title`)
      const fileName = requiredString(locationValue.fileName, `${locationPath}.fileName`)
      const loc = requiredString(locationValue.loc, `${locationPath}.loc`)
      if (!title || !fileName || !loc) return
      if (!isLocation(loc)) {
        warnInteractiveScriptIssue(`${locationPath}.loc`, '必须使用“标签名:起始行-结束行”格式，且结束行不能小于起始行')
        return
      }
      if (!Array.isArray(locationValue.scripts)) {
        warnInteractiveScriptIssue(`${locationPath}.scripts`, '必须是数组')
        return
      }

      const scripts: InteractiveScript[] = []
      locationValue.scripts.forEach((scriptValue, scriptIndex) => {
        const scriptPath = `${locationPath}.scripts[${scriptIndex}]`
        if (!isRecord(scriptValue)) {
          warnInteractiveScriptIssue(scriptPath, '必须是对象')
          return
        }
        const title = requiredString(scriptValue.title, `${scriptPath}.title`)
        const script = requiredString(scriptValue.script, `${scriptPath}.script`)
        if (title && script) scripts.push({ title, script })
      })

      if (scripts.length) locations.push({ title, fileName, loc, scripts })
    })

    if (locations.length) pages.push({ page, locations })
  })

  return pages
}
