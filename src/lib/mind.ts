/**
 * Ultron's mind, as the app carries it.
 *
 * One instance for the whole page, created at import so anything can stimulate
 * it without threading it through props. The personality and the engine live in
 * mind/ and know nothing about this app; this file is the host side of the
 * contract in mind/SPEC.md: it tells the mind where it is (the phase), what
 * happens (stimuli) and where the user is (the pointer), and keeps its clock.
 *
 * The clock runs here rather than in a renderer so the mood lives whether or
 * not anything is drawing it. Whatever draws the figure reads mind.output()
 * and mind.on() and must not tick it a second time.
 */
import { createMind } from '../../mind/index.ts'
import { browserStorage, saveOnHide } from '../../mind/adapters/storage-browser.ts'
import { attachPointer } from '../../mind/adapters/pointer.ts'
import { ultron } from '../../mind/personalities/ultron.ts'
import { useStore } from '../store'

export const mind = createMind(ultron, {
  seed: (Math.random() * 2 ** 32) >>> 0,
  storage: browserStorage('ultron.mind'),
})

/** Names it will not answer to without taking offence. */
const FORBIDDEN = /\b(?:jarvis|stark|marionete|marionette|puppet)\b/i

/** A transcript that calls it something it hates. */
export const isForbidden = (text: string) => FORBIDDEN.test(text)

let started = false

/**
 * Bring the mind to life: restore the mood from the last session, follow the
 * phase as its context, feel the pointer and tick every frame. Idempotent, and
 * returns a function that stops it all.
 */
export function startMind(): () => void {
  if (started) return () => {}
  started = true

  let raf = 0
  let last = performance.now()
  let live = true
  const stops: (() => void)[] = []

  void mind.restore().then(() => {
    if (!live) return
    mind.setContext(useStore.getState().phase)
    stops.push(useStore.subscribe((s, prev) => s.phase !== prev.phase && mind.setContext(s.phase)))
    stops.push(saveOnHide(mind))
    stops.push(attachPointer(mind))
    const frame = (now: number) => {
      // Same cap the prototype uses: a stalled tab must not dump minutes on it at once.
      mind.tick(Math.min(0.1, (now - last) / 1000))
      last = now
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
  })

  return () => {
    live = false
    started = false
    cancelAnimationFrame(raf)
    for (const stop of stops) stop()
    mind.save()
  }
}
