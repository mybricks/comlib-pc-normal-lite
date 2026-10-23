import React, { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

export interface XtermProps {
  /** Complete terminal output. Appended text is written incrementally. */
  output: string
  className?: string
  style?: React.CSSProperties
  options?: ITerminalOptions
}

export default function Xterm({ output, className, style, options }: XtermProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const previousOutputRef = useRef('')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: false,
      theme: {
        background: '#ffffff',
        foreground: '#24292f',
        selectionBackground: '#cce5ff',
        black: '#24292f',
        red: '#cf222e',
        green: '#1a7f37',
        yellow: '#9a6700',
        blue: '#0969da',
        magenta: '#8250df',
        cyan: '#1b7c83',
        white: '#f6f8fa',
        brightBlack: '#57606a',
      },
      ...options,
      disableStdin: true,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    terminalRef.current = terminal
    terminal.write('\x1b[?25l')

    const fit = () => {
      if (container.clientWidth && container.clientHeight) fitAddon.fit()
    }
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    fit()

    return () => {
      observer.disconnect()
      terminalRef.current = null
      previousOutputRef.current = ''
      terminal.dispose()
    }
  }, [])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return

    const previous = previousOutputRef.current
    if (output === previous) return

    terminal.write(output.startsWith(previous) ? output.slice(previous.length) : `\x1bc\x1b[?25l${output}`)
    previousOutputRef.current = output
  }, [output])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal || !options) return
    terminal.options = { ...options, disableStdin: true }
  }, [options])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height: '100%', overflow: 'hidden', ...style }}
    />
  )
}
