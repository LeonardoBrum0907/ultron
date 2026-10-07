// The mind's behaviour checked in numbers, on a simulated clock and fixed seeds, without
// a browser:  node node_modules/tsx/dist/cli.mjs mind/test/run.ts
import { createMind } from '../core/mind.ts'
import type { MindEvent, Saved } from '../core/types.ts'
import { ultron } from '../personalities/ultron.ts'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}

/** A mind with a log of what it did, its clock stepped 20 times a second. */
function setup(seed = 1, context = 'dormant') {
  const mind = createMind(ultron, { seed })
  const log: MindEvent[] = []
  mind.on((e) => log.push(e))
  mind.setContext(context)
  const run = (seconds: number, each?: (t: number) => void) => {
    for (let i = 0; i < seconds * 20; i++) {
      mind.tick(0.05)
      each?.(mind.time())
    }
  }
  const starts = (name?: string) => log.filter((e) => e.type === 'reaction' && e.phase === 'start' && (!name || e.name === name))
  return { mind, log, run, starts }
}

// Left alone, boredom climbs to its peak in a few minutes and it stares out waiting.
{
  const { mind, run, starts } = setup()
  run(300)
  const b = mind.output().mood.boredom
  check('5 min alone: boredom past 0.85', b >= 0.85, `boredom ${b.toFixed(2)}`)
  check('5 min alone: waitForOrders played', starts('waitForOrders').length >= 1)
}

// Spontaneous reactions: irregular, never back to back, never closer than minGap.
{
  const { run, starts } = setup(7)
  run(2 * 3600)
  const s = starts().filter((e) => ultron.reactions[(e as { name: string }).name].kind === 'spontaneous') as { t: number; name: string }[]
  let repeats = 0
  let tooClose = 0
  for (let i = 1; i < s.length; i++) {
    if (s[i].name === s[i - 1].name) repeats++
    if (s[i].t - s[i - 1].t < ultron.rhythm.minGap - 1e-6) tooClose++
  }
  const counts: Record<string, number> = {}
  for (const e of s) counts[e.name] = (counts[e.name] ?? 0) + 1
  const gaps = s.slice(1).map((e, i) => e.t - s[i].t)
  check('2 h alone: some spontaneous reactions', s.length > 20, JSON.stringify(counts))
  check('never the same one twice running', repeats === 0, `${repeats} repeats`)
  check(`never closer than ${ultron.rhythm.minGap} s`, tooClose === 0, `gaps ${Math.min(...gaps).toFixed(0)}..${Math.max(...gaps).toFixed(0)} s`)
}

// Not while it is speaking: no freedom, no reactions.
{
  const { run, starts } = setup(3, 'speaking')
  run(600)
  check('speaking: nothing happens on its own', starts().length === 0, `${starts().length} reactions`)
}

// A thrashing cursor: it looks away, and looks back once the cursor calms down.
{
  const { mind, run, starts, log } = setup(5)
  mind.sense('focus', { x: 0.5, y: 0, present: true })
  run(1)
  // The pointer adapter sends pointerErratic every 0.5 s while the cursor thrashes.
  const thrash = (seconds: number) => {
    for (let s = 0; s < seconds; s += 0.5) {
      mind.stimulate('pointerErratic', { strength: 1 })
      run(0.5)
    }
  }
  thrash(5)
  const out = mind.output()
  check('erratic cursor: lookAway plays', starts('lookAway').length === 1)
  check('it looks to the other side', out.gaze.weight > 0.5 && out.gaze.x < 0, `gaze x ${out.gaze.x.toFixed(2)} w ${out.gaze.weight.toFixed(2)}`)
  thrash(3)
  check('it holds while the cursor keeps thrashing', mind.output().active === 'lookAway')
  mind.stimulate('pointerCalm')
  run(3.5)
  const ended = log.some((e) => e.type === 'reaction' && e.name === 'lookAway' && e.phase === 'end')
  check('calm cursor: it looks back within ~3 s', ended && mind.output().gaze.weight < 0.05)
}

