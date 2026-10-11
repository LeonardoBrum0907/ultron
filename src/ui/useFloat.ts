/**
 * A loose window on the screen: dragged by its title bar, resized from any
 * edge or corner, the way a terminal window is on the desktop. Where it was
 * left is kept across reloads, and it is pulled back on screen when the
 * browser window shrinks under it.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export type Rect = { x: number; y: number; w: number; h: number }
/** Which edges a resize handle moves: n, s, e, w or a corner like 'se'. */
export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const MIN_W = 320
const MIN_H = 200
/** Kept wholly on screen: the terminal line sits on its bottom edge, and a
 *  window hanging off the screen would hide exactly that. */
function fit(r: Rect): Rect {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(Math.max(r.w, MIN_W), vw)
  const h = Math.min(Math.max(r.h, MIN_H), vh)
  const x = Math.min(Math.max(r.x, 0), vw - w)
  const y = Math.min(Math.max(r.y, 0), vh - h)
  return { x, y, w, h }
}

function load(key: string, fallback: () => Rect): Rect {
  try {
    const r = JSON.parse(localStorage.getItem(key) ?? 'null') as Rect | null
    if (r && [r.x, r.y, r.w, r.h].every(Number.isFinite)) return fit(r)
  } catch {
    // Unreadable: start from the default.
  }
  return fit(fallback())
}

export function useFloat(key: string, fallback: () => Rect) {
  const [rect, setRect] = useState(() => load(key, fallback))

  const save = useCallback(
    (r: Rect) => {
      try {
        localStorage.setItem(key, JSON.stringify(r))
      } catch {
        // Private mode: it just will not be remembered.
      }
    },
    [key],
  )

  useEffect(() => {
    const onResize = () => setRect((r) => fit(r))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /** Follow the pointer from a press until it is let go. */
  const track = (e: ReactPointerEvent, move: (dx: number, dy: number, from: Rect) => Rect) => {
    if (e.button !== 0) return
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const from = rect
    let last = from
    const onMove = (ev: PointerEvent) => {
      last = fit(move(ev.clientX - sx, ev.clientY - sy, from))
      setRect(last)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('float-moving')
      save(last)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // No text gets selected and the cursor stays put while dragging.
    document.body.classList.add('float-moving')
  }

  /** On the title bar: drag the whole window (not when pressing a button in it). */
  const onDrag = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    track(e, (dx, dy, f) => ({ ...f, x: f.x + dx, y: f.y + dy }))
  }

  /** On a handle: resize from that edge, keeping the opposite edge still. */
  const onResize = (edge: Edge) => (e: ReactPointerEvent) =>
    track(e, (dx, dy, f) => {
      // The edge stops at the screen's, so a resize never shoves the window.
      let { x, y, w, h } = f
      if (edge.includes('e')) w = Math.min(f.w + dx, window.innerWidth - f.x)
      if (edge.includes('s')) h = Math.min(f.h + dy, window.innerHeight - f.y)
      if (edge.includes('w')) {
        w = Math.min(Math.max(MIN_W, f.w - dx), f.x + f.w)
        x = f.x + f.w - w
      }
      if (edge.includes('n')) {
        h = Math.min(Math.max(MIN_H, f.h - dy), f.y + f.h)
        y = f.y + f.h - h
      }
      return { x, y, w, h }
    })

  /** Back to where it starts out. */
  const reset = () => {
    const r = fit(fallback())
    setRect(r)
    save(r)
  }

  return { rect, onDrag, onResize, reset }
}

export const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
