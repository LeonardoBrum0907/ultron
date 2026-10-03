// The director decides when something happens and what. Reflexes answer stimuli at
// once; spontaneous reactions are drawn at irregular times (a minimum gap plus an
// exponential wait, so some come soon and some take minutes), weighted by the mood,
// never the same one twice running, each kept off for its cooldown and coming back
// gradually after it. Doing nothing is one of the options in every draw.
import { CUT_RELEASE, cutEnvelope, envelope, holdStart, smooth, spanEnd, type Span } from './envelope.ts'
import type { Rng } from './random.ts'
import type { Effect, Focus, GazeTarget, Personality, ReactionConfig, Track } from './types.ts'

export interface DirectorHost {
  config(): Personality
  rng: Rng
  now(): number
  freedom(): number
  paused(): boolean
  visible(): Record<string, number>
  focus(): Focus
  lastFocus(): { x: number; y: number }
  /** Seconds the focus has been still; Infinity while it is absent. */
  focusStill(): number
  kindOf(ch: string): 'offset' | 'gain'
  applyEffects(effects: Record<string, Effect>): void
  emit(name: string, phase: 'start' | 'end' | 'cut'): void
}

interface Played extends Span {
  ch: string
  to: number
  weight: number
  gaze?: (t: number) => { x: number; y: number }
}

interface Instance {
  name: string
  conf: ReactionConfig
  start: number
  priority: number
  tracks: Played[]
  /** The main part's tracks (not the warning), the ones `until` shortens. */
  main: Played[]
  cutAt?: number
  untilSeen?: boolean
}

const sign = (v: number) => (v < 0 ? -1 : 1)

