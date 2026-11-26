/** Allow plain descriptions containing a colon followed by whitespace. */
export function parseOverviewYaml(content: string, parse: (source: string) => unknown): unknown {
  try {
    return parse(content)
  } catch (originalError) {
    const repaired = content.replace(/^([ \t]*(?:-[ \t]+)?desc:[ \t]+)([^\r\n]+)$/gm, (line, prefix: string, value: string) => {
      if (/^["'|>\[{]/.test(value) || !/:\s/.test(value)) return line
      const comment = value.match(/\s+#.*$/)?.[0] ?? ''
      const description = comment ? value.slice(0, -comment.length) : value
      return `${prefix}${JSON.stringify(description)}${comment}`
    })
    if (repaired !== content) {
      try { return parse(repaired) } catch { /* Report the original parsing error. */ }
    }
    throw originalError
  }
}
