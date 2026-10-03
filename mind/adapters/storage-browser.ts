// The mood kept in the browser's localStorage between sessions. Storage can be missing
// or refuse (private windows, blocked site data); the mind then simply starts fresh.
import type { Mind } from '../core/mind.ts'
import type { Saved, Storage } from '../core/types.ts'

export function browserStorage(key = 'mind'): Storage {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key)
        return raw ? (JSON.parse(raw) as Saved) : null
      } catch {
        return null
      }
    },
    save(saved) {
      try {
        localStorage.setItem(key, JSON.stringify(saved))
      } catch {
        // nowhere to keep it; the next session starts from rest
      }
    },
  }
}

/** Save as the page goes away, not only on the timer. Returns a function that stops it. */
export function saveOnHide(mind: Mind) {
  const save = () => mind.save()
  const onVisibility = () => document.visibilityState === 'hidden' && save()
  window.addEventListener('pagehide', save)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    window.removeEventListener('pagehide', save)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
