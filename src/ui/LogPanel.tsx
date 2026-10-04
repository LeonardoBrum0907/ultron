/**
 * The L panel: what every integration is doing, one line each.
 *
 * Meant to replace tailing the terminal while debugging. The header carries the
 * session's running cost: Claude's own per-turn figure, and ElevenLabs as
 * characters and credits (plus the real balance when the key may read it).
 * D is the older panel for the listening and speaking internals; this one is
 * the timeline.
 */
import { useEffect, useRef, useState } from 'react'
import { BRIDGE_HTTP_URL } from '../config'
import { clearLog, compact, useLog } from '../lib/log'

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key !== 'l' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
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
    </aside>
  )
}