// The cursor leaves the window: it keeps looking at the edge where it went.
{
  const { mind, run, starts } = setup(2)
  mind.sense('focus', { x: 0.4, y: -0.2, present: true })
  run(1)
  mind.sense('focus', { x: 0.4, y: -0.2, present: false })
  let n = 0
  while (!starts('watchExit').length && n++ < 10) {
    mind.stimulate('pointerLeft')
    run(21)
  }
  check('cursor left: watchExit plays', starts('watchExit').length === 1)
}

// Answering a call: the style follows the mood, always within the promises.
{
  type Answer = Extract<MindEvent, { type: 'answer' }>
  /** Call 300 fresh minds in this mood; count the styles, and check every promise on each. */
  function calls(mood: Record<string, number>) {
    const styles: Record<string, number> = {}
    let preludes = 0
    let late = 0
    let unheard = 0
    let maxDelay = 0
    for (let seed = 1; seed <= 300; seed++) {
      const { mind, run, log } = setup(seed)
      run(1)
      for (const [e, v] of Object.entries(mood)) mind.setEmotion(e, v)
      mind.stimulate('call')
      const a = log.find((e): e is Answer => e.type === 'answer')
      if (!a) continue
      styles[a.style] = (styles[a.style] ?? 0) + 1
      if (a.preludes.length) preludes++
      if (a.delay > 2 + 1e-9) late++
      maxDelay = Math.max(maxDelay, a.delay)
      run(0.15)
      if (mind.channel(mind.output(), 'eyes.boost') <= 0) unheard++
    }
    return { styles, preludes, late, unheard, maxDelay }
  }
  const share = (r: ReturnType<typeof calls>, s: string) => (r.styles[s] ?? 0) / 300

  const calm = calls({})
  check('calm: mostly eager', share(calm, 'eager') > 0.4, JSON.stringify(calm.styles))
  const cross = calls({ irritation: 0.9 })
  check('irritated: mostly curt, made to wait', share(cross, 'curt') > 0.7 && cross.preludes > 250, `${JSON.stringify(cross.styles)}, waited ${cross.preludes}/300`)
  const bored = calls({ boredom: 0.95 })
  check('bored: mostly weary, often a sigh first', share(bored, 'weary') > 0.6 && bored.preludes > 200, `${JSON.stringify(bored.styles)}, sighed ${bored.preludes}/300`)
  const both = calls({ boredom: 1, irritation: 1 })
  check('every promise kept: answered within 2 s', [calm, cross, bored, both].every((r) => r.late === 0), `longest wait ${both.maxDelay.toFixed(2)} s`)
  check('every promise kept: a sign of hearing within 0.2 s', [calm, cross, bored, both].every((r) => r.unheard === 0))

  const { mind, run, log } = setup(4)
  run(1)
  mind.stimulate('call')
  const a = log.find((e): e is Answer => e.type === 'answer')!
  run(a.delay + 0.1)
  check('the answer sends its cue when it starts', log.some((e) => e.type === 'cue' && e.name === 'arteries.surge'))

  const off = setup(4, 'offline')
  off.mind.stimulate('call')
  check('offline: no answer (the host boots it instead)', !off.log.some((e) => e.type === 'answer'))
}

// Listening in silence: "well?" at 6 s, scorn at 16 s, irritation creeping up after 6 s.
// Speaking starts the count again; the same silence in dormant does nothing.
{
  const { mind, run, starts } = setup(4, 'listening')
  const at = (name: string) => (starts(name)[0] as { t: number } | undefined)?.t ?? NaN
  run(5)
  const before = mind.output().mood.irritation
  run(13)
  const after = mind.output().mood.irritation
  check('silence: impatient at 6 s', Math.abs(at('impatient') - 6) < 0.1, `at ${at('impatient').toFixed(2)} s`)
  check('silence: scorn at 16 s', Math.abs(at('scorn') - 16) < 0.1, `at ${at('scorn').toFixed(2)} s`)
  check('silence: irritation creeps up', after > before + 0.1, `${before.toFixed(2)} -> ${after.toFixed(2)}`)
  check('silence: each once per quiet stretch', starts('impatient').length === 1 && starts('scorn').length === 1)

  const s = setup(4, 'listening')
  s.run(4)
  s.mind.stimulate('voice')
  s.run(8)
  const t0 = (s.starts('impatient')[0] as { t: number } | undefined)?.t ?? NaN
  check('speaking restarts the count', Math.abs(t0 - 10) < 0.1, `at ${t0.toFixed(2)} s`)

  const d = setup(4, 'dormant')
  d.run(20)
  check('not in dormant', d.starts('impatient').length === 0 && d.starts('scorn').length === 0)
}

