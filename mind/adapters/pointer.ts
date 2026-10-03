// The mouse (or a finger) in a browser, turned into what the mind perceives: where the
// user is (focus, -1..1 across the window), and the stimuli interaction, pointerErratic,
// pointerCalm, pointerLeft and pointerReturned.
import type { Mind } from '../core/mind.ts'

export interface PointerOptions {
  /** Direction reversals within a second that make a movement erratic. */
  reversals?: number
  /** ...and the speed it must keep, in window widths per second. */
  speed?: number
}

export function attachPointer(mind: Mind, { reversals = 3, speed = 0.8 }: PointerOptions = {}) {
  const moves: { t: number; x: number; y: number }[] = []
  let erratic = false
  let erraticAt = 0
  let lastErraticSent = 0
  let present = false

  const now = () => performance.now() / 1000

  function focusAt(e: PointerEvent | MouseEvent) {
    const x = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1
    const y = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) }
  }

  /** Over the last second: how often it doubled back, and how fast it went. */
  function measure(t: number) {
    while (moves.length && t - moves[0].t > 1) moves.shift()
    let flips = 0
    let path = 0
    let prev: { x: number; y: number } | null = null
    let anchor = moves[0]
    for (const m of moves.slice(1)) {
      const dx = m.x - anchor.x
      const dy = m.y - anchor.y
      const d = Math.hypot(dx, dy)
      if (d < 12) continue // a segment needs some length to have a direction
      path += d
      const dir = { x: dx / d, y: dy / d }
      if (prev && prev.x * dir.x + prev.y * dir.y < -0.5) flips++
      prev = dir
      anchor = m
    }
    return { flips, speed: path / Math.max(1, window.innerWidth) }
  }

  function onMove(e: PointerEvent) {
    const t = now()
    const f = focusAt(e)
    if (!present) {
      present = true
      mind.stimulate('pointerReturned')
    }
    mind.sense('focus', { ...f, present: true })
    mind.stimulate('interaction')
    moves.push({ t, x: e.clientX, y: e.clientY })
    const m = measure(t)
    if (m.flips >= reversals && m.speed >= speed) {
      erratic = true
      erraticAt = t
      if (t - lastErraticSent >= 0.5) {
        lastErraticSent = t
        mind.stimulate('pointerErratic', { strength: Math.min(1, Math.max(0.3, m.speed / 2)) })
      }
    }
  }

  function onOut(e: MouseEvent) {
    if (e.relatedTarget || !present) return
    present = false
    const f = focusAt(e)
    mind.sense('focus', { ...f, present: false })
    mind.stimulate('pointerLeft', f)
  }

  const onDown = () => mind.stimulate('interaction')

  // Calm is the absence of erratic movement for a second, so it needs a clock.
  const calm = setInterval(() => {
    if (erratic && now() - erraticAt > 1) {
      erratic = false
      mind.stimulate('pointerCalm')
    }
  }, 200)

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerdown', onDown)
  document.addEventListener('mouseout', onOut)
  return () => {
    clearInterval(calm)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerdown', onDown)
    document.removeEventListener('mouseout', onOut)
  }
}
