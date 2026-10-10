import { create } from 'zustand'

export type Phase =
  | 'offline'   // waiting for the click that unlocks audio
  | 'boot'      // startup sequence
  | 'dormant'   // powered down, waiting for the wake word
  | 'waking'    // wake word hit, spin-up animation
  | 'listening' // capturing speech
  | 'thinking'  // model is generating
  | 'tooling'   // an MCP tool is running
  | 'speaking'  // reading the answer back

/**
 * A card on the heads-up display.
 *
 * ULTRON authors the markup and picks the treatment — this is a delivery
 * envelope, not a template. The `html` is sanitised before it reaches the DOM.
 */
export type Panel = {
  id: string
  title: string
  html: string
  anim: 'materialise' | 'sweep' | 'unfold' | 'stagger' | 'snap'
  slot: 'right' | 'left' | 'wide'
  accent: 'default' | 'amber' | 'violet' | 'green' | 'red'
  hold: 'turn' | 'sticky'
}

/**
 * A blade — the big surface.
 *
 * A panel is a card you glance at while listening. A blade is the thing you
 * actually look at, and the difference is not decoration: an article you are
 * meant to READ needs a column of a certain width and a height you can scroll,
 * and no amount of styling makes that work inside a 320px card beside the
 * reactor. So blades own their own geometry, stack rather than replace each
 * other, and can be pulled forward or thrown full screen by the user.
 */
export type Blade = {
  id: string
  title: string
  kind: 'article' | 'image' | 'gallery' | 'video' | 'embed' | 'markup' | 'camera'
  /** article / image / video / embed. */
  url?: string
  /** gallery. */
  images?: string[]
  /** markup — sanitised exactly as a panel body is. */
  html?: string
  /** article only: the words restyled, or the real page. */
  mode?: 'reader' | 'live'
  size: 'compact' | 'tall' | 'wide' | 'full'
  hold: 'turn' | 'sticky'
}

export type Turn = {
  id: string
  role: 'user' | 'ultron'
  text: string
  /** Tool names invoked while producing this turn, for the HUD readout. */
  tools?: string[]
}

/**
 * Everything ULTRON can change about his own appearance.
 *
 * All of it is an override layer: at UI_DEFAULTS every field means "carry on as
 * before", so the interface is exactly the one that existed before any of this
 * was here. Nothing in here is allowed to become load-bearing for the ordinary
 * look of the page — a demo where the reactor only appears because a command
 * turned it on is a demo that breaks on reload.
 */
export type UiState = {
  /** Overrides the phase colour everywhere when set. null = follow the phase. */
  accent: string | null
  /** Page background colour. null = the stock near-black. */
  background: string | null
  /** Per-phase colour overrides, merged over the built-in phaseColor map. */
  palette: Partial<Record<Phase, string>>
  chrome: {
    transcript: boolean   // the conversation log
  }
}

export const UI_DEFAULTS: UiState = {
  accent: null, background: null, palette: {},
  chrome: { transcript: true },
}

/** A deep-partial of UiState. */
export type UiPatch = {
  accent?: string | null
  background?: string | null
  palette?: Partial<Record<Phase, string>>
  chrome?: Partial<UiState['chrome']>
}

/**
 * A fresh copy of the defaults, never the exported object itself.
 *
 * UI_DEFAULTS is exported so components can compare against "untouched", and
 * handing the live store that same object would mean one careless in-place
 * write rewrote the baseline for the rest of the page's life.
 */
function defaultUi(): UiState {
  return {
    ...UI_DEFAULTS,
    palette: { ...UI_DEFAULTS.palette },
    chrome: { ...UI_DEFAULTS.chrome },
  }
}

/**
 * Drop the keys whose value is undefined before merging a patch.
 *
 * A patch assembled field by field from optional inputs — `{ color: in.color,
 * scale: in.scale }` — carries an explicit undefined for everything the caller
 * left out, and spreading that over the current state blanks values nobody
 * mentioned. JSON.stringify quietly deletes them on the way through the socket,
 * so this only bites the dev console and any in-process caller: exactly the two
 * paths used while dressing the set, and the two where a mystery reset costs a
 * take.
 */
function defined<T extends object>(patch: T | undefined): Partial<T> {
  if (!patch) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value
  }
  return out as Partial<T>
}

