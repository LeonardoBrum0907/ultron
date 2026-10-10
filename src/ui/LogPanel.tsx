/**
 * The L panel: what every integration is doing, one line each.
 *
 * Meant to replace tailing the terminal while debugging. The header carries the
 * session's running cost: Claude's own per-turn figure, and ElevenLabs as
 * characters and credits (plus the real balance when the key may read it).
 * D is the older panel for the listening and speaking internals; this one is
 * the timeline. Its last line is a terminal (lib/commands): / opens the panel
 * straight into it.
 */
import { useEffect, useRef, useState } from 'react'
import { BRIDGE_HTTP_URL } from '../config'
import { clearLog, compact, log, useLog } from '../lib/log'
import { useStore, type Phase } from '../store'
import { dustLevel, setDustLevel } from '../lib/dust'
import { completeLine, loadHistory, runCommand, saveHistory } from '../lib/commands'

/** The phase, as the status line on the main screen used to say it. */
const PHASE: Record<Phase, string> = {
  offline: 'desligado',
  boot: 'iniciando',
  dormant: 'em espera, diga “hey ultron”',
  waking: 'acordando',
  listening: 'ouvindo',
  thinking: 'pensando',
  tooling: 'acessando sistemas',
  speaking: 'respondendo',
}

const OPEN_KEY = 'ultron.log'

const clock = (t: number) => new Date(t).toLocaleTimeString('pt-BR', { hour12: false })

type Balance = { used: number; limit: number; tier?: string } | { error: string } | null

