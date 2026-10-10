import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

/**
 * The `ui_*` tools — ULTRON's control of his own face.
 *
 * `display` gives him a screen to put things on. This gives him the screen
 * itself: the colour the room is lit in and whether the transcript is up. The
 * point is not decoration. An interface that goes red before he says a word is
 * carrying meaning faster than speech can — which is the whole reason a voice
 * assistant has a face at all.
 *
 * The descriptions below are the product. They are the only place the model
 * learns what the interface can be made to do and, more importantly, when it is
 * worth doing — so they are written as direction, not as parameter lists.
 *
 * Like panels.mjs this runs in-process, so a handler pushes straight down the
 * open WebSocket. Every handler emits exactly one message, matching the
 * bridge -> browser contract: { type: 'ui', op, args }.
 */

/**
 * Booleans arrive however the model felt like writing them — 'false' as a
 * string, 1 for true, null for "leave it". A turn that fails because a flag was
 * quoted is a turn the user watched break, so nothing here rejects: unions
 * accept the loose forms and `.catch()` swallows the rest as absent. The worst
 * outcome of a bad value is that it is ignored.
 */
const looseBool = (note) =>
  z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .catch(undefined)
    .describe(note)

const colour = (note) =>
  z.union([z.string(), z.null()]).optional().catch(undefined).describe(note)

const FALSEY = new Set(['false', '0', 'no', 'off', 'hide', 'hidden', 'none'])

/** Words that mean "stop overriding this and follow the phase again". */
const AUTOMATIC = new Set(['auto', 'default', 'none', 'null', 'reset', 'clear', 'stock'])

function toBool(value) {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const s = String(value).trim().toLowerCase()
  if (!s) return undefined
  return !FALSEY.has(s)
}

/** Returns null for "follow the phase", undefined for "not mentioned". */
function toColour(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  const s = String(value).trim()
  if (!s || AUTOMATIC.has(s.toLowerCase())) return null
  return s
}

/** Only real values reach the patch, so a deep merge never clears by accident. */
function put(target, key, value) {
  if (value !== undefined) target[key] = value
  return target
}

const has = (obj) => Object.keys(obj).length > 0

const ok = (text) => ({ content: [{ type: 'text', text }] })

/**
 * The phase list is the store's `Phase` union, and the notes are what each one
 * means on screen — the model is picking colours for states it never sees, so
 * naming the moment is worth more than naming the constant.
 */
const PHASE_NOTES = {
  offline: 'before the user has unlocked audio',
  boot: 'the startup sequence',
  dormant: 'powered down, waiting for the wake word',
  waking: 'the wake word just landed',
  listening: 'capturing speech',
  thinking: 'you are composing an answer',
  tooling: 'a tool is running',
  speaking: 'you are reading the answer back',
}

const PHASES = Object.keys(PHASE_NOTES)

const themeSchema = {
  accent: colour(
    'One CSS colour that overrides the phase colour everywhere at once — the ' +
      'panel borders and the type. e.g. "#ff2d2d", ' +
      '"crimson", "rgb(20 200 255)". Pass null or "auto" to hand the interface ' +
      'back to its phase colours.',
  ),
  background: colour(
    'The page behind everything. Near-black by default and it must stay dark ' +
      '— a pale background destroys the glow and makes the display unreadable. ' +
      'Nudge it instead: "#080d18" for a colder room, "#150808" under an ' +
      'alert. Pass null or "auto" for the stock near-black.',
  ),
  phase_colors: z
    .object(
      // Built from one list so this can never drift from the store's phases.
      Object.fromEntries(
        PHASES.map((p) => [p, colour(`Colour for ${p} — ${PHASE_NOTES[p]}.`)]),
      ),
    )
    .partial()
    .optional()
    .catch(undefined)
    .describe(
      'Recolour individual states rather than overriding all of them. Use ' +
        'this when one moment deserves its own identity — a red "thinking" ' +
        'while you work through something grim — and the rest of the ' +
        'interface should carry on as normal.',
    ),
}