type State = {
  phase: Phase
  /** 0..1 mic loudness, drives the reactor pulse. */
  level: number
  /** What ULTRON is currently reading aloud or has just said. */
  caption: string
  turns: Turn[]
  error: string | null
  connected: string[]
  /** Name of the speech-synthesis voice in use, shown in the HUD. */
  voice: string
  /** Whether the camera is on and hands are being tracked. Store-backed rather
   *  than read off the tracker, because the indicator has to re-render. */
  gestures: boolean
  /** Set while ULTRON is taking a look, to whatever he said he was looking for.
   *  null when he is not. The camera light is on either way — this says why. */
  looking: string | null
  /** Transient status line during boot, e.g. the voice model download. */
  bootNote: string
  /** Cards currently on the display, newest last. */
  panels: Panel[]
  /** Blades currently open, newest last — which is also front-most. */
  blades: Blade[]
  /** The blade the user has pulled forward, or null for "the newest one". */
  focusedBlade: string | null
  /** A blade thrown to full screen, or null. */
  expandedBlade: string | null
  /** ULTRON's control over his own appearance. UI_DEFAULTS == the stock look. */
  ui: UiState

  setVoice: (v: string) => void
  setGestures: (on: boolean) => void
  setLooking: (why: string | null) => void
  setBootNote: (n: string) => void
  pushPanel: (p: Panel) => void
  clearPanels: () => void
  pushBlade: (b: Blade) => void
  closeBlade: (id: string) => void
  clearBlades: () => void
  focusBlade: (id: string | null) => void
  expandBlade: (id: string | null) => void
  setPhase: (p: Phase) => void
  setLevel: (l: number) => void
  setCaption: (c: string) => void
  setError: (e: string | null) => void
  setConnected: (c: string[]) => void
  pushTurn: (t: Turn) => void
  appendToLastTurn: (text: string) => void

  applyUi: (patch: UiPatch) => void
  resetUi: () => void
  clearScreen: (what: 'all' | 'panels' | 'transcript') => void
}