// A task's outcome: done pleases it (vanity up), failed angers it (irritation up).
{
  const { mind, run, starts } = setup(6, 'tooling')
  run(1)
  const v0 = mind.output().mood.vanity
  mind.stimulate('taskDone')
  run(0.5)
  check('task done: pleased plays, vanity up', starts('pleased').length === 1 && mind.output().mood.vanity > v0, `vanity ${v0.toFixed(2)} -> ${mind.output().mood.vanity.toFixed(2)}`)
  run(3)
  const i0 = mind.output().mood.irritation
  mind.stimulate('taskFailed')
  run(0.5)
  const o = mind.output()
  check('task failed: failed plays, irritation up, a part crumbles', starts('failed').length === 1 && o.mood.irritation > i0 + 0.1 && Object.keys(o.channels).some((c) => c.startsWith('crumble:') && o.channels[c] > 0.2))
}

// Same seed, same life.
{
  const a = setup(11)
  const b = setup(11)
  a.run(1800)
  b.run(1800)
  const sa = a.starts().map((e) => (e as { name: string }).name).join(',')
  const sb = b.starts().map((e) => (e as { name: string }).name).join(',')
  check('same seed plays the same reactions', sa === sb && sa.length > 0)
}

// The mood across sessions: a long irritation leaves a grudge, the flare itself is gone.
{
  let saved: Saved | null = null
  let clock = 0
  const storage = { load: () => saved, save: (s: Saved) => void (saved = s) }
  const one = createMind(ultron, { seed: 1, storage, wallClock: () => clock })
  one.setContext('listening')
  for (let i = 0; i < 600 * 20; i++) {
    one.setEmotion('irritation', 0.9)
    one.tick(0.05)
  }
  one.save()
  clock = 8 * 3600 * 1000
  const two = createMind(ultron, { seed: 1, storage, wallClock: () => clock })
  const ok = await two.restore()
  const o = two.output()
  check('restored after 8 h', ok)
  check('a grudge is left in the background', o.background.irritation > 0.1, `mood ${o.background.irritation.toFixed(2)}`)
  check('but not the flare', o.mood.irritation < 0.5, `irritation ${o.mood.irritation.toFixed(2)}`)
  check('and it comes back bored', o.mood.boredom > 0.5, `boredom ${o.mood.boredom.toFixed(2)}`)
}

// What is said moves the mood: praise feeds vanity, a dig or a threat irritates, and a
// shout counts for more than a mumble.
{
  const mood = (name: string, strength: number) => {
    const { mind } = setup(3, 'listening')
    const before = mind.output().mood
    mind.stimulate(name, { strength })
    const after = mind.output().mood
    return { vanity: after.vanity - before.vanity, irritation: after.irritation - before.irritation }
  }
  check('praise: vanity up', mood('heardPraise', 1).vanity > 0.05)
  check('provocation: irritation up, vanity down', mood('heardProvocation', 1).irritation > 0.1 && mood('heardProvocation', 1).vanity < 0)
  check('threat irritates more than a provocation', mood('heardThreat', 1).irritation > mood('heardProvocation', 1).irritation)
  check('a shout counts for more', mood('heardProvocation', 1).irritation > mood('heardProvocation', 0.4).irritation)
  check('indifference: vanity down', mood('heardIndifference', 1).vanity < 0)
  const { mind } = setup(3, 'listening')
  mind.stimulate('heardProvocation', { strength: 1 })
  const once = mind.output().mood.irritation
  mind.stimulate('heardProvocation', { strength: 1 })
  check('provoked again within a minute: it builds', mind.output().mood.irritation - once > 0.2)
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
