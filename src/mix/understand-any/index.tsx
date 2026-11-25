import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import context from '../context'
import { getLazyCss } from '../lowcodeView/utils/css'
import * as lazyCss from './index.lazy.less'
import { attachShadowStyles } from './shadow-styles'
import { copy } from './index.i18n'
import { createUnderstandChip } from './chip'
import { PlaceholderDiagram, SHOW_EMPTY_DIAGRAM } from './placeholder'
import { fileLabel, parseMeta, readDocuments, reconcileDocuments, selectDocuments, type DiagramFile } from './document'
import { Diagram } from './diagram'
import { findUiMatches, getUiDocuments, type ZoneHint } from './diagram/ui-selector'
import { randomUUID } from '../utils/uuid'

const css = getLazyCss(lazyCss)
const SHOW_SUMMARY = false

type Files = { getFiles?: () => Promise<DiagramFile[]>; files?: any }

export function createUnderstandAnyUI(comId: string, sandbox: Files, subscribeFiles?: (refresh: () => void) => () => void) {
  async function loadDocuments(bindingTo?: string) {
    const dir = (window as any).__LINGCHUANG_CONFIG__?.configDirName ?? (window as any)._sandbox_?.config?.configDirName ?? '.agent'
    return selectDocuments(await readDocuments(sandbox, dir), bindingTo)
  }

  function UnderstandAny({ bindingTo, disabled, Sender, Modal, setTitle, hintAtZones, cancelZones }: { bindingTo?: string; disabled?: boolean; Sender?: React.ComponentType<{ placeholder: string; disabled?: boolean; variant?: 'inline' | 'bubble'; showAttachments?: boolean; onSend: (input: { message: string; attachments?: any; chips?: any[] }) => void }>; Modal?: React.ComponentType<{ open: boolean; onClose: () => void; title?: React.ReactNode; width?: string; children: React.ReactNode }>; setTitle?: (title: string) => void; hintAtZones?: (hint: ZoneHint) => void; cancelZones?: () => void }) {
    useLayoutEffect(() => attachShadowStyles(document), [])
    const [documents, setDocuments] = useState<{ bindingTo?: string; files: DiagramFile[] } | null>(null)
    const [selected, setSelected] = useState('')
    const [expanded, setExpanded] = useState(false)
    const [waiting, setWaiting] = useState(false)
    const [error, setError] = useState('')
    const [selectedNode, setSelectedNode] = useState<string | null>(null)
    const selectedNodeRef = useRef<string | null>(null)
    const cancelZonesRef = useRef(cancelZones)
    cancelZonesRef.current = cancelZones
    const [selectionScope] = useState(() => randomUUID())
    const clearSelection = useCallback(() => {
      if (selectedNodeRef.current === null) return
      selectedNodeRef.current = null
      setSelectedNode(null)
      cancelZonesRef.current?.()
    }, [])
    const selectNode = useCallback((id: string, hint: ZoneHint, doc: Document) => {
      selectedNodeRef.current = id
      setSelectedNode(id)
      const query = Array.isArray(hint.selector) ? hint.selector.join(', ') : hint.selector
      let matches: Element[] = []
      try { if (query) matches = findUiMatches(doc, query) }
      catch (error) { console.warn('[understand-any] selector query failed:', error) }
      console.log('[understand-any] hintAtZones:', hintAtZones, 'params:', hint, 'matches:', matches)
      hintAtZones?.(hint)
    }, [hintAtZones])
    useEffect(() => {
      if (selectedNode === null) return
      const onPointerDown = (event: Event) => {
        const onSelectableNode = event.composedPath().some(target =>
          (target as Element).getAttribute?.('data-understand-selectable') === selectionScope,
        )
        if (!onSelectableNode) clearSelection()
      }
      const documents = getUiDocuments(document)
      documents.forEach(doc => doc.addEventListener('pointerdown', onPointerDown, true))
      return () => documents.forEach(doc => doc.removeEventListener('pointerdown', onPointerDown, true))
    }, [selectedNode, selectionScope, clearSelection])
    useEffect(() => () => { if (selectedNodeRef.current !== null) cancelZonesRef.current?.() }, [])
    useEffect(() => {
      let active = true, loading = false, queued = false
      const refresh = async () => {
        if (loading) { queued = true; return }
        loading = true
        try {
          const next = await loadDocuments(bindingTo)
          if (active) {
            setDocuments(previous => {
              const files = reconcileDocuments(previous && previous.bindingTo === bindingTo ? previous.files : [], next)
              return previous && previous.bindingTo === bindingTo && files === previous.files ? previous : { bindingTo, files }
            })
            setError('')
          }
        } catch (err: any) {
          if (active) {
            const notFound = err?.code === 'ENOENT' || err?.code === 'NOT_FOUND'
            setDocuments(previous => !notFound && previous && previous.bindingTo === bindingTo ? previous : { bindingTo, files: [] })
            setError(notFound ? '' : copy.readError())
          }
        } finally { loading = false; if (active && queued) { queued = false; void refresh() } }
      }
      const events = context.component?.events
      const offFile = events?.on('fileChange', refresh)
      const offLocalFile = subscribeFiles?.(refresh)
      const offTurn = events?.on('vibing', (value: boolean) => { if (!value) { setWaiting(false); void refresh() } })
      void refresh()
      return () => { active = false; offFile?.(); offLocalFile?.(); offTurn?.() }
    }, [bindingTo])
    const documentsReady = documents !== null && documents.bindingTo === bindingTo
    const files = documentsReady ? documents.files : []
    const file = files.find(item => item.path === selected) ?? files[0]
    useEffect(() => { clearSelection() }, [bindingTo, file?.path, file?.content, clearSelection])
    const meta = file ? parseMeta(file.content) : {}
    const title = file ? fileLabel(file) : copy.document()
    const displayTitle = !file && waiting ? copy.creating() : title
    useEffect(() => { if (documentsReady) setTitle?.(displayTitle) }, [setTitle, displayTitle, documentsReady])
    const summary = SHOW_SUMMARY ? meta.summary : undefined
    const description = file?.content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '').replace(/```mermaid[^\n]*\n[\s\S]*?```/gi, '').trim()
    const send = ({ message, attachments, chips }: { message: string; attachments?: any; chips?: any[] }) => {
      if (!message.trim() || waiting || disabled) return
      const sendToAgent = (window as any)._sandbox_?.helpers?.sendToAgent
      if (!sendToAgent) { setError(copy.unavailable()); return }
      const understandChip = bindingTo ? createUnderstandChip(bindingTo, title, !file) : undefined
      const requestChips = [...(understandChip ? [understandChip] : []), ...(chips ?? [])]
      sendToAgent(comId, { message: `[$mbs-template:understand-any] ${understandChip ? `[[chip:${understandChip.id}]] ` : ''}${message}`, attachments, aiRole: 'flash', meta: { understandAny: bindingTo ? { bindingTo } : {}, ...(requestChips.length ? { chips: requestChips } : {}) } }, { openPanel: false })
      setWaiting(true)
    }
    if (!documentsReady) return <div className={css['bizai-root']} aria-busy="true" />
    return <div className={css['bizai-root']} data-empty={file ? undefined : 'true'} data-loading={!file && waiting ? 'true' : undefined} data-compact={!file && !waiting && !SHOW_EMPTY_DIAGRAM ? 'true' : undefined}>
      {(summary || description) && <div className={css['bizai-description']}>{summary && <p className={css['bizai-summary']}>{summary}</p>}{description && <details><summary>{copy.details()}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{description}</p></details>}</div>}
      <div className={css['bizai-card']} onDoubleClickCapture={event => {
        const target = event.target as Element
        if (!file || !Modal || target.closest?.(`.${css['bizai-tools']}, .${css['bizai-error']}`)) return
        event.preventDefault()
        setExpanded(true)
      }}>
        {file ? <><Diagram content={file.content} selectedNode={selectedNode} selectionScope={selectionScope} onSelect={selectNode} /><div className={css['bizai-tools']}><button type="button" className={css['bizai-tool']} title={copy.expand()} aria-label={copy.expand()} onClick={() => setExpanded(true)}>⛶</button></div></> : <div className={css['bizai-empty']}><PlaceholderDiagram loading={waiting} />{Sender && !waiting && <div className={css['bizai-sender-inline']}><Sender variant="inline" placeholder={copy.placeholder()} disabled={disabled} onSend={send} /></div>}</div>}
        {error && <div className={css['bizai-error']} role="alert">{error}</div>}
      </div>
      {file && Modal && <Modal open={expanded} onClose={() => setExpanded(false)} title={!bindingTo && files.length > 1 ? <select className={css['bizai-switch']} aria-label={copy.choose()} value={file.path} onChange={event => setSelected(event.target.value)}>{files.map(item => <option key={item.path} value={item.path}>{fileLabel(item)}</option>)}</select> : <span style={{ fontSize: 12 }}>{fileLabel(file)}</span>} width="90vw">
        {(summary || description) && <div className={`${css['bizai-description']} ${css['bizai-modal-description']}`}>{summary && <p className={css['bizai-summary']}>{summary}</p>}{description && <details className={css['bizai-details']}><summary>{copy.details()}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{description}</p></details>}</div>}
        <div className={css['bizai-modal-diagram']}><Diagram content={file.content} interactive selectedNode={selectedNode} selectionScope={selectionScope} onSelect={selectNode} /></div>
      </Modal>}
    </div>
  }

  UnderstandAny.getInfo = async ({ id }: { id?: string }) => {
    try {
      const file = (await loadDocuments(id))[0]
      if (!file) return undefined
      const meta = parseMeta(file.content)
      return { title: fileLabel(file), description: meta.summary }
    } catch (err: any) {
      if (err?.code === 'ENOENT' || err?.code === 'NOT_FOUND') return undefined
      throw err
    }
  }

  return UnderstandAny
}
