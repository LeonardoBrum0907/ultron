import { useEffect, useRef } from 'react'
import { createFigure, type Loudness, type Zone } from '../../proto/figure.js'
import { mind } from '../lib/mind'
import { useStore } from '../store'

/**
 * The parts of the HUD the dust answers to, read off the page each frame: the
 * transcript (calm, so it reads over his chest) while it has a line, and the
 * text box (its border traced in dust) while it has the focus. Two rects a
 * frame is cheap; nothing else on the page is measured.
 */
function hudZones(): (Zone | null)[] {
  // Fixed slots, so a zone that goes away fades where it was.
  const out: (Zone | null)[] = [null, null]
  const log = document.querySelector('.log')
  if (log && log.childElementCount > 0) {
    const r = log.getBoundingClientRect()
    if (r.height > 0) out[0] = { left: r.left - 28, top: r.top - 22, right: r.right + 28, bottom: r.bottom + 22, calm: 1 }
  }
  const box = document.querySelector('.textbox')
  if (box) {
    const r = box.getBoundingClientRect()
    out[1] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, rim: box.contains(document.activeElement) ? 1 : 0 }
  }
  return out
}

/**
 * Ultron himself: the particle figure from proto/, behind the HUD.
 *
 * It follows the phase and takes its body from the mind (whose clock the app
 * keeps, see lib/mind). What it hears and says it reads every frame from the
 * callbacks, so a voice that changes engine mid-session needs no re-render.
 * The canvas is its own, made here, so a remount never shares a GL context
 * with a figure still being torn down.
 */
export function Figure({
  hears,
  says,
  onIgnite,
}: {
  hears: () => Loudness
  says: () => Loudness
  onIgnite: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  // Read through refs: the figure is built once and must call the latest ones.
  const calls = useRef({ hears, says, onIgnite })
  calls.current = { hears, says, onIgnite }

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.className = 'figure'
    host.current?.appendChild(canvas)
    let gone = false
    let stop = () => {}
    void createFigure({
      canvas,
      mind,
      hears: () => calls.current.hears(),
      says: () => calls.current.says(),
      onIgnite: () => calls.current.onIgnite(),
      zones: hudZones,
    })
      .then((figure) => {
        if (gone) return figure.dispose()
        figure.setPhase(useStore.getState().phase)
        const unsub = useStore.subscribe((s, prev) => s.phase !== prev.phase && figure.setPhase(s.phase))
        stop = () => {
          unsub()
          figure.dispose()
        }
      })
      .catch((err: Error) => {
        console.error('[ultron] the figure failed to start:', err)
        useStore.getState().setError(`The figure failed to start: ${err?.message ?? err}`)
      })
    return () => {
      gone = true
      stop()
      canvas.remove()
    }
  }, [])

  return <div ref={host} />
}
