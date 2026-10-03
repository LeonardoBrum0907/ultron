// createMind: one personality, alive. The host tells it where it is (setContext), what
// happens (stimulate) and what it perceives (sense), advances it (tick) and reads back
// the body channels and the mood (output). It never calls the host, keeps no clock of
// its own and draws every random number from its seed.
import { CHANNELS, clone, merge } from './config.ts'
import { createDirector } from './director.ts'
import { applyEffect, fadeEmotion, stepEmotion, visible, type EmotionState } from './emotions.ts'
import { createRng } from './random.ts'
import type { ChannelKind, ContextConfig, Effect, Focus, MindEvent, Output, Personality, Saved, Storage } from './types.ts'

export interface MindOptions {
  seed?: number
  storage?: Storage
  /** Wall clock in ms, only for the time away between sessions. */
  wallClock?: () => number
}

const THRESHOLD = /^(rise|fall):([\w-]+):([\d.]+)$/
const HYSTERESIS = 0.05
const DOMINANT_ABOVE = 0.35

export function createMind(personality: Personality, options: MindOptions = {}) {
  const defaults = clone(personality)
  let config = clone(personality)
  const rng = createRng(options.seed ?? 1)
  const wall = options.wallClock ?? (() => Date.now())
  const storage = options.storage

  let t = 0
  let timeScale = 1
  let context = ''
  const emo: Record<string, EmotionState> = {}
  const lastStim: Record<string, number> = {}
  let lastInteraction = 0
  let wasIdle = false
  let focus: Focus = { x: 0, y: 0, present: false }
  let lastFocus = { x: 0, y: 0 }
  let focusMovedAt = 0
  let saveTimer = 0
  let thresholds: { key: string; emotion: string; level: number; rise: boolean; armed: boolean }[] = []
  const listeners = new Set<(e: MindEvent) => void>()

  const ctx = (): ContextConfig => config.contexts[context] ?? { freedom: 0, expression: 1 }
  const paused = () => !!ctx().paused
  const emit = (e: MindEvent) => listeners.forEach((fn) => fn(e))

  function syncEmotions() {
    for (const [name, c] of Object.entries(config.emotions)) emo[name] ??= { value: c.rest, mood: 0 }
  }

  function vis(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [name, c] of Object.entries(config.emotions)) out[name] = visible(c, emo[name], config.temper.intensity)
    return out
  }

  function applyEffects(effects: Record<string, Effect>, scale = 1) {
    for (const [name, eff] of Object.entries(effects)) if (emo[name]) applyEffect(emo[name], eff, scale)
  }

  function armThresholds() {
    const v = vis()
    const old = new Map(thresholds.map((h) => [h.key, h.armed]))
    thresholds = []
    for (const r of Object.values(config.reactions)) {
      const m = r.on?.match(THRESHOLD)
      if (!m || thresholds.some((h) => h.key === r.on)) continue
      const rise = m[1] === 'rise'
      const level = Number(m[3])
      const now = v[m[2]] ?? 0
      thresholds.push({ key: r.on!, emotion: m[2], level, rise, armed: old.get(r.on!) ?? (rise ? now < level : now > level) })
    }
  }

  function kindOf(ch: string): ChannelKind {
    const fam = ch.includes(':') ? ch.slice(0, ch.indexOf(':')) + ':*' : ''
    return config.channels?.[ch] ?? CHANNELS[ch] ?? (fam && (config.channels?.[fam] ?? CHANNELS[fam])) ?? 'offset'
  }

  const director = createDirector({
    config: () => config,
    rng,
    now: () => t,
    freedom: () => (paused() ? 0 : (ctx().freedom ?? 0)),
    paused,
    visible: vis,
    focus: () => focus,
    lastFocus: () => lastFocus,
    focusStill: () => (focus.present ? t - focusMovedAt : Infinity),
    kindOf,
    applyEffects: (e) => applyEffects(e),
    emit: (name, phase) => emit({ type: 'reaction', t, name, phase }),
  })

  /** The emotions' own life over dt seconds: drives, settling, memory. */
  function live(dt: number, inContext: string, idle: boolean) {
    const v = vis()
    const push: Record<string, number> = {}
    if (!paused())
      for (const d of config.drives) {
        if (d.contexts && !d.contexts.includes(inContext)) continue
        if (d.idle && !idle) continue
        if (d.emotion && (v[d.emotion] ?? 0) <= (d.above ?? 0)) continue
        for (const [e, k] of Object.entries(d.add)) push[e] = (push[e] ?? 0) + k
      }
    for (const [name, c] of Object.entries(config.emotions)) stepEmotion(c, emo[name], dt, push[name] ?? 0)
  }

  function stimulate(name: string, payload?: Record<string, unknown>) {
    const conf = config.stimuli[name]
    if (conf?.every != null && lastStim[name] != null && t - lastStim[name] < conf.every) return
    if (conf?.interaction) lastInteraction = t
    if (paused()) return
    emit({ type: 'stimulus', t, name, payload })
    if (conf) {
      const s = conf.scale ? Number(payload?.[conf.scale] ?? 1) : 1
      const scale = s * config.temper.volatility
      if (conf.effects) applyEffects(conf.effects, scale)
      if (conf.again && lastStim[name] != null && t - lastStim[name] < conf.again.within) applyEffects(conf.again.effects, scale)
    }
    lastStim[name] = t
    director.stimulus(name)
  }

  syncEmotions()
  armThresholds()

  const mind = {
    get config() {
      return config
    },
    defaults,

    setContext(name: string) {
      if (name === context) return
      context = name
      emit({ type: 'context', t, name })
    },

    stimulate,

    /** What it perceives. 'focus': where the user is, -1..1, and whether they are there. */
    sense(name: string, value: unknown) {
      if (name !== 'focus') return
      const f = value as Focus
      if (f.present && (!focus.present || Math.hypot(f.x - focus.x, f.y - focus.y) > 0.004)) focusMovedAt = t
      if (f.present) lastFocus = { x: f.x, y: f.y }
      focus = { ...f }
    },

    tick(dtReal: number) {
      const dt = dtReal * timeScale
      t += dt
      const idle = t - lastInteraction > config.idleAfter
      if (idle && !wasIdle) stimulate('idle')
      wasIdle = idle
      live(dt, context, idle)
      const v = vis()
      for (const h of thresholds) {
        const now = v[h.emotion] ?? 0
        const over = h.rise ? now >= h.level : now <= h.level
        const back = h.rise ? now < h.level - HYSTERESIS : now > h.level + HYSTERESIS
        if (h.armed && over) {
          h.armed = false
          stimulate(h.key)
        } else if (!h.armed && back) h.armed = true
      }
      director.tick()
      if (storage) {
        saveTimer += dtReal
        if (saveTimer >= config.persist.every) {
          saveTimer = 0
          mind.save()
        }
      }
    },

    output(): Output {
      const offsets: Record<string, number> = {}
      const gains: Record<string, number> = {}
      const add = (ch: string, val: number) => {
        if (kindOf(ch) === 'gain') gains[ch] = (gains[ch] ?? 1) * val
        else offsets[ch] = (offsets[ch] ?? 0) + val
      }
      const v = vis()
      const show = paused() ? 0 : (ctx().expression ?? 1)
      if (show > 0)
        for (const x of config.expressions) {
          const s = x.amount * Math.pow(v[x.emotion] ?? 0, x.curve ?? 1) * show
          add(x.ch, kindOf(x.ch) === 'gain' ? 1 + s : s)
        }
      const gaze = { x: 0, y: 0, weight: 0 }
      director.contribute(add, gaze)
      const channels: Record<string, number> = {}
      for (const [ch, kind] of Object.entries({ ...CHANNELS, ...config.channels })) if (!ch.includes('*')) channels[ch] = kind === 'gain' ? 1 : 0
      Object.assign(channels, offsets, gains)
      let dominant = 'neutral'
      let top = DOMINANT_ABOVE
      for (const [name, val] of Object.entries(v))
        if (val > top) {
          top = val
          dominant = name
        }
      const background: Record<string, number> = {}
      for (const name of Object.keys(config.emotions)) background[name] = emo[name].mood
      return { channels, gaze, mood: v, dominant, background, active: director.active(), context, nextIn: director.nextIn() }
    },

    /** One channel's value, neutral if nothing touches it. */
    channel(out: Output, name: string) {
      return out.channels[name] ?? (kindOf(name) === 'gain' ? 1 : 0)
    },

    force: (name: string) => director.force(name),

    on(fn: (e: MindEvent) => void) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    /** Change the personality live; objects merge, arrays replace. */
    patch(p: unknown) {
      config = merge(config, p)
      syncEmotions()
      armThresholds()
    },
    resetConfig() {
      config = clone(defaults)
      syncEmotions()
      armThresholds()
    },
    resetMood() {
      for (const [name, c] of Object.entries(config.emotions)) emo[name] = { value: c.rest, mood: 0 }
      armThresholds()
    },
    /** Set an emotion's value of the moment directly (panel, tests). */
    setEmotion(name: string, value: number) {
      if (emo[name]) emo[name].value = Math.max(0, Math.min(1, value))
    },

    get timeScale() {
      return timeScale
    },
    set timeScale(v: number) {
      timeScale = v
    },
    time: () => t,

    snapshot(): Saved {
      const emotions: Saved['emotions'] = {}
      for (const [name, s] of Object.entries(emo)) emotions[name] = { ...s }
      return { version: 1, personality: config.name, savedAt: wall(), emotions }
    },
    save() {
      if (storage) void storage.save(mind.snapshot())
    },

    /**
     * Pick up the mood from the last session. The time away fades every emotion, and
     * the last stretch of it (up to persist.maxAway) counts as being left idle.
     */
    async restore() {
      const saved = storage ? await storage.load() : null
      if (!saved || saved.version !== 1 || saved.personality !== config.name) return false
      for (const [name, s] of Object.entries(saved.emotions)) if (emo[name]) emo[name] = { value: s.value, mood: s.mood }
      const away = Math.max(0, (wall() - saved.savedAt) / 1000)
      const idleFor = Math.min(away, config.persist.maxAway)
      for (const [name, c] of Object.entries(config.emotions)) fadeEmotion(c, emo[name], away - idleFor)
      const where = config.persist.awayContext ?? context
      const was = context
      context = where
      for (let s = 0; s < idleFor; s += 1) live(Math.min(1, idleFor - s), where, true)
      context = was
      lastInteraction = t - idleFor
      thresholds = []
      armThresholds()
      return true
    },
  }
  return mind
}

export type Mind = ReturnType<typeof createMind>
