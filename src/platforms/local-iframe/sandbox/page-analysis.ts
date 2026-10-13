/**
 * local-iframe execution only. Tree-sitter parsing stays in the project
 * middleware; plugin-ai owns the Tool declarations.
 */
const UNDERSTAND_PAGE_ENDPOINT = '/lingchuang/api/understand-page'
const VALIDATE_PAGE_ENDPOINT = '/lingchuang/api/validate-page'

// TODO(local-iframe): make the `/understand-page` middleware apply
// PAGE_ANALYSIS_EVENT_BLACKLIST while collecting Tree-sitter events. Do not add
// an unsupported query parameter here: it would not make the endpoint filter.

async function getResponseError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  if (!text) return ''
  try {
    const body = JSON.parse(text) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : text
  } catch {
    return text
  }
}

export function createHttpPageAnalysis() {
  return {
    async understandPage(params: { file: string; profile?: string }) {
      const endpoint = new URL(UNDERSTAND_PAGE_ENDPOINT, window.location.origin)
      endpoint.searchParams.set('file', params.file)
      endpoint.searchParams.set('profile', params.profile ?? 'full')
      const response = await fetch(endpoint.toString(), { headers: { Accept: 'application/json' } })
      if (!response.ok) {
        const detail = await getResponseError(response)
        throw new Error(`understand_page 请求失败 [${response.status}]${detail ? `: ${detail}` : ''}`)
      }
      const envelope = await response.json()
      const report = envelope?.report
      const summary = envelope?.summary ?? {}
      return {
        output: typeof envelope?.markdown === 'string' ? envelope.markdown : JSON.stringify(report ?? envelope, null, 2),
        metadata: {
          file: params.file,
          profile: params.profile ?? 'full',
          schemaVersion: report?.schemaVersion,
          entryFile: report?.input?.file,
          entrySelection: report?.entry?.selection,
          componentCount: summary?.components ?? (Array.isArray(report?.components) ? report.components.length : 0),
          externalComponentCount: summary?.externalComponents,
          eventCount: summary?.events ?? (Array.isArray(report?.events) ? report.events.length : 0),
          requestCount: summary?.requests ?? (Array.isArray(report?.requests) ? report.requests.length : 0),
          stateBindingCount: summary?.stateBindings,
          renderedStateBindingCount: summary?.renderedStateBindings,
          relationCount: summary?.relations,
          diagnosticCount: summary?.diagnostics ?? (Array.isArray(report?.diagnostics) ? report.diagnostics.length : 0),
          diagnosticCounts: summary?.diagnosticCounts,
        },
      }
    },
    async validatePage() {
      const endpoint = new URL(VALIDATE_PAGE_ENDPOINT, window.location.origin)
      const response = await fetch(endpoint.toString(), { headers: { Accept: 'application/json' } })
      if (!response.ok) {
        const detail = await getResponseError(response)
        throw new Error(`validate_page 请求失败 [${response.status}]${detail ? `: ${detail}` : ''}`)
      }
      const envelope = await response.json()
      const summary = envelope?.summary ?? {}
      return {
        output: typeof envelope?.markdown === 'string' ? envelope.markdown : JSON.stringify(envelope, null, 2),
        metadata: {
          format: envelope?.format,
          doc: envelope?.doc,
          pages: summary?.pages,
          analyzed: summary?.analyzed,
          covered: summary?.covered,
          missing: summary?.missing,
          passed: summary?.passed,
        },
      }
    },
  }
}
