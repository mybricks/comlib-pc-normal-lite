const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const

export function getBoxShorthand(key: string): 'margin' | 'padding' | null {
  const match = /^(margin|padding)(Top|Right|Bottom|Left)$/.exec(key)
  return match ? match[1] as 'margin' | 'padding' : null
}

/** Split CSS values only at top-level whitespace, preserving calc() and var() arguments. */
function splitBoxValues(value: string): string[] {
  const values: string[] = []
  let start = -1
  let depth = 0
  let quote = ''
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '(') {
      depth++
    } else if (char === ')') {
      depth--
    } else if (/\s/.test(char) && depth === 0) {
      if (start >= 0) values.push(value.slice(start, i))
      start = -1
      continue
    }
    if (start < 0) start = i
  }
  if (start >= 0) values.push(value.slice(start))
  return values
}

export function mergeBoxShorthand(shorthand: string, key: string, value: string): string | null {
  const group = getBoxShorthand(key)
  if (!group) return null
  const important = /\s*!important\s*$/i.test(shorthand)
  const parts = splitBoxValues(shorthand.replace(/\s*!important\s*$/i, '').trim())
  if (parts.length < 1 || parts.length > 4) return null
  const sides = [parts[0], parts[1] ?? parts[0], parts[2] ?? parts[0], parts[3] ?? parts[1] ?? parts[0]]
  sides[SIDES.indexOf(key.slice(group.length) as typeof SIDES[number])] = value.replace(/\s*!important\s*$/i, '')
  return `${sides.join(' ')}${important || /\s*!important\s*$/i.test(value) ? ' !important' : ''}`
}