const THEME_DESCRIPTION = `Retint the whole interface.

The HUD is drawn in one colour identity that normally follows your state: cyan
while listening, amber while thinking, violet while a tool runs, green while you
speak. An accent overrides that everywhere, at once.

Use it when the colour MEANS something. Red because a check came back bad.
Amber because you are waiting on something out of your control. A colour pulled
out of an image you just generated, so the room matches the picture. Deep blue
because it is three in the morning and they are still working.

Do not redecorate for the sake of it, and do not leave a strange colour up after
the moment that earned it has passed — call \`ui_reset\` when it is over.

Never announce that you have done it. The user is looking at the screen.`

const chromeSchema = {
  transcript: looseBool('The running conversation log.'),
}

const CHROME_DESCRIPTION = `Show or hide the transcript under you.

It is up by default and that is the right default — it is how the user knows
what you said.

Hide it only when the absence helps. A photograph they are studying, a single
number they need to hold in their head, a moment you want to land. Strip the
chrome, let the screen be quiet, and put it back when the moment is over. The
user cannot restore it themselves, so leaving it off is taking something from
them.

Pass true to show, false to hide. Anything omitted stays as it is.`

const SCREEN_DESCRIPTION = `Clear the display.

  panels     = take down every card, including the sticky ones.
  transcript = wipe the conversation log.
  all        = both.

Use it when the user says clear the screen, or when a topic is finished and the
leftovers from the last one would confuse what comes next. It does not touch the
colours — \`ui_reset\` does that.`

const RESET_DESCRIPTION = `Put the entire interface back to stock.

Colours and the transcript switch — everything returns to the way it looks on a
fresh page. Panels and the transcript are left alone.

Call it when the user asks for normal, and call it yourself when whatever
justified a change is over. It is never the wrong thing to do.`

/**
 * @param {(op: string, args: object) => void} emit - pushes one ui message
 */
export function uiServer(emit) {
  return createSdkMcpServer({
    name: 'ultron_ui',
    version: '1.0.0',
    instructions:
      'ULTRON\'s control of his own interface — colour and the transcript. ' +
      'Change it when the change carries meaning, ' +
      'and put it back afterwards with ui_reset.',
    // Same reasoning as the display server: behind tool search it would never
    // occur to the model that the interface is something it can touch.
    alwaysLoad: true,
    tools: [
      tool('ui_theme', THEME_DESCRIPTION, themeSchema, async (args) => {
        const patch = {}
        put(patch, 'accent', toColour(args.accent))
        put(patch, 'background', toColour(args.background))

        const palette = {}
        for (const [phase, value] of Object.entries(args.phase_colors ?? {})) {
          // A phase colour has no "unset" in the contract — it is a string or
          // it is absent — so a null here is dropped rather than written.
          const c = toColour(value)
          if (PHASES.includes(phase) && typeof c === 'string') palette[phase] = c
        }
        if (has(palette)) patch.palette = palette

        if (!has(patch)) return ok('No change — no colours were given.')
        emit('patch', patch)
        return ok('Interface retinted.')
      }),

      tool('ui_chrome', CHROME_DESCRIPTION, chromeSchema, async (args) => {
        const chrome = {}
        put(chrome, 'transcript', toBool(args.transcript))

        if (!has(chrome)) return ok('No change — nothing was named.')
        emit('patch', { chrome })
        return ok('Chrome updated.')
      }),

      tool(
        'ui_screen',
        SCREEN_DESCRIPTION,
        {
          what: z
            .enum(['all', 'panels', 'transcript'])
            .default('all')
            .catch('all')
            .describe('What to clear.'),
        },
        async (args) => {
          const what = args.what ?? 'all'
          emit('screen', { what })
          return ok('Cleared.')
        },
      ),

      tool('ui_reset', RESET_DESCRIPTION, {}, async () => {
        emit('reset', {})
        return ok('Interface restored.')
      }),
    ],
  })
}