export function createDirector(host: DirectorHost) {
  const { rng } = host
  let active: Instance | null = null
  let fading: Instance[] = []
  const lastPlayed: Record<string, number> = {}
  let lastSpontaneous = ''
  let nextAt = 0
  let scheduled = false

  const reactions = () => Object.entries(host.config().reactions)

  function wait() {
    const { rhythm, temper } = host.config()
    const v = host.visible()
    let hurry = 1
    for (const [e, k] of Object.entries(rhythm.hurry ?? {})) hurry += k * (v[e] ?? 0)
    const mean = rhythm.mean / Math.max(temper.frequency, 0.01) / hurry
    return Math.min(rhythm.max, rhythm.minGap + rng.exp(mean))
  }

  function allowed(conf: ReactionConfig) {
    if (conf.enabled === false) return false
    if (host.freedom() < (conf.minFreedom ?? 0)) return false
    const v = host.visible()
    for (const [e, [lo, hi]] of Object.entries(conf.requires ?? {})) if ((v[e] ?? 0) < lo || (v[e] ?? 0) > hi) return false
    const w = conf.when
    if (w?.focusStill != null && host.focusStill() < w.focusStill) return false
    if (w?.focusPresent != null && host.focus().present !== w.focusPresent) return false
    return true
  }

  /** 0 inside the cooldown, rising to 1 at twice the cooldown (1 if it never played). */
  function readiness(name: string, conf: ReactionConfig) {
    const last = lastPlayed[name]
    const cd = conf.cooldown ?? 0
    if (last == null) return 1
    const since = host.now() - last
    if (since < cd) return 0
    return cd > 0 ? Math.min(1, (since - cd) / cd) : 1
  }

  function resolveGaze(target: GazeTarget, track: Track, flip: number, span: () => Played): (t: number) => { x: number; y: number } {
    const f = host.focus()
    if (target === 'focus') return () => (host.focus().present ? host.focus() : host.lastFocus())
    if (target === 'center') return () => ({ x: 0, y: 0 })
    if (target === 'awayFromFocus') {
      const from = f.present ? f : host.lastFocus()
      const side = Math.abs(from.x) > 0.05 ? -sign(from.x) : rng.next() < 0.5 ? -1 : 1
      const p = { x: side * rng.range([0.6, 0.9]), y: -0.15 }
      return () => p
    }
    if (target === 'lastFocus') {
      const l = f.present ? f : host.lastFocus()
      const m = Math.max(Math.abs(l.x), Math.abs(l.y))
      const p = !track.edge ? { ...l } : m > 0.05 ? { x: l.x / m, y: l.y / m } : { x: rng.next() < 0.5 ? -1 : 1, y: 0 }
      return () => p
    }
    if ('sweep' in target) {
      const x0 = rng.range(target.sweep[0]) * flip
      const x1 = rng.range(target.sweep[1]) * flip
      const y = rng.range(target.y ?? 0)
      const pause = rng.next() < (target.pauseChance ?? 0) ? rng.range(target.pause ?? 0.8) : 0
      return (t) => {
        const s = span()
        const tt = t - holdStart(s)
        let p: number
        if (tt <= 0) p = 0
        else if (tt >= s.hold) p = 1
        else if (pause > 0 && s.hold > pause) {
          const half = (s.hold - pause) / 2
          p = tt < half ? 0.5 * smooth(tt / half) : tt < half + pause ? 0.5 : 0.5 + 0.5 * smooth((tt - half - pause) / half)
        } else p = smooth(tt / s.hold)
        return { x: x0 + (x1 - x0) * p, y }
      }
    }
    const p = { x: rng.range(target.x) * flip, y: rng.range(target.y ?? 0) }
    return () => p
  }

  function resolve(track: Track, offset: number, len: number, flip: number): Played | null {
    let ch = track.ch
    if (ch.includes('*')) {
      if (!track.pick?.length) return null
      ch = ch.replace('*', rng.pick(track.pick))
    }
    const kind = ch === 'gaze' ? 'offset' : host.kindOf(ch)
    const played: Played = {
      ch,
      at: offset + rng.range(track.at ?? 0),
      attack: rng.range(track.attack ?? 0.3),
      hold: track.hold === 'len' ? len : rng.range(track.hold ?? 0),
      release: rng.range(track.release ?? 0.5),
      to: rng.range(track.to ?? (kind === 'gain' ? 1 : 0)),
      weight: rng.range(track.weight ?? 1),
    }
    if (ch === 'gaze') played.gaze = resolveGaze(track.target ?? 'focus', track, flip, () => played)
    return played
  }

  function play(name: string, conf: ReactionConfig, priority: number) {
    if (active) cut(active)
    const flip = conf.mirror && rng.next() < 0.5 ? -1 : 1
    const len = rng.range(conf.len ?? 0)
    const warnFor = conf.warn ? rng.range(conf.warn.for) : 0
    const warn = (conf.warn?.does ?? []).map((t) => resolve(t, 0, len, flip)).filter((t): t is Played => !!t)
    const main = conf.does.map((t) => resolve(t, warnFor, len, flip)).filter((t): t is Played => !!t)
    active = { name, conf, start: host.now(), priority, tracks: [...warn, ...main], main }
    lastPlayed[name] = host.now()
    if (conf.kind === 'spontaneous') lastSpontaneous = name
    host.emit(name, 'start')
  }

  function cut(inst: Instance) {
    if (inst.cutAt != null) return
    inst.cutAt = host.now() - inst.start
    fading.push(inst)
    if (active === inst) active = null
    host.emit(inst.name, 'cut')
  }

  const length = (inst: Instance) => (inst.cutAt != null ? inst.cutAt + CUT_RELEASE : Math.max(0, ...inst.tracks.map(spanEnd)))

  function draw() {
    const v = host.visible()
    const options: [string, ReactionConfig, number][] = []
    for (const [name, conf] of reactions()) {
      if (conf.kind !== 'spontaneous' || name === lastSpontaneous || !allowed(conf)) continue
      let w = conf.base ?? 1
      let favor = 1
      for (const [e, k] of Object.entries(conf.favoredBy ?? {})) favor += k * (v[e] ?? 0)
      w *= favor * readiness(name, conf)
      if (w > 0) options.push([name, conf, w])
    }
    if (!options.length) return
    let r = rng.next() * (options.reduce((s, o) => s + o[2], 0) + host.config().rhythm.rest)
    for (const [name, conf, w] of options) {
      r -= w
      if (r < 0) return play(name, conf, conf.priority ?? 1)
    }
    // landed on the rest: nothing happens this time
  }

  return {
    tick() {
      const now = host.now()
      if (!scheduled) {
        nextAt = now + wait()
        scheduled = true
      }
      if (active && now - active.start >= length(active)) {
        if (active.conf.after) host.applyEffects(active.conf.after)
        host.emit(active.name, 'end')
        active = null
      }
      fading = fading.filter((f) => now - f.start < length(f))
      if (host.paused()) {
        if (active) cut(active)
        nextAt = now + wait()
        return
      }
      if (active && host.freedom() < (active.conf.minFreedom ?? 0)) cut(active)
      if (now >= nextAt) {
        if (!active) draw()
        nextAt = now + wait()
      }
    },

    /** A stimulus arrived: end a held part that waits for it, then maybe answer it. */
    stimulus(name: string) {
      if (host.paused()) return
      const now = host.now()
      const u = active?.conf.until
      if (active && u && u.stimulus === name && !active.untilSeen) {
        active.untilSeen = true
        const tu = now - active.start + rng.range(u.then ?? 0)
        for (const t of active.main) {
          t.hold = Math.min(t.hold, Math.max(0, tu - holdStart(t)))
          if (u.release != null) t.release = rng.range(u.release)
        }
      }
      let best: [string, ReactionConfig, number] | null = null
      for (const [rn, conf] of reactions()) {
        if (conf.kind !== 'reflex' || conf.on !== name || !allowed(conf)) continue
        const last = lastPlayed[rn]
        if (last != null && now - last < (conf.cooldown ?? 0)) continue
        const p = conf.priority ?? 2
        if (active && active.priority >= p) continue
        if (best && best[2] >= p) continue
        let chance = conf.chance ?? 1
        for (const [e, k] of Object.entries(conf.chanceBy ?? {})) chance += k * (host.visible()[e] ?? 0)
        if (rng.next() < chance) best = [rn, conf, p]
      }
      if (best) play(best[0], best[1], best[2])
    },

    /** Play a reaction now, whatever the conditions (panel, dev). */
    force(name: string) {
      const conf = host.config().reactions[name]
      if (!conf) return false
      play(name, conf, 99)
      return true
    },

    /** Add every playing track to the output. */
    contribute(add: (ch: string, v: number) => void, gaze: { x: number; y: number; weight: number }) {
      const now = host.now()
      for (const inst of active ? [...fading, active] : fading) {
        const t = now - inst.start
        for (const tr of inst.tracks) {
          const e = inst.cutAt != null ? cutEnvelope(tr, t, inst.cutAt) : envelope(tr, t)
          if (e <= 0) continue
          if (tr.gaze) {
            const w = tr.weight * e
            if (w > gaze.weight) Object.assign(gaze, tr.gaze(t), { weight: w })
          } else add(tr.ch, host.kindOf(tr.ch) === 'gain' ? 1 + (tr.to - 1) * e : tr.to * e)
        }
      }
    },

    active: () => active?.name ?? null,
    nextIn: () => Math.max(0, nextAt - host.now()),
  }
}

export type Director = ReturnType<typeof createDirector>