export const useStore = create<State>((set) => ({
  phase: 'offline',
  level: 0,
  caption: '',
  turns: [],
  error: null,
  connected: [],
  voice: '',
  gestures: false,
  looking: null,
  panels: [],
  blades: [],
  focusedBlade: null,
  expandedBlade: null,
  bootNote: '',
  ui: defaultUi(),

  setVoice: (voice) => set({ voice }),
  setGestures: (gestures) => set({ gestures }),
  setLooking: (looking) => set({ looking }),
  setBootNote: (bootNote) => set({ bootNote }),
  // Three is as many as fits around the reactor without crowding it. Sticky
  // panels are exempt from the cull — the tool description promises they stay
  // until replaced, and a plain slice(-3) silently evicted them the moment a
  // fourth panel arrived in the same turn.
  pushPanel: (panel) =>
    set((s) => {
      const next = [...s.panels, panel]
      if (next.length <= 3) return { panels: next }
      const keep: Panel[] = []
      // Walk newest-first, keeping the newest three plus anything sticky.
      for (let i = next.length - 1; i >= 0; i--) {
        if (keep.length < 3 || next[i].hold === 'sticky') keep.unshift(next[i])
      }
      return { panels: keep }
    }),
  // Panels marked sticky survive the turn boundary; the rest clear when the
  // user speaks again.
  clearPanels: () =>
    set((s) => ({ panels: s.panels.filter((p) => p.hold === 'sticky') })),

  /**
   * Six is the ceiling, and it is about the stack reading as a stack: past
   * about six the ones at the back are a millimetre of edge each and the depth
   * stops meaning anything. The oldest falls off, which is also the one the
   * user has had longest to look at.
   */
  pushBlade: (blade) =>
    set((s) => {
      const next = [...s.blades.filter((b) => b.id !== blade.id), blade].slice(-6)
      // A new blade comes to the front. Leaving the old focus in place would
      // open something the user asked for and then hide it behind what they
      // were looking at before.
      return { blades: next, focusedBlade: blade.id }
    }),
  closeBlade: (id) =>
    set((s) => ({
      blades: s.blades.filter((b) => b.id !== id),
      focusedBlade: s.focusedBlade === id ? null : s.focusedBlade,
      expandedBlade: s.expandedBlade === id ? null : s.expandedBlade,
    })),
  // Same contract as panels: 'turn' blades go when the user speaks again,
  // 'sticky' ones stay until something replaces them.
  clearBlades: () =>
    set((s) => {
      const kept = s.blades.filter((b) => b.hold === 'sticky')
      const alive = new Set(kept.map((b) => b.id))
      return {
        blades: kept,
        focusedBlade: s.focusedBlade && alive.has(s.focusedBlade) ? s.focusedBlade : null,
        expandedBlade: s.expandedBlade && alive.has(s.expandedBlade) ? s.expandedBlade : null,
      }
    }),
  focusBlade: (focusedBlade) => set({ focusedBlade }),
  expandBlade: (expandedBlade) => set({ expandedBlade }),
  setPhase: (phase) => set({ phase }),
  setLevel: (level) => set({ level }),
  setCaption: (caption) => set({ caption }),
  setError: (error) => set({ error }),
  setConnected: (connected) => set({ connected }),
  pushTurn: (turn) => set((s) => ({ turns: [...s.turns.slice(-40), turn] })),
  appendToLastTurn: (text) =>
    set((s) => {
      const turns = [...s.turns]
      const last = turns[turns.length - 1]
      if (!last || last.role !== 'ultron') return {}
      turns[turns.length - 1] = { ...last, text: last.text + text }
      return { turns }
    }),

  // Deep on purpose: a patch touching one phase colour must not take the
  // others with it. Note the
  // `=== undefined` tests rather than `??`: null is a real value here (it means
  // "go back to following the phase"), and only an absent key means "leave it".
  applyUi: (patch) =>
    set((s) => ({
      ui: {
        ...s.ui,
        accent: patch.accent === undefined ? s.ui.accent : patch.accent,
        background: patch.background === undefined ? s.ui.background : patch.background,
        palette: { ...s.ui.palette, ...defined(patch.palette) },
        chrome: { ...s.ui.chrome, ...defined(patch.chrome) },
      },
    })),
  resetUi: () => set({ ui: defaultUi() }),
  // An explicit order outranks the sticky flag. `hold: 'sticky'` only ever
  // meant "survive the next turn boundary"; when someone says "clear the
  // screen", a card staying up because an earlier turn asked nicely reads as
  // the interface ignoring the instruction.
  clearScreen: (what) =>
    set((s) => {
      const panels = what === 'transcript' ? s.panels : []
      const turns = what === 'panels' ? s.turns : []
      // Blades clear with the panels. "Clear the screen" said out loud means the
      // screen, and leaving a full-height article standing while the cards
      // around it vanish is the interface arguing with the instruction.
      const blades = what === 'transcript' ? s.blades : []
      const cleared = { panels, turns, blades, focusedBlade: null, expandedBlade: null }
      return what === 'all'
        ? { ...cleared, caption: '' }
        : cleared
    }),
}))

/** Colour identity per phase — shared by the 3D scene and the 2D HUD. */
export const phaseColor: Record<Phase, string> = {
  offline: '#0d4a4a',
  boot: '#17b3b3',
  dormant: '#12908f',
  waking: '#5cf2ef',
  listening: '#19d8d2',
  thinking: '#f0a93c',
  tooling: '#a97bff',
  speaking: '#3ef2a8',
}

/**
 * What colour is the interface right now.
 *
 * The 3D scene and the 2D HUD have to answer this identically — a reactor
 * glowing one colour behind a rail glowing another is the single most obvious
 * way this comes apart on camera — so the resolution order lives here once
 * instead of being reimplemented either side of the canvas boundary. A blanket
 * accent wins over a per-phase override, which wins over the built-in map.
 */
export function accentFor(phase: Phase, ui: UiState): string {
  return ui.accent ?? ui.palette[phase] ?? phaseColor[phase]
}

// Handy while dressing the scene for camera: in the dev server you can drive
// the visuals from the console without talking, e.g.
//   __ultron.setPhase('tooling'); __ultron.setLevel(0.8)
//   __ultron.applyUi({ accent: '#ff5a3c' }); __ultron.resetUi()
if (import.meta.env.DEV) {
  // Not `useStore.getState()` directly: zustand replaces the state object on
  // every set, so a captured snapshot's *actions* keep working while every
  // data field reads forever as it was at module load. `__ultron.phase` said
  // 'offline' no matter what was on screen.
  ;(window as unknown as Record<string, unknown>).__ultron = new Proxy(
    {} as Record<string, unknown>,
    {
      get: (_t, key) => (useStore.getState() as Record<string | symbol, unknown>)[key],
      has: (_t, key) => key in useStore.getState(),
      ownKeys: () => Reflect.ownKeys(useStore.getState()),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    },
  )
}
