export type StyleValue = string | number

export type LocalLessStyleUpdate = {
  type: 'less'
  selector: string
  styles: Record<string, StyleValue>
  deletions?: string[]
  fallbackFileName?: string
}

export type LocalJsxStyleUpdate = {
  type: 'jsx'
  fileName: string
  tagStart?: number
  tagEnd: number
  styles: Record<string, StyleValue>
}

/** Preserves styleProxy's existing source-level transformations in local projects. */
export type LocalSourceStyleUpdate = {
  type: 'source'
  fileName: string
  expectedContent: string
  content: string
}

export type LocalStyleUpdate = LocalLessStyleUpdate | LocalJsxStyleUpdate | LocalSourceStyleUpdate

export type LocalStyleFileSnapshot = {
  fileName: string
  previousCode: string
  newCode: string
}

const LOCAL_FILE_STYLE_UPDATE_ENDPOINT = '/lingchuang/api/style'
let restoreQueue = Promise.resolve()

export const updateLocalFileStyles = async (
  payload: { action?: 'apply'; updates: LocalStyleUpdate[] } | { action: 'restore'; files: Array<{ fileName: string; expectedContent: string; content: string }> },
) => {
  const response = await fetch(LOCAL_FILE_STYLE_UPDATE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`Local style update failed: ${response.status}`)
  }
  const result = await response.json()
  if (!Array.isArray(result?.files)) {
    throw new Error('Local style update returned an invalid response')
  }
  return result.files as LocalStyleFileSnapshot[]
}

export const restoreLocalFileStyles = (files: LocalStyleFileSnapshot[]) => {
  const restore = () => updateLocalFileStyles({
    action: 'restore',
    files: files.map(({ fileName, previousCode, newCode }) => ({
      fileName,
      expectedContent: newCode,
      content: previousCode,
    })),
  })
  const request = restoreQueue.then(restore, restore)
  // cancelBranch can issue several restores for one file synchronously. Preserve their undo order.
  restoreQueue = request.then(() => undefined, () => undefined)
  return request
}
