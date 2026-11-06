import React, { useEffect, useState } from 'react'
import context from '../context'
import { getLazyCss } from '../lowcodeView/utils/css'
import * as lazyCss from './index.lazy.less'
import { attachShadowStyles } from './shadow-styles'
import { copy } from './index.i18n'
import { createUnderstandChip } from './chip'
import { PlaceholderDiagram } from './placeholder'
import { fileLabel, parseMeta, readDocuments, reconcileDocuments, selectDocuments, type DiagramFile } from './document'
import { Diagram } from './diagram'

const css = getLazyCss(lazyCss)

type Files = { getFiles?: () => Promise<DiagramFile[]>; files?: any }

export function createUnderstandAnyUI(comId: string, sandbox: Files, subscribeFiles?: (refresh: () => void) => () => void) {
  return function UnderstandAny({ bindingTo, disabled, Sender, Modal }: { bindingTo?: string; disabled?: boolean; Sender?: React.ComponentType<{ placeholder: string; disabled?: boolean; onSend: (input: { message: string; attachments?: any; chips?: any[] }) => void }>; Modal?: React.ComponentType<{ open: boolean; onClose: () => void; title?: React.ReactNode; width?: string; children: React.ReactNode }> }) {
    useEffect(() => attachShadowStyles(document), [])
    const [files, setFiles] = useState<DiagramFile[]>([])
    const [selected, setSelected] = useState('')
    const [open, setOpen] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const [waiting, setWaiting] = useState(false)
    const [error, setError] = useState('')
    useEffect(() => {
      let active = true, loading = false, queued = false
      const refresh = async () => {
        if (loading) { queued = true; return }
        loading = true
        try {
          const dir = (window as any).__LINGCHUANG_CONFIG__?.configDirName ?? (window as any)._sandbox_?.config?.configDirName ?? '.agent'
          const next = selectDocuments(await readDocuments(sandbox, dir), bindingTo)
          if (active) { setFiles(previous => reconcileDocuments(previous, next)); setError('') }
        } catch (err: any) {
          if (active && (err?.code === 'ENOENT' || err?.code === 'NOT_FOUND')) { setFiles([]); setError('') }
          else if (active) setError(copy.readError())
        } finally { loading = false; if (active && queued) { queued = false; void refresh() } }
      }
      const events = context.component?.events
      const offFile = events?.on('fileChange', refresh)
      const offLocalFile = subscribeFiles?.(refresh)
      const offTurn = events?.on('vibing', (value: boolean) => { if (!value) { setWaiting(false); void refresh() } })
      void refresh()
      return () => { active = false; offFile?.(); offLocalFile?.(); offTurn?.() }
    }, [bindingTo])
    const file = files.find(item => item.path === selected) ?? files[0]
    const meta = file ? parseMeta(file.content) : {}
    const description = file?.content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '').replace(/```mermaid[^\n]*\n[\s\S]*?```/gi, '').trim()
    const send = ({ message, attachments, chips }: { message: string; attachments?: any; chips?: any[] }) => {
      if (!message.trim() || waiting || disabled) return
      const sendToAgent = (window as any)._sandbox_?.helpers?.sendToAgent
      if (!sendToAgent) { setError(copy.unavailable()); return }
      const understandChip = bindingTo ? createUnderstandChip(bindingTo) : undefined
      const requestChips = [...(understandChip ? [understandChip] : []), ...(chips ?? [])]
      sendToAgent(comId, { message: `[$mbs-template:understand-any] ${understandChip ? `[[chip:${understandChip.id}]] ` : ''}${message}`, attachments, aiRole: 'flash', meta: { understandAny: bindingTo ? { bindingTo } : {}, ...(requestChips.length ? { chips: requestChips } : {}) } })
      setWaiting(true); setOpen(false)
    }
    return <div data-zone-type="ai-request" className={css['bizai-root']} data-empty={file ? undefined : 'true'}>
      {(meta.title || meta.summary || description) && <div className={css['bizai-description']}>{meta.title && <p className={css['bizai-meta-title']}>{meta.title}</p>}{meta.summary && <p className={css['bizai-summary']}>{meta.summary}</p>}{description && <details><summary>{copy.details()}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{description}</p></details>}</div>}
      <div className={css['bizai-card']}>
        {file ? <><Diagram content={file.content} /><button type="button" className={css['bizai-expand']} title={copy.expand()} aria-label={copy.expand()} onClick={() => setExpanded(true)}>⛶</button></> : <div className={css['bizai-empty']}><PlaceholderDiagram loading={waiting} onGenerate={() => setOpen(true)} /></div>}
        {!file && open && Sender && <div className={css['bizai-sender']}><Sender placeholder={copy.placeholder()} disabled={disabled || waiting} onSend={send} /></div>}
        {error && <div className={css['bizai-error']} role="alert">{error}</div>}
      </div>
      {file && Modal && <Modal open={expanded} onClose={() => setExpanded(false)} title={!bindingTo && files.length > 1 ? <select className={css['bizai-switch']} aria-label={copy.choose()} value={file.path} onChange={event => setSelected(event.target.value)}>{files.map(item => <option key={item.path} value={item.path}>{fileLabel(item)}</option>)}</select> : fileLabel(file)} width="min(80vw, 900px)">
        {(meta.summary || description) && <div className={`${css['bizai-description']} ${css['bizai-modal-description']}`}>{meta.summary && <p className={css['bizai-summary']}>{meta.summary}</p>}{description && <details className={css['bizai-details']}><summary>{copy.details()}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{description}</p></details>}</div>}
        <div className={css['bizai-modal-diagram']}><Diagram content={file.content} interactive /></div>
      </Modal>}
    </div>
  }
}
