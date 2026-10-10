import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore, accentFor } from '../store'
import { Blades } from './Blades'
import { Pointer } from './Pointer'
import { GestureGuide } from './GestureGuide'

/**
 * What the transcript shows: his last line, and nothing older. The user's own
 * line is there only while it waits for his answer, so they can see it was
 * heard; once he speaks it goes.
 */
function onScreen<T extends { role: string }>(turns: T[]): T[] {
  const last = turns[turns.length - 1]
  if (!last) return []
  if (last.role === 'ultron') return [last]
  const his = turns.findLast((t) => t.role === 'ultron')
  return his ? [his, last] : [last]
}

export function Hud() {
  const phase = useStore((s) => s.phase)
  const caption = useStore((s) => s.caption)
  const turns = useStore((s) => s.turns)
  const error = useStore((s) => s.error)
  const gestures = useStore((s) => s.gestures)
  const looking = useStore((s) => s.looking)
  const ui = useStore((s) => s.ui)

  // accentFor folds ULTRON's overrides in over the phase colour, so one
  // variable on the root carries a theme change into every .hud-* rule without
  // a single component knowing a theme exists.
  const colour = accentFor(phase, ui)

  useEffect(() => {
    // The ground has to be set on the document, not painted here: the HUD sits
    // above the figure, so a background drawn inside it would cover him rather
    // than sit behind it. --bg is what html, body and #root pin themselves to.
    const root = document.documentElement
    if (ui.background) root.style.setProperty('--bg', ui.background)
    else root.style.removeProperty('--bg')
  }, [ui.background])

  return (
    <div className="hud" style={{ ['--accent' as string]: colour }}>
      {/* Conversation log: his last line (and the user's, while it waits). The
          dust clears behind it, see hudZones in Figure.tsx. */}
      {ui.chrome.transcript && (
        <div className="log">
          <AnimatePresence initial={false}>
            {onScreen(turns).map((t) => (
              <motion.div
                key={t.id}
                className={`log-line log-${t.role}`}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              >
                <span className="log-who">{t.role === 'user' ? 'YOU' : 'ULTRON'}</span>
                <span className="log-text">{t.text}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {caption && (
          <motion.div
            className="caption"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {caption}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The one surface. Panels used to sit alongside this as a second place
          for things to appear, which meant two places to look and a decision
          the model had to make on grounds it could not know. Everything renders
          here now; Panels.tsx is unmounted rather than deleted so the design
          system it documents stays findable. */}
      <Blades />

      {error && <div className="error">{error}</div>}

      {/* Last: the reticle shows where a press will land, so nothing may sit
          above it. */}
      <Pointer />
      {(gestures || looking) && (
        <div className="hands-live">
          {looking ? `LOOKING — ${looking.toUpperCase()}` : 'CAMERA ON · G TO STOP'}
        </div>
      )}
      <GestureGuide live={gestures} />
    </div>
  )
}
