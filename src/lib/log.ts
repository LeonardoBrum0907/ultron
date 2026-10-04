/**
 * The event log behind the L panel.
 *
 * Everything that talks to something else (the bridge, Claude, ElevenLabs, the
 * microphone) writes one short line here, and the panel shows them. It exists
 * because the terminal only sees half the story: the bridge knows what it sent
 * to ElevenLabs, but only the page knows what it heard, what it played and
 * which voice actually made the sound.
 *
 * Plain module state read through useSyncExternalStore, so any file can log
 * without being a component and the panel re-renders on change. The buffer is
 * capped; this is a window onto what just happened, not a history.
 */
import { useSyncExternalStore } from 'react'

export type Source = 'claude' | 'eleven' | 'voice' | 'bridge' | 'app'
export type Level = 'info' | 'warn' | 'error'

export type Entry = { id: number; t: number; src: Source; level: Level; text: string }

export type Totals = {
  claudeTurns: number
  claudeUsd: number
  claudeIn: number
  claudeOut: number
  elevenCalls: number
  elevenCached: number
  elevenChars: number
  elevenCredits: number
}

type Snapshot = { entries: Entry[]; totals: Totals }

const MAX = 300

const ZERO: Totals = {
  claudeTurns: 0,
  claudeUsd: 0,
  claudeIn: 0,
  claudeOut: 0,
  elevenCalls: 0,
  elevenCached: 0,
  elevenChars: 0,
  elevenCredits: 0,
}

let snap: Snapshot = { entries: [], totals: ZERO }
let seq = 0
const listeners = new Set<() => void>()

const emit = (next: Snapshot) => {
  snap = next
  for (const l of listeners) l()
}

export function log(src: Source, text: string, level: Level = 'info'): void {
  const entry: Entry = { id: ++seq, t: Date.now(), src, level, text }
  emit({ ...snap, entries: [...snap.entries.slice(-(MAX - 1)), entry] })
}

/** One finished Claude turn: what it cost and how many tokens it used. */
export function addClaude(usd: number | null | undefined, tokensIn = 0, tokensOut = 0): void {
  const t = snap.totals
  emit({
    ...snap,
    totals: {
      ...t,
      claudeTurns: t.claudeTurns + 1,
      claudeUsd: t.claudeUsd + (usd ?? 0),
      claudeIn: t.claudeIn + tokensIn,
      claudeOut: t.claudeOut + tokensOut,
    },
  })
}

/** One ElevenLabs speech request: characters sent and the credits they cost. */
export function addEleven(chars: number, credits: number, cached: boolean): void {
  const t = snap.totals
  emit({
    ...snap,
    totals: {
      ...t,
      elevenCalls: t.elevenCalls + 1,
      elevenCached: t.elevenCached + (cached ? 1 : 0),
      elevenChars: t.elevenChars + (cached ? 0 : chars),
      elevenCredits: t.elevenCredits + credits,
    },
  })
}

export function clearLog(): void {
  emit({ entries: [], totals: ZERO })
}

export function useLog(): Snapshot {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => snap,
  )
}

/** A line of user text, short enough to sit in one log row. */
export const clip = (text: string, max = 60): string => {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** The readable part of an error body: ElevenLabs answers {detail:{message}}. */
export function errorText(body: string): string {
  try {
    const j = JSON.parse(body) as { detail?: { message?: string; status?: string } | string }
    if (typeof j.detail === 'string') return clip(j.detail, 120)
    if (j.detail?.message) return clip(j.detail.message, 120)
    if (j.detail?.status) return j.detail.status
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return clip(body, 120)
}

/** 1234 → "1.2k", so token counts fit a row. */
export const compact = (n: number): string =>
  n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