export function LogPanel() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1'
    } catch {
      return false
    }
  })
  const { entries, totals } = useLog()
  const list = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [balance, setBalance] = useState<Balance>(null)
  const voice = useStore((s) => s.voice)
  const phase = useStore((s) => s.phase)
  const bootNote = useStore((s) => s.bootNote)
  const connected = useStore((s) => s.connected)
  const heldPhase = useStore((s) => s.heldPhase)
  const [dust, setDust] = useState(dustLevel)
  const input = useRef<HTMLInputElement>(null)
  const [line, setLine] = useState('')
  const history = useRef<string[]>(loadHistory())
  /** Where ↑↓ is in the history; history.length = the line being typed. */
  const cursor = useRef(history.current.length)
  const draft = useRef('')
  const [focusAsked, setFocusAsked] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      // / opens the panel with the terminal already focused.
      if (e.key === '/') {
        e.preventDefault()
        try {
          localStorage.setItem(OPEN_KEY, '1')
        } catch {
          // Private mode: it just will not be remembered.
        }
        setOpen(true)
        setFocusAsked((n) => n + 1)
        return
      }
      if (e.key !== 'l') return
      e.preventDefault()
      setOpen((o) => {
        try {
          localStorage.setItem(OPEN_KEY, o ? '0' : '1')
        } catch {
          // Private mode: it just will not be remembered.
        }
        return !o
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open && focusAsked) input.current?.focus()
  }, [open, focusAsked])

  // Follow the newest line, unless the user scrolled up to read an older one.
  useEffect(() => {
    const el = list.current
    if (open && el && stick.current) el.scrollTop = el.scrollHeight
  }, [open, entries])

  // The real ElevenLabs balance. Read when the panel opens and after each
  // spoken line, and only while it is open: it is one more request to their API.
  useEffect(() => {
    if (!open) return
    let live = true
    fetch(`${BRIDGE_HTTP_URL}/usage`)
      .then((r) => r.json())
      .then((b: Balance) => live && setBalance(b))
      .catch(() => live && setBalance({ error: 'bridge' }))
    return () => {
      live = false
    }
  }, [open, totals.elevenCalls])

  // Lets the text box step aside instead of sliding under the panel.
  useEffect(() => {
    document.body.classList.toggle('lg-open', open)
    return () => document.body.classList.remove('lg-open')
  }, [open])

  if (!open) return null

  const submit = () => {
    const typed = line.trim()
    setLine('')
    if (!typed) return
    const h = history.current
    if (h[h.length - 1] !== typed) h.push(typed)
    saveHistory(h)
    cursor.current = h.length
    draft.current = ''
    stick.current = true
    void runCommand(typed)
  }

  const step = (dir: -1 | 1) => {
    const h = history.current
    if (cursor.current === h.length) draft.current = line
    const next = Math.max(0, Math.min(h.length, cursor.current + dir))
    cursor.current = next
    setLine(next === h.length ? draft.current : h[next])
  }

  const bal =
    balance && 'limit' in balance
      ? `saldo ${compact(balance.limit - balance.used)} de ${compact(balance.limit)} cr`
      : balance && 'error' in balance
        ? 'saldo indisponível'
        : '…'

  return (
    <aside className="lg" aria-label="Log de eventos">
      <div className="lg-head">
        <span>LOG · L fecha</span>
        <button type="button" className="lg-clear" onClick={clearLog}>
          limpar
        </button>
      </div>
      {/* What used to sit round the edges of the main screen: the phase, the
          voice download while it boots, and which systems are linked. */}
      <div className="lg-state">
        <div>
          <b>status</b> {phase === 'boot' && bootNote ? bootNote : PHASE[phase]}
          {heldPhase && ` · figura presa em ${heldPhase}`}
        </div>
        <div>
          <b>sistemas</b> {[...connected, 'web'].join(' · ')}
        </div>
        <label className="lg-dust">
          <b>som da poeira</b>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={dust}
            onChange={(e) => {
              const v = Number(e.target.value)
              setDust(v)
              setDustLevel(v)
            }}
          />
          {Math.round(dust * 100)}%
        </label>
      </div>
      {/* The keys live here rather than on the main screen, which keeps nothing
          but the figure and the conversation. */}
      <div className="lg-keys">
        diga <b>“hey ultron”</b> · <kbd>/</kbd> terminal · <kbd>Space</kbd> falar · <kbd>G</kbd> mãos · <kbd>D</kbd> diagnóstico
        {voice && (
          <>
            {' · '}
            <kbd>V</kbd> voz: {voice.replace(/\(.*?\)/g, '').trim()}
          </>
        )}
      </div>
      <div className="lg-totals">
        <div>
          <b className="lg-claude">claude</b> ${totals.claudeUsd.toFixed(4)} · {totals.claudeTurns}{' '}
          turnos · {compact(totals.claudeIn)} in / {compact(totals.claudeOut)} out
        </div>
        <div>
          <b className="lg-eleven">eleven</b> {compact(totals.elevenChars)} caracteres ≈{' '}
          {totals.elevenCredits} cr · {totals.elevenCalls} falas ({totals.elevenCached} do cache) ·{' '}
          {bal}
        </div>
      </div>
      <div
        className="lg-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {entries.length === 0 && <div className="lg-empty">nenhum evento ainda</div>}
        {entries.map((e) => (
          <div key={e.id} className={`lg-row lg-${e.level}`}>
            <span className="lg-t">{clock(e.t)}</span>
            <span className={`lg-src lg-${e.src}`}>{e.src}</span>
            <span className="lg-x">{e.text}</span>
          </div>
        ))}
      </div>
      <form
        className="lg-term"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <span aria-hidden="true">›</span>
        <input
          ref={input}
          value={line}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              step(-1)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              step(1)
            } else if (e.key === 'Tab') {
              e.preventDefault()
              const c = completeLine(line)
              setLine(c.line)
              // More than one left: show them on one row, as a shell would.
              if (c.options.length) {
                stick.current = true
                log('cmd', c.options.join('  '))
              }
            } else if (e.key === 'Escape') {
              e.currentTarget.blur()
            }
          }}
          placeholder="type help"
          aria-label="Comando"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
        />
      </form>
    </aside>
  )
}
